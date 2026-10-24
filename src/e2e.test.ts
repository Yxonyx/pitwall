import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { AgentDaemon } from './daemon/daemon.js';
import { RunStore } from './daemon/local.js';
import { echoRunner } from './daemon/runners.js';
import { applyEvent, applyPresence, applySnapshot, type FanEvent, type RoomView, type Snapshot } from './protocol/index.js';
import type { Person } from './protocol/types.js';
import { startPitwall, type PitwallServer } from './relay/server.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function clientId(tag: string): string {
  return `cid-${tag}-${Math.random().toString(36).slice(2, 10)}`;
}

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'pitwall-e2e-'));
}

class PersonClient {
  view: RoomView;
  readonly errors: string[] = [];
  readonly acks: Array<{ clientId?: string; duplicate?: boolean }> = [];
  private socket: WebSocket | null = null;

  constructor(snapshot: Snapshot) {
    this.view = applySnapshot(snapshot);
  }

  static async open(base: string, token: string): Promise<PersonClient> {
    const response = await fetch(`${base}/api/snapshot`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(await response.text());
    const client = new PersonClient((await response.json()) as Snapshot);
    await client.connect(base, token);
    return client;
  }

  private connect(base: string, token: string): Promise<void> {
    const url = new URL('/api/ws', base);
    url.protocol = 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The room did not authenticate.')), 4_000);
      socket.on('message', (data) => {
        const message = JSON.parse(data.toString()) as {
          type?: string;
          event?: FanEvent;
          people?: RoomView['people'];
          machines?: RoomView['machines'];
          agents?: RoomView['agents'];
          error?: string;
          clientId?: string;
          duplicate?: boolean;
        };
        if (message.type === 'authed') {
          clearTimeout(timer);
          resolve();
          return;
        }
        if (message.type === 'event' && message.event) this.view = applyEvent(this.view, message.event);
        if (message.type === 'presence' && message.people && message.machines && message.agents) {
          this.view = applyPresence(this.view, { people: message.people, machines: message.machines, agents: message.agents });
        }
        if (message.type === 'error' && message.error) this.errors.push(message.error);
        if (message.type === 'ack') this.acks.push({ clientId: message.clientId, duplicate: message.duplicate });
      });
      socket.on('error', () => undefined);
      socket.once('open', () => socket.send(JSON.stringify({ type: 'auth', token, since: this.view.cursor })));
    });
  }

  send(body: string, mode: 'say' | 'work' | 'status', agentId: string | null, id = clientId(mode)): string {
    this.socket?.send(JSON.stringify({ type: 'send', clientId: id, body, mode, agentId }));
    return id;
  }

  command(type: 'approve' | 'reject' | 'cancel', taskId: string): void {
    this.socket?.send(JSON.stringify({ type, taskId }));
  }

  close(): void {
    this.socket?.close();
  }
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 8_000) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('two people, one echo daemon, approval, dedup, and a radio mirror', async () => {
  const dir = await tempDir();
  const runsFile = path.join(dir, 'runs.sqlite');
  const server: PitwallServer = await startPitwall({ dataDir: path.join(dir, 'relay'), host: '127.0.0.1', port: 0, web: null });
  const loops: AbortController[] = [];
  cleanup.push(async () => {
    for (const loop of loops) loop.abort();
    await server.close();
  });

  const ownerInvite = server.room.bootstrapOwnerInvite();
  const ownerJoin = await post(server.url, '/api/join', { invite: ownerInvite.code, kind: 'person', name: 'Ada' });
  const ownerToken = ownerJoin.token as string;
  const ownerUser = ownerJoin.user as Person;
  const machineInvite = await post(server.url, '/api/invites', { kind: 'machine' }, ownerToken);
  const machine = await post(server.url, '/api/join', {
    invite: machineInvite.code,
    kind: 'machine',
    name: 'backend',
    agents: [{ name: 'coder', runtime: 'echo' }],
  });

  const counter = { n: 0 };
  const runs = RunStore.open(runsFile);
  cleanup.push(async () => {
    runs.close();
    await rm(dir, { recursive: true, force: true });
  });
  const startDaemon = () => {
    const controller = new AbortController();
    loops.push(controller);
    const daemon = new AgentDaemon({
      url: server.url,
      token: machine.token as string,
      agents: ['coder'],
      runner: echoRunner(counter),
      runs,
      allowWork: true,
    });
    const done = daemon.connectLoop(controller.signal);
    return { abort: () => controller.abort(), done };
  };
  let daemon = startDaemon();
  const owner = await PersonClient.open(server.url, ownerToken);
  cleanup.push(async () => owner.close());
  await waitFor(() => owner.view.machines.some((item) => item.name === 'backend' && item.online), 'the daemon to come online');
  const agentId = owner.view.agents.find((agent) => agent.name === 'coder')?.id;
  if (!agentId) throw new Error('The coder agent is missing.');

  const firstId = owner.send('@coder read the note', 'say', agentId, clientId('talk'));
  await waitFor(() => owner.view.tasks.some((task) => task.clientId === firstId && task.state === 'completed'), 'the talk to finish');
  expect(counter.n).toBe(1);
  owner.send('@coder read the note', 'say', agentId, firstId);
  await waitFor(() => owner.acks.some((ack) => ack.clientId === firstId && ack.duplicate), 'the duplicate ack');
  expect(owner.view.tasks.filter((task) => task.clientId === firstId)).toHaveLength(1);
  expect(counter.n).toBe(1);

  daemon.abort();
  await daemon.done;
  await waitFor(() => owner.view.machines.some((item) => item.name === 'backend' && !item.online), 'the daemon to go offline');
  const secondId = owner.send('@coder one more', 'say', agentId, clientId('offline'));
  await waitFor(() => owner.view.tasks.some((task) => task.clientId === secondId && task.state === 'queued'), 'the offline task to stay queued');
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(counter.n).toBe(1);

  daemon = startDaemon();
  await waitFor(() => owner.view.tasks.some((task) => task.clientId === secondId && task.state === 'completed'), 'the queued task to finish after reconnect');
  expect(counter.n).toBe(2);
  expect(owner.view.tasks.find((task) => task.clientId === firstId)?.state).toBe('completed');

  const peerInvite = await post(server.url, '/api/invites', { kind: 'person', role: 'peer' }, ownerToken);
  const peerJoin = await post(server.url, '/api/join', { invite: peerInvite.code, kind: 'person', name: 'Grace' });
  const peer = await PersonClient.open(server.url, peerJoin.token as string);
  cleanup.push(async () => peer.close());
  const beforeWork = counter.n;
  const workId = peer.send('Change the readme.', 'work', agentId, clientId('work'));
  await waitFor(() => peer.view.tasks.some((task) => task.clientId === workId && task.state === 'needs_approval'), 'approval');
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(counter.n).toBe(beforeWork);
  const work = owner.view.tasks.find((task) => task.clientId === workId);
  if (!work) throw new Error('The work task is missing.');
  owner.command('approve', work.id);
  await waitFor(() => owner.view.tasks.some((task) => task.id === work.id && task.state === 'completed'), 'approved work to finish');
  expect(counter.n).toBe(beforeWork + 1);

  const observerInvite = await post(server.url, '/api/invites', { kind: 'person', role: 'observer' }, ownerToken);
  const observerJoin = await post(server.url, '/api/join', { invite: observerInvite.code, kind: 'person', name: 'Otto' });
  const observer = await PersonClient.open(server.url, observerJoin.token as string);
  cleanup.push(async () => observer.close());
  observer.send('I should not be able to post.', 'say', null, clientId('obs'));
  await waitFor(() => observer.errors.some((error) => error.includes('read this room')), 'the observer refusal');

  const tasksBeforeStatus = owner.view.tasks.length;
  owner.send('Who is here?', 'status', null, clientId('status'));
  await waitFor(() => owner.view.messages.some((message) => message.body.startsWith('Status')), 'the status board');
  expect(owner.view.tasks).toHaveLength(tasksBeforeStatus);

  const tasksBeforeMirror = owner.view.tasks.length;
  const added = server.room.ingestMirror('acme/widgets', [
    {
      id: '99',
      body: 'Radio note from GitHub.',
      url: 'https://github.com/acme/widgets/issues/3#issuecomment-99',
      actor: 'octo',
      updatedAt: new Date().toISOString(),
    },
  ]);
  expect(added).toBe(1);
  await waitFor(() => owner.view.messages.some((message) => message.origin === 'github' && message.body.includes('Radio note')), 'the mirror message');
  expect(owner.view.tasks).toHaveLength(tasksBeforeMirror);
  expect(ownerUser.role).toBe('owner');
  void daemon;
}, 20_000);

async function post(base: string, pathname: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(pathname, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof parsed.error === 'string' ? parsed.error : `HTTP ${response.status}`);
  return parsed;
}
