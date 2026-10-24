import { ProtocolError } from '../protocol/errors.js';
import { canAnswer, canApprove, canCancel, canInvite, canPost, canRequestWork, senderKindOf, workNeedsApproval } from '../protocol/acl.js';
import { parseAddress } from '../protocol/address.js';
import { agentActivity, type Assign, type FanEvent, type Message, type Person, type Role, type SendMode, type Snapshot, type Task, type TaskState } from '../protocol/types.js';
import { assertTransition, type MoveDetail } from '../protocol/transition.js';
import { cleanBody, cleanClientId, cleanPersonName, cleanSlug, safeHttps, statusBoard, withinHop } from '../protocol/text.js';
import { newSecret, nowIso } from '../shared/ids.js';
import type { Hub } from './hub.js';
import { deliverPush, type PushNote, type PushSender } from './push.js';
import type { RadioComment } from './radio.js';
import type { Store } from './store.js';

const APPROVAL_MS = 30 * 60 * 1000;
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const hits = new Map<string, number[]>();

function allow(id: string): boolean {
  const now = Date.now();
  const recent = (hits.get(id) ?? []).filter((stamp) => now - stamp < 60_000);
  if (recent.length >= 30) {
    hits.set(id, recent);
    return false;
  }
  recent.push(now);
  hits.set(id, recent);
  return true;
}

function cleanMode(input: unknown): SendMode {
  if (input === 'say' || input === 'work' || input === 'status') return input;
  throw new ProtocolError('bad_message', 'Choose Say, Work, or Status.');
}

function noteFor(state: TaskState, detail: MoveDetail, actor?: string): string {
  switch (state) {
    case 'queued':
      return actor ? `Approved by ${actor}` : 'Queued';
    case 'delivered':
      return 'On the machine';
    case 'accepted':
      return 'Accepted';
    case 'running':
      return 'Working';
    case 'needs_input':
      return detail.question?.trim() || 'Question';
    case 'needs_approval':
      return 'Waiting for an owner';
    case 'completed':
      return 'Done';
    case 'failed':
      return detail.error?.trim() || 'Failed';
    case 'cancelled':
      return actor ? `Cancelled by ${actor}` : 'Cancelled';
    case 'uncertain':
      return 'Stopped mid-run. It was not started again.';
  }
}

export class Room {
  constructor(
    private readonly store: Store,
    private readonly hub: Hub,
    private readonly push: PushSender | null,
  ) {}

  bootstrapOwnerInvite(): { code: string; expiresAt: string } {
    if (this.store.userCount() > 0) {
      throw new ProtocolError('forbidden', 'Someone has already joined. Create the next invite from People.');
    }
    return this.store.transaction(() => {
      const invite = this.store.createInvite({ kind: 'person', role: 'owner', createdBy: null, ttlMs: INVITE_MS });
      return { code: invite.code, expiresAt: invite.expiresAt };
    });
  }

  joinPerson(code: string, nameInput: unknown): { token: string; user: Person } {
    const name = cleanPersonName(nameInput);
    this.refuseImpersonation(name);
    const token = newSecret();
    const at = nowIso();
    const saved = this.store.transaction(() => {
      const invite = this.store.liveInvite(code, 'person', at);
      const user = this.store.insertUser(name, invite.role ?? 'peer', token, at);
      this.store.markInviteUsed(invite.id, user.id, at);
      const message = this.store.insertMessage({
        clientId: null,
        senderKind: 'system',
        senderId: 'pitwall',
        senderName: 'Pitwall',
        body: `${name} joined.`,
        taskId: null,
        origin: 'room',
        externalId: null,
        link: null,
        hop: 0,
        at,
      });
      return { user, events: [this.store.fanout({ type: 'message', message })] };
    });
    this.publish(saved.events);
    this.presence();
    return { token, user: saved.user };
  }

  joinMachine(
    code: string,
    nameInput: unknown,
    agentsInput: unknown,
  ): { token: string; machineId: string; machineName: string } {
    const name = cleanSlug(nameInput, 'Machine');
    if (this.store.machineByName(name)) {
      throw new ProtocolError('bad_name', 'That machine name is already in the room.');
    }
    const agents = cleanAgents(agentsInput);
    const token = newSecret();
    const at = nowIso();
    const saved = this.store.transaction(() => {
      const invite = this.store.liveInvite(code, 'machine', at);
      const machine = this.store.insertMachine(name, token, at);
      this.store.markInviteUsed(invite.id, machine.id, at);
      for (const agent of agents) this.store.upsertAgent(machine.id, agent.name, agent.runtime, at);
      const message = this.store.insertMessage({
        clientId: null,
        senderKind: 'system',
        senderId: 'pitwall',
        senderName: 'Pitwall',
        body: `${name} is in the room with ${agents.map((agent) => agent.name).join(', ')}.`,
        taskId: null,
        origin: 'room',
        externalId: null,
        link: null,
        hop: 0,
        at,
      });
      return { machine, events: [this.store.fanout({ type: 'message', message })] };
    });
    this.publish(saved.events);
    this.presence();
    return { token, machineId: saved.machine.id, machineName: saved.machine.name };
  }

  createInvite(user: Person, kindInput: unknown, roleInput: unknown): { code: string; expiresAt: string; kind: string; role: Role | null } {
    if (!canInvite(user.role)) throw new ProtocolError('forbidden', 'Only an owner can invite.');
    const kind = kindInput === 'machine' ? 'machine' : kindInput === 'person' ? 'person' : null;
    if (!kind) throw new ProtocolError('bad_message', 'Choose a person invite or a machine invite.');
    const role = kind === 'machine' ? null : cleanRole(roleInput);
    const invite = this.store.createInvite({ kind, role, createdBy: user.id, ttlMs: INVITE_MS });
    return { code: invite.code, expiresAt: invite.expiresAt, kind, role };
  }

  snapshot(user: Person): Snapshot {
    this.expireApprovals();
    const tasks = this.store.recentTasks(200);
    return {
      me: user,
      people: this.store.people(),
      machines: this.store.machines(),
      agents: this.store.agents(),
      messages: this.store.recentMessages(200),
      tasks,
      taskEvents: this.store.taskEventsFor(tasks.map((task) => task.id)),
      cursor: this.store.cursor(),
    };
  }

  send(user: Person, input: { clientId: unknown; body: unknown; mode: unknown; agentId: unknown }): { duplicate: boolean } {
    if (!canPost(user.role)) throw new ProtocolError('forbidden', 'You can read this room, not post in it.');
    if (!allow(user.id)) throw new ProtocolError('rate_limited', 'Too many messages. Wait a moment.');
    const clientId = cleanClientId(input.clientId);
    const mode = cleanMode(input.mode);
    const body = cleanBody(input.body, mode === 'status');
    const at = nowIso();
    const existing = this.store.messageByClient(user.id, clientId);
    if (existing) return { duplicate: true };

    const agent = this.resolveAgent(input.agentId, body, mode);
    if (user.role === 'bot' && (mode === 'work' || agent.kind === 'agent')) {
      throw new ProtocolError('forbidden', 'A bot can talk in the room. It cannot ask an agent for work.');
    }
    if (mode === 'status' || agent.kind === 'status') {
      this.postStatus(user, clientId, body || 'Status', at);
      return { duplicate: false };
    }
    if (agent.kind === 'room') {
      const saved = this.store.transaction(() => {
        const message = this.store.insertMessage({
          clientId,
          senderKind: senderKindOf(user.role),
          senderId: user.id,
          senderName: user.name,
          body,
          taskId: null,
          origin: 'room',
          externalId: null,
          link: null,
          hop: 0,
          at,
        });
        return [this.store.fanout({ type: 'message', message })];
      });
      this.publish(saved);
      return { duplicate: false };
    }

    const modeForTask = mode === 'work' ? 'work' : 'talk';
    if (modeForTask === 'work' && !canRequestWork(user.role)) {
      throw new ProtocolError('forbidden', 'You cannot send work.');
    }
    const needsApproval = modeForTask === 'work' && workNeedsApproval(user.role);
    const saved = this.store.transaction(() => {
      const again = this.store.messageByClient(user.id, clientId);
      if (again) return { duplicate: true as const, events: [] as FanEvent[], task: null as Task | null };
      const task = this.store.insertTask({
        clientId,
        requesterId: user.id,
        requesterName: user.name,
        agent: agent.agent,
        mode: modeForTask,
        body,
        state: needsApproval ? 'needs_approval' : 'queued',
        approved: !needsApproval,
        hop: 0,
        at,
        approvalExpiresAt: needsApproval ? new Date(Date.now() + APPROVAL_MS).toISOString() : null,
      });
      if (!withinHop(task.hop)) throw new ProtocolError('forbidden', 'This chain is too long.');
      const message = this.store.insertMessage({
        clientId,
        senderKind: 'human',
        senderId: user.id,
        senderName: user.name,
        body,
        taskId: task.id,
        origin: 'room',
        externalId: null,
        link: null,
        hop: 0,
        at,
      });
      const taskEvent = this.store.addTaskEvent(task.id, task.state, noteFor(task.state, {}), at);
      return {
        duplicate: false as const,
        events: [
          this.store.fanout({ type: 'message', message }),
          this.store.fanout({ type: 'task', task, taskEvent }),
        ],
        task,
      };
    });
    if (saved.duplicate || !saved.task) return { duplicate: true };
    this.publish(saved.events);
    if (saved.task.state === 'queued') this.assign(saved.task);
    if (saved.task.state === 'needs_approval') {
      this.notify(this.ownerIds(), {
        title: 'Needs approval',
        body: `${user.name} asked ${saved.task.agentName} to work.`,
        url: `/?task=${saved.task.id}`,
      });
    }
    return { duplicate: false };
  }

  approve(user: Person, taskId: string): void {
    if (!canApprove(user.role)) throw new ProtocolError('forbidden', 'Only an owner can approve work.');
    this.expireApprovals();
    const at = nowIso();
    const saved = this.store.transaction(() => {
      const task = this.requireTask(taskId);
      if (task.state !== 'needs_approval') {
        throw new ProtocolError('invalid_state', 'This task is not waiting for approval.');
      }
      if (task.approvalExpiresAt && task.approvalExpiresAt < at) {
        return this.failExpired(task, at);
      }
      return this.transition(task, 'queued', {}, at, `Approved by ${user.name}`);
    });
    this.publish(saved.events);
    if (saved.task.state === 'queued') this.assign(saved.task);
  }

  reject(user: Person, taskId: string): void {
    if (!canApprove(user.role)) throw new ProtocolError('forbidden', 'Only an owner can reject work.');
    const at = nowIso();
    const saved = this.store.transaction(() => {
      const task = this.requireTask(taskId);
      if (task.state !== 'needs_approval') {
        throw new ProtocolError('invalid_state', 'This task is not waiting for approval.');
      }
      return this.transition(task, 'cancelled', {}, at, `Rejected by ${user.name}`);
    });
    this.publish(saved.events);
  }

  answer(user: Person, taskId: string, clientIdInput: unknown, bodyInput: unknown): void {
    if (!canAnswer(user.role)) throw new ProtocolError('forbidden', 'You cannot answer this.');
    const clientId = cleanClientId(clientIdInput);
    const body = cleanBody(bodyInput);
    const at = nowIso();
    if (this.store.messageByClient(user.id, clientId)) return;
    const saved = this.store.transaction(() => {
      const task = this.requireTask(taskId);
      if (task.state !== 'needs_input') {
        throw new ProtocolError('invalid_state', 'This task is not waiting for an answer.');
      }
      const message = this.store.insertMessage({
        clientId,
        senderKind: 'human',
        senderId: user.id,
        senderName: user.name,
        body,
        taskId: task.id,
        origin: 'room',
        externalId: null,
        link: null,
        hop: 0,
        at,
      });
      const next: Task = { ...task, pendingInputId: message.id, pendingInput: body };
      const moved = this.transition(next, 'queued', {}, at, `${user.name} answered.`);
      return { ...moved, events: [this.store.fanout({ type: 'message', message }), ...moved.events] };
    });
    this.publish(saved.events);
    if (saved.task.state === 'queued') this.assign(saved.task);
  }

  cancel(user: Person, taskId: string): void {
    const at = nowIso();
    const saved = this.store.transaction(() => {
      const task = this.requireTask(taskId);
      if (!canCancel(user.role, task.requesterId === user.id)) {
        throw new ProtocolError('forbidden', 'You cannot cancel this task.');
      }
      if (task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled') {
        throw new ProtocolError('invalid_state', 'This task is already finished.');
      }
      const moved = this.transition(task, 'cancelled', {}, at, `Cancelled by ${user.name}`);
      return moved;
    });
    this.publish(saved.events);
    this.hub.sendMachine(saved.task.machineId, { type: 'cancel', taskId: saved.task.id });
  }

  progress(
    machineId: string,
    input: { taskId: unknown; state: unknown; result?: unknown; error?: unknown; question?: unknown },
  ): void {
    const taskId = typeof input.taskId === 'string' ? input.taskId : '';
    const state = input.state;
    if (!isTaskState(state)) throw new ProtocolError('invalid_state', 'Unknown task state.');
    const detail: MoveDetail = {
      result: typeof input.result === 'string' ? input.result : undefined,
      error: typeof input.error === 'string' ? input.error : undefined,
      question: typeof input.question === 'string' ? input.question : undefined,
    };
    const at = nowIso();
    const saved = this.store.transaction(() => {
      const task = this.requireTask(taskId);
      if (task.machineId !== machineId) throw new ProtocolError('forbidden', 'This task belongs to another machine.');
      if (task.state === state) return { events: [] as FanEvent[], task, message: null as Message | null };
      const moved = this.transition(task, state, detail, at, noteFor(state, detail).slice(0, 500));
      let message: Message | null = null;
      const text = state === 'completed' ? detail.result : state === 'failed' ? detail.error : state === 'needs_input' ? detail.question : null;
      if (text?.trim() && (state === 'completed' || state === 'failed' || state === 'needs_input')) {
        message = this.store.insertMessage({
          clientId: null,
          senderKind: 'agent',
          senderId: task.agentId,
          senderName: task.agentName,
          body: text.trim().slice(0, 4000),
          taskId: task.id,
          origin: 'room',
          externalId: null,
          link: null,
          hop: task.hop,
          at,
        });
      }
      const events = message ? [this.store.fanout({ type: 'message', message }), ...moved.events] : moved.events;
      return { events, task: moved.task, message };
    });
    this.publish(saved.events);
    if (saved.events.length === 0) return;
    if (saved.task.state === 'needs_input') {
      this.notify([saved.task.requesterId], {
        title: `${saved.task.agentName} has a question`,
        body: saved.task.question ?? 'Open the task.',
        url: `/?task=${saved.task.id}`,
      });
    }
    if (saved.task.state === 'completed' || saved.task.state === 'failed' || saved.task.state === 'uncertain') {
      this.notify([saved.task.requesterId], {
        title: `${saved.task.agentName} · ${saved.task.state === 'completed' ? 'Done' : saved.task.state === 'failed' ? 'Failed' : 'Uncertain'}`,
        body: (saved.task.result || saved.task.error || 'Open the task.').slice(0, 140),
        url: `/?task=${saved.task.id}`,
      });
    }
  }

  connectMachine(machineId: string): void {
    const at = nowIso();
    this.store.setMachineOnline(machineId, true, at);
    this.presence();
  }

  hello(machineId: string, agentsInput: unknown): Task[] {
    const agents = cleanAgents(agentsInput);
    const at = nowIso();
    for (const agent of agents) this.store.upsertAgent(machineId, agent.name, agent.runtime, at);
    this.store.markAgentsOffline(machineId, agents.map((agent) => agent.name));
    this.store.setMachineOnline(machineId, true, at);
    this.presence();
    return this.store.openTasks(machineId);
  }

  heartbeat(machineId: string): void {
    this.store.setMachineOnline(machineId, true, nowIso());
  }

  disconnectMachine(machineId: string): void {
    this.store.setMachineOnline(machineId, false, nowIso());
    this.store.setMachineAgentsOffline(machineId);
    this.presence();
  }

  connectPerson(userId: string): void {
    this.store.setUserOnline(userId, true);
    this.presence();
  }

  disconnectPerson(userId: string): void {
    if (this.hub.personCount(userId) === 0) {
      this.store.setUserOnline(userId, false);
      this.presence();
    }
  }

  eventsSince(cursor: number): FanEvent[] {
    return this.store.eventsSince(cursor);
  }

  savePush(user: Person, body: unknown): void {
    if (!body || typeof body !== 'object') throw new ProtocolError('bad_message', 'The push subscription is missing.');
    const record = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    if (typeof record.endpoint !== 'string' || !record.endpoint.startsWith('https://')) {
      throw new ProtocolError('bad_message', 'The push endpoint is not valid.');
    }
    if (typeof record.keys?.p256dh !== 'string' || typeof record.keys.auth !== 'string') {
      throw new ProtocolError('bad_message', 'The push keys are missing.');
    }
    this.store.savePush(user.id, record.endpoint, record.keys.p256dh, record.keys.auth);
  }

  ingestMirror(repo: string, comments: readonly RadioComment[]): number {
    let added = 0;
    for (const comment of comments) {
      const externalId = `${repo}#${comment.id}`;
      if (this.store.messageByExternal('github', externalId)) continue;
      const at = comment.updatedAt || nowIso();
      const saved = this.store.transaction(() => {
        if (this.store.messageByExternal('github', externalId)) return null;
        const message = this.store.insertMessage({
          clientId: null,
          senderKind: 'system',
          senderId: 'github',
          senderName: comment.actor,
          body: comment.body.replace(/\u0000/g, '').trim().slice(0, 4000) || '(empty comment)',
          taskId: null,
          origin: 'github',
          externalId,
          link: safeHttps(comment.url),
          hop: 0,
          at,
        });
        return [this.store.fanout({ type: 'message', message })];
      });
      if (!saved) continue;
      this.publish(saved);
      added += 1;
    }
    return added;
  }

  expireApprovals(now = nowIso()): void {
    const tasks = this.store.expiredApprovals(now);
    for (const task of tasks) {
      const saved = this.store.transaction(() => this.failExpired(task, now));
      this.publish(saved.events);
    }
  }

  userByToken(token: string): Person | undefined {
    return this.store.userByToken(token);
  }

  person(id: string): Person | undefined {
    return this.store.people().find((item) => item.id === id);
  }

  machineByToken(token: string): { id: string; name: string } | undefined {
    const machine = this.store.machineByToken(token);
    return machine ? { id: machine.id, name: machine.name } : undefined;
  }

  /** A person or a bot may not take the name of an agent, a machine or the room itself: a line from them would pass for theirs. */
  private refuseImpersonation(name: string): void {
    const taken = name.toLowerCase();
    const reserved = ['pitwall', 'system', 'all'];
    const names = [...reserved, ...this.store.agents().map((agent) => agent.name), ...this.store.machines().map((machine) => machine.name)];
    if (names.some((other) => other.toLowerCase() === taken)) {
      throw new ProtocolError('bad_name', 'That name belongs to an agent, a machine or the room. Choose another.');
    }
  }

  private postStatus(user: Person, clientId: string, body: string, at: string): void {
    const agents = this.store.agents().map((agent) => ({
      name: agent.name,
      machineName: agent.machineName,
      online: agent.online,
      activity: agentActivity(this.store.recentTasks(200), agent.id),
    }));
    const saved = this.store.transaction(() => {
      const ask = this.store.insertMessage({
        clientId,
        senderKind: 'human',
        senderId: user.id,
        senderName: user.name,
        body,
        taskId: null,
        origin: 'room',
        externalId: null,
        link: null,
        hop: 0,
        at,
      });
      const board = this.store.insertMessage({
        clientId: null,
        senderKind: 'system',
        senderId: 'pitwall',
        senderName: 'Pitwall',
        body: statusBoard(agents, body === 'Status' ? undefined : body),
        taskId: null,
        origin: 'room',
        externalId: null,
        link: null,
        hop: 0,
        at,
      });
      return [this.store.fanout({ type: 'message', message: ask }), this.store.fanout({ type: 'message', message: board })];
    });
    this.publish(saved);
  }

  private resolveAgent(
    agentId: unknown,
    body: string,
    mode: SendMode,
  ): { kind: 'status' } | { kind: 'room' } | { kind: 'agent'; agent: NonNullable<ReturnType<Store['agent']>> } {
    if (mode === 'status') return { kind: 'status' };
    if (typeof agentId === 'string' && agentId) {
      const agent = this.store.agent(agentId);
      if (!agent) throw new ProtocolError('not_found', 'That agent is not in the room.');
      return { kind: 'agent', agent };
    }
    const parsed = parseAddress(body, this.store.agents());
    if (parsed.kind === 'all') {
      if (mode === 'work') {
        throw new ProtocolError('bad_address', 'Choose one agent. Status does not start work for everyone.');
      }
      return { kind: 'status' };
    }
    if (parsed.kind === 'ambiguous') {
      throw new ProtocolError('bad_address', `More than one agent is named ${parsed.name}. Choose the machine.`);
    }
    if (parsed.kind === 'unknown') {
      throw new ProtocolError('bad_address', `No agent is named ${parsed.token}.`);
    }
    if (parsed.kind === 'agent') {
      const agent = this.store.agent(parsed.agentId);
      if (!agent) throw new ProtocolError('not_found', 'That agent is not in the room.');
      return { kind: 'agent', agent };
    }
    if (mode === 'work') throw new ProtocolError('bad_address', 'Choose an agent for this work.');
    return { kind: 'room' };
  }

  private transition(task: Task, to: TaskState, detail: MoveDetail, at: string, note: string): { task: Task; events: FanEvent[] } {
    assertTransition(task.state, to, detail);
    const next: Task = {
      ...task,
      state: to,
      updatedAt: at,
      result: detail.result !== undefined ? detail.result : task.result,
      error: detail.error !== undefined ? detail.error : task.error,
      question: detail.question !== undefined ? detail.question : task.question,
      approved: task.state === 'needs_approval' && to === 'queued' ? true : task.approved,
      approvalExpiresAt: task.state === 'needs_approval' && to === 'queued' ? null : task.approvalExpiresAt,
    };
    this.store.saveTask(next);
    const taskEvent = this.store.addTaskEvent(next.id, to, note.slice(0, 500), at);
    return { task: next, events: [this.store.fanout({ type: 'task', task: next, taskEvent })] };
  }

  private failExpired(task: Task, at: string): { task: Task; events: FanEvent[] } {
    if (task.state !== 'needs_approval') return { task, events: [] };
    return this.transition(task, 'failed', { error: 'Approval expired.' }, at, 'Approval expired.');
  }

  private requireTask(id: string): Task {
    const task = this.store.task(id);
    if (!task) throw new ProtocolError('not_found', 'That task is not in the room.');
    return task;
  }

  private assign(task: Task): void {
    const payload: Assign = {
      id: task.id,
      state: task.state,
      mode: task.mode,
      body: task.body,
      agentId: task.agentId,
      agentName: task.agentName,
      machineId: task.machineId,
      requesterName: task.requesterName,
      approved: task.approved,
      hop: task.hop,
      pendingInputId: task.pendingInputId,
      pendingInput: task.pendingInput,
    };
    this.hub.sendMachine(task.machineId, { type: 'assign', task: payload });
  }

  private publish(events: FanEvent[]): void {
    const ordered = [...events].sort((a, b) => a.cursor - b.cursor);
    for (const event of ordered) this.hub.broadcast({ type: 'event', event });
  }

  private presence(): void {
    this.hub.broadcast({
      type: 'presence',
      people: this.store.people(),
      machines: this.store.machines(),
      agents: this.store.agents(),
    });
  }

  private ownerIds(): string[] {
    return this.store.people().filter((person) => person.role === 'owner').map((person) => person.id);
  }

  private notify(userIds: string[], note: PushNote): void {
    if (!this.push || userIds.length === 0) return;
    const subs = this.store.pushesFor(userIds);
    void deliverPush(this.push, subs, note).then((gone) => {
      for (const endpoint of gone) this.store.deletePush(endpoint);
    });
  }
}

function cleanRole(input: unknown): Role {
  if (input === undefined || input === 'peer') return 'peer';
  if (input === 'owner' || input === 'observer' || input === 'bot') return input;
  throw new ProtocolError('bad_message', 'Role must be owner, peer, observer, or bot.');
}

function cleanAgents(input: unknown): Array<{ name: string; runtime: string }> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ProtocolError('bad_name', 'Name at least one agent.');
  }
  const agents = input.map((item) => {
    const record = item as { name?: unknown; runtime?: unknown };
    const name = cleanSlug(record?.name, 'Agent');
    const runtime = typeof record?.runtime === 'string' && /^[a-z0-9-]{1,20}$/.test(record.runtime) ? record.runtime : 'echo';
    return { name, runtime };
  });
  const names = new Set(agents.map((agent) => agent.name));
  if (names.size !== agents.length) throw new ProtocolError('bad_name', 'Agent names on one machine must be unique.');
  return agents;
}

function isTaskState(value: unknown): value is TaskState {
  return (
    value === 'queued' ||
    value === 'delivered' ||
    value === 'accepted' ||
    value === 'running' ||
    value === 'needs_input' ||
    value === 'needs_approval' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'uncertain'
  );
}
