import { WebSocket } from 'ws';
import type { Assign, TaskState } from '../protocol/types.js';
import { stepsTo } from '../protocol/transition.js';
import { decideReplay } from './decide.js';
import { RunStore } from './local.js';
import type { Runner } from './runners.js';

export interface DaemonTransport {
  request(message: Record<string, unknown>): Promise<void>;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const TERMINAL = new Set<TaskState>(['completed', 'failed', 'cancelled', 'uncertain']);

export class AgentDaemon {
  private readonly relayState = new Map<string, TaskState>();
  private readonly tails = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pending = new Map<string, Waiter>();
  private socket: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      url?: string;
      token?: string;
      agents: readonly string[];
      runner: Runner;
      runs: RunStore;
      allowWork: boolean;
      project?: string;
      transport?: DaemonTransport;
    },
  ) {}

  async connectLoop(signal: AbortSignal): Promise<void> {
    let delay = 500;
    while (!signal.aborted) {
      try {
        await this.session(signal);
        delay = 500;
      } catch (error) {
        if (signal.aborted) return;
        const message = error instanceof Error ? error.message : 'connection failed';
        console.error(`Daemon reconnecting: ${message}`);
        await sleep(delay, signal);
        delay = Math.min(delay * 2, 10_000);
      }
    }
  }

  async handleAssign(assign: Assign): Promise<void> {
    const previous = this.tails.get(assign.id) ?? Promise.resolve();
    const job = previous.then(() => this.dispatch(assign));
    this.tails.set(
      assign.id,
      job.then(
        () => undefined,
        () => undefined,
      ),
    );
    await job;
  }

  private async dispatch(assign: Assign): Promise<void> {
    this.adopt(assign);
    if (TERMINAL.has(assign.state) && this.relayState.get(assign.id) === assign.state) return;
    if (!this.options.agents.includes(assign.agentName)) {
      await this.emitToward(assign, 'failed', { error: 'This machine has no agent by that name.' });
      return;
    }
    if (assign.mode === 'work' && !assign.approved) {
      await this.emitToward(assign, 'failed', { error: 'This work is not approved.' });
      return;
    }
    if (assign.mode === 'work' && !this.options.allowWork) {
      await this.emitToward(assign, 'failed', { error: 'This machine is not accepting work.' });
      return;
    }

    const local = this.options.runs.get(assign.id);
    const decision = decideReplay(local, assign.pendingInputId);
    if (decision.kind === 'ignore') return;
    if (decision.kind === 'replay') {
      if (decision.state === 'completed') await this.emitToward(assign, 'completed', { result: decision.note });
      else await this.emitToward(assign, 'failed', { error: decision.note });
      return;
    }
    if (decision.kind === 'uncertain') {
      this.options.runs.save(assign.id, { state: 'uncertain' });
      await this.emitToward(assign, 'uncertain', {});
      return;
    }

    if (decision.kind === 'start') {
      if (!this.options.runs.claim(assign.id)) {
        const again = decideReplay(this.options.runs.get(assign.id), assign.pendingInputId);
        if (again.kind === 'replay' && again.state === 'completed') {
          await this.emitToward(assign, 'completed', { result: again.note });
        } else if (again.kind === 'replay') {
          await this.emitToward(assign, 'failed', { error: again.note });
        }
        return;
      }
    } else {
      this.options.runs.save(assign.id, { state: 'running', lastInputId: assign.pendingInputId });
    }

    const controller = new AbortController();
    this.controllers.set(assign.id, controller);
    try {
      await this.emitToward(assign, 'running', {});
      const outcome = await this.options.runner.run(
        {
          id: assign.id,
          mode: assign.mode,
          body: assign.body,
          agentName: assign.agentName,
          requesterName: assign.requesterName,
          input: decision.kind === 'followup' ? assign.pendingInput : null,
          sessionId: this.options.runs.get(assign.id)?.sessionId ?? null,
        },
        { cwd: this.options.project, signal: controller.signal },
      );
      if (controller.signal.aborted) {
        this.options.runs.save(assign.id, { state: 'cancelled' });
        return;
      }
      if (outcome.type === 'completed') {
        this.options.runs.save(assign.id, { state: 'completed', result: outcome.result, sessionId: outcome.sessionId ?? null });
        await this.emitToward(assign, 'completed', { result: outcome.result });
      } else if (outcome.type === 'needs_input') {
        this.options.runs.save(assign.id, {
          state: 'needs_input',
          question: outcome.question,
          result: outcome.result ?? null,
          sessionId: outcome.sessionId ?? null,
        });
        await this.emitToward(assign, 'needs_input', { question: outcome.question });
      } else {
        this.options.runs.save(assign.id, { state: 'failed', error: outcome.error });
        await this.emitToward(assign, 'failed', { error: outcome.error });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        this.options.runs.save(assign.id, { state: 'cancelled' });
        return;
      }
      const message = error instanceof Error ? error.message : 'The runner failed.';
      this.options.runs.save(assign.id, { state: 'failed', error: message });
      await this.emitToward(assign, 'failed', { error: message });
    } finally {
      this.controllers.delete(assign.id);
    }
  }

  private adopt(assign: Assign): void {
    const known = this.relayState.get(assign.id);
    if (!known || (known === 'needs_input' && assign.state === 'queued')) {
      this.relayState.set(assign.id, assign.state);
    }
  }

  private async emitToward(
    assign: Assign,
    to: TaskState,
    detail: { result?: string; error?: string; question?: string },
  ): Promise<void> {
    const from = this.relayState.get(assign.id) ?? assign.state;
    for (const step of stepsTo(from, to)) {
      await this.request({
        type: 'progress',
        taskId: assign.id,
        state: step,
        result: step === 'completed' ? detail.result : undefined,
        error: step === 'failed' ? detail.error : undefined,
        question: step === 'needs_input' ? detail.question : undefined,
      });
      this.relayState.set(assign.id, step);
    }
  }

  private request(message: Record<string, unknown>): Promise<void> {
    if (this.options.transport) return this.options.transport.request(message);
    const taskId = typeof message.taskId === 'string' ? message.taskId : '';
    const state = typeof message.state === 'string' ? message.state : '';
    const key = `${taskId}:${state}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error('The room did not acknowledge the update.'));
      }, 8_000);
      this.pending.set(key, { resolve, reject, timer });
      this.socket?.send(JSON.stringify(message));
    });
  }

  private session(signal: AbortSignal): Promise<void> {
    const url = this.socketUrl();
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      const abort = () => socket.close();
      signal.addEventListener('abort', abort, { once: true });
      socket.on('open', () => {
        socket.send(JSON.stringify({ type: 'auth', token: this.options.token }));
      });
      socket.on('message', (data) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.type === 'authed') {
          socket.send(
            JSON.stringify({
              type: 'hello',
              agents: this.options.agents.map((name) => ({ name, runtime: this.options.runner.id })),
            }),
          );
          this.heartbeat = setInterval(() => {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'heartbeat' }));
          }, 10_000);
          this.heartbeat.unref();
          return;
        }
        this.onMessage(message);
      });
      socket.on('error', () => undefined);
      socket.on('close', () => {
        signal.removeEventListener('abort', abort);
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
        if (this.socket === socket) this.socket = null;
        this.rejectPending(new Error('The room connection closed.'));
        if (signal.aborted) resolve();
        else reject(new Error('The room connection closed.'));
      });
    });
  }

  private onMessage(message: Record<string, unknown>): void {
    if (message.type === 'progress.ok' || message.type === 'error') {
      const key = `${String(message.taskId)}:${String(message.state)}`;
      const waiter = this.pending.get(key);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(key);
      if (message.type === 'error') waiter.reject(new Error(typeof message.error === 'string' ? message.error : 'Progress was rejected.'));
      else waiter.resolve();
      return;
    }
    if (message.type === 'cancel' && typeof message.taskId === 'string') {
      this.controllers.get(message.taskId)?.abort();
      return;
    }
    if (message.type === 'assign') {
      const assign = message.task;
      if (!isAssign(assign)) return;
      void this.handleAssign(assign).catch((error: unknown) => {
        const text = error instanceof Error ? error.message : 'assign failed';
        console.error(`Task ${assign.id}: ${text}`);
      });
    }
  }

  private socketUrl(): string {
    const url = new URL(this.options.url ?? 'http://127.0.0.1');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/api/machine';
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  private rejectPending(error: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }
}

function isAssign(value: unknown): value is Assign {
  if (!value || typeof value !== 'object') return false;
  const assign = value as Partial<Assign>;
  return typeof assign.id === 'string' && typeof assign.agentName === 'string' && typeof assign.state === 'string';
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
