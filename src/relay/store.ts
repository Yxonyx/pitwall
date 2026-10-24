import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { ProtocolError } from '../protocol/errors.js';
import type { Agent, FanEvent, Machine, Message, Person, Role, Task, TaskEvent, TaskMode, TaskState } from '../protocol/types.js';
import { hashSecret, newId, nowIso } from '../shared/ids.js';

interface UserRow {
  id: string;
  name: string;
  role: Role;
  token_hash: string;
  created_at: string;
  online: number;
}

interface InviteRow {
  id: string;
  code_hash: string;
  kind: 'person' | 'machine';
  role: Role | null;
  created_by: string | null;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
}

interface MachineRow {
  id: string;
  name: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string | null;
  online: number;
}

interface AgentRow {
  id: string;
  machine_id: string;
  name: string;
  runtime: string;
  online: number;
  last_seen_at: string | null;
  machine_name: string;
}

interface MessageRow {
  id: string;
  client_id: string | null;
  sender_kind: Message['senderKind'];
  sender_id: string;
  sender_name: string;
  body: string;
  task_id: string | null;
  created_at: string;
  origin: Message['origin'];
  external_id: string | null;
  link: string | null;
  hop: number;
}

interface TaskRow {
  id: string;
  client_id: string;
  requester_id: string;
  requester_name: string;
  agent_id: string;
  agent_name: string;
  machine_id: string;
  machine_name: string;
  mode: TaskMode;
  body: string;
  state: TaskState;
  approved: number;
  result: string | null;
  error: string | null;
  question: string | null;
  pending_input_id: string | null;
  pending_input: string | null;
  hop: number;
  created_at: string;
  updated_at: string;
  approval_expires_at: string | null;
}

interface TaskEventRow {
  id: number;
  task_id: string;
  state: TaskState;
  note: string | null;
  created_at: string;
}

export interface PushSub {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function all<T>(stmt: StatementSync, ...params: SQLInputValue[]): T[] {
  return stmt.all(...params) as T[];
}

function get<T>(stmt: StatementSync, ...params: SQLInputValue[]): T | undefined {
  return stmt.get(...params) as T | undefined;
}

function mapPerson(row: UserRow): Person {
  return { id: row.id, name: row.name, role: row.role, online: row.online === 1 };
}

function mapMachine(row: MachineRow): Machine {
  return { id: row.id, name: row.name, online: row.online === 1, lastSeenAt: row.last_seen_at };
}

function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    machineId: row.machine_id,
    machineName: row.machine_name,
    name: row.name,
    runtime: row.runtime,
    online: row.online === 1,
    lastSeenAt: row.last_seen_at,
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    clientId: row.client_id,
    senderKind: row.sender_kind,
    senderId: row.sender_id,
    senderName: row.sender_name,
    body: row.body,
    taskId: row.task_id,
    createdAt: row.created_at,
    origin: row.origin,
    externalId: row.external_id,
    link: row.link,
    hop: row.hop,
  };
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    clientId: row.client_id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    machineId: row.machine_id,
    machineName: row.machine_name,
    mode: row.mode,
    body: row.body,
    state: row.state,
    approved: row.approved === 1,
    result: row.result,
    error: row.error,
    question: row.question,
    pendingInputId: row.pending_input_id,
    pendingInput: row.pending_input,
    hop: row.hop,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvalExpiresAt: row.approval_expires_at,
  };
}

function mapTaskEvent(row: TaskEventRow): TaskEvent {
  return { id: row.id, taskId: row.task_id, state: row.state, note: row.note, createdAt: row.created_at };
}

export class Store {
  private constructor(readonly db: DatabaseSync) {}

  static open(dataDir: string): Store {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path.join(dataDir, 'raj.sqlite'));
    db.exec('pragma journal_mode = WAL');
    db.exec('pragma busy_timeout = 5000');
    db.exec('pragma foreign_keys = ON');
    const store = new Store(db);
    store.migrate();
    return store;
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists users (
        id text primary key,
        name text not null,
        role text not null,
        token_hash text not null unique,
        created_at text not null,
        online integer not null default 0
      );
      create table if not exists invites (
        id text primary key,
        code_hash text not null unique,
        kind text not null,
        role text,
        created_by text,
        expires_at text not null,
        used_at text,
        used_by text
      );
      create table if not exists machines (
        id text primary key,
        name text not null unique,
        token_hash text not null unique,
        created_at text not null,
        last_seen_at text,
        online integer not null default 0
      );
      create table if not exists agents (
        id text primary key,
        machine_id text not null references machines(id),
        name text not null,
        runtime text not null,
        online integer not null default 0,
        last_seen_at text,
        unique (machine_id, name)
      );
      create table if not exists messages (
        id text primary key,
        client_id text,
        sender_kind text not null,
        sender_id text not null,
        sender_name text not null,
        body text not null,
        task_id text,
        created_at text not null,
        origin text not null default 'room',
        external_id text,
        link text,
        hop integer not null default 0,
        causation_id text
      );
      create unique index if not exists messages_client on messages(sender_id, client_id) where client_id is not null;
      create unique index if not exists messages_external on messages(origin, external_id) where external_id is not null;
      create table if not exists tasks (
        id text primary key,
        client_id text not null,
        requester_id text not null,
        requester_name text not null,
        agent_id text not null,
        agent_name text not null,
        machine_id text not null,
        machine_name text not null,
        mode text not null,
        body text not null,
        state text not null,
        approved integer not null default 0,
        result text,
        error text,
        question text,
        pending_input_id text,
        pending_input text,
        hop integer not null default 0,
        created_at text not null,
        updated_at text not null,
        approval_expires_at text
      );
      create unique index if not exists tasks_client on tasks(requester_id, client_id, agent_id);
      create table if not exists task_events (
        id integer primary key autoincrement,
        task_id text not null,
        state text not null,
        note text,
        created_at text not null
      );
      create table if not exists push_subs (
        id text primary key,
        user_id text not null,
        endpoint text not null unique,
        p256dh text not null,
        auth text not null,
        created_at text not null
      );
      create table if not exists fanout (
        id integer primary key autoincrement,
        type text not null,
        payload text not null,
        created_at text not null
      );
    `);
  }

  userCount(): number {
    const row = get<{ n: number }>(this.db.prepare('select count(*) as n from users'));
    return row?.n ?? 0;
  }

  createInvite(input: {
    kind: 'person' | 'machine';
    role: Role | null;
    createdBy: string | null;
    ttlMs: number;
  }): { id: string; code: string; expiresAt: string } {
    const id = newId('inv');
    const code = newId('join');
    const expiresAt = new Date(Date.now() + input.ttlMs).toISOString();
    this.db
      .prepare(
        'insert into invites (id, code_hash, kind, role, created_by, expires_at) values (?, ?, ?, ?, ?, ?)',
      )
      .run(id, hashSecret(code), input.kind, input.role, input.createdBy, expiresAt);
    return { id, code, expiresAt };
  }

  inviteKind(code: string): 'person' | 'machine' | null {
    const invite = get<InviteRow>(this.db.prepare('select kind from invites where code_hash = ?'), hashSecret(code));
    return invite?.kind ?? null;
  }

  liveInvite(code: string, kind: 'person' | 'machine', at: string): { id: string; role: Role | null } {
    const invite = get<InviteRow>(this.db.prepare('select * from invites where code_hash = ?'), hashSecret(code));
    if (!invite || invite.kind !== kind || invite.used_at) {
      throw new ProtocolError('not_found', 'That invite is not valid.');
    }
    if (invite.expires_at < at) throw new ProtocolError('expired', 'That invite has expired.');
    return { id: invite.id, role: invite.role };
  }

  markInviteUsed(id: string, usedBy: string, at: string): void {
    this.db.prepare('update invites set used_at = ?, used_by = ? where id = ?').run(at, usedBy, id);
  }

  insertUser(name: string, role: Role, token: string, at: string): Person {
    const id = newId('usr');
    this.db
      .prepare('insert into users (id, name, role, token_hash, created_at, online) values (?, ?, ?, ?, ?, 0)')
      .run(id, name, role, hashSecret(token), at);
    return { id, name, role, online: false };
  }

  userByToken(token: string): Person | undefined {
    const row = get<UserRow>(this.db.prepare('select * from users where token_hash = ?'), hashSecret(token));
    return row ? mapPerson(row) : undefined;
  }

  people(): Person[] {
    return all<UserRow>(this.db.prepare('select * from users order by created_at asc')).map(mapPerson);
  }

  setUserOnline(id: string, online: boolean): void {
    this.db.prepare('update users set online = ? where id = ?').run(online ? 1 : 0, id);
  }

  insertMachine(name: string, token: string, at: string): Machine {
    const id = newId('mch');
    this.db
      .prepare(
        'insert into machines (id, name, token_hash, created_at, last_seen_at, online) values (?, ?, ?, ?, ?, 0)',
      )
      .run(id, name, hashSecret(token), at, at);
    return { id, name, online: false, lastSeenAt: at };
  }

  machineByToken(token: string): Machine | undefined {
    const row = get<MachineRow>(this.db.prepare('select * from machines where token_hash = ?'), hashSecret(token));
    return row ? mapMachine(row) : undefined;
  }

  machineByName(name: string): Machine | undefined {
    const row = get<MachineRow>(this.db.prepare('select * from machines where name = ?'), name);
    return row ? mapMachine(row) : undefined;
  }

  machines(): Machine[] {
    return all<MachineRow>(this.db.prepare('select * from machines order by name asc')).map(mapMachine);
  }

  setMachineOnline(id: string, online: boolean, seenAt: string | null): void {
    this.db
      .prepare('update machines set online = ?, last_seen_at = coalesce(?, last_seen_at) where id = ?')
      .run(online ? 1 : 0, seenAt, id);
  }

  upsertAgent(machineId: string, name: string, runtime: string, at: string): Agent {
    const existing = get<AgentRow>(
      this.db.prepare(
        `select agents.*, machines.name as machine_name
         from agents join machines on machines.id = agents.machine_id
         where agents.machine_id = ? and agents.name = ?`,
      ),
      machineId,
      name,
    );
    if (!existing) {
      const id = newId('agt');
      this.db
        .prepare(
          'insert into agents (id, machine_id, name, runtime, online, last_seen_at) values (?, ?, ?, ?, 1, ?)',
        )
        .run(id, machineId, name, runtime, at);
    } else {
      this.db
        .prepare('update agents set runtime = ?, online = 1, last_seen_at = ? where id = ?')
        .run(runtime, at, existing.id);
    }
    const row = get<AgentRow>(
      this.db.prepare(
        `select agents.*, machines.name as machine_name
         from agents join machines on machines.id = agents.machine_id
         where agents.machine_id = ? and agents.name = ?`,
      ),
      machineId,
      name,
    );
    if (!row) throw new Error('Agent disappeared during insert.');
    return mapAgent(row);
  }

  agents(): Agent[] {
    return all<AgentRow>(
      this.db.prepare(
        `select agents.*, machines.name as machine_name
         from agents join machines on machines.id = agents.machine_id
         order by machines.name, agents.name`,
      ),
    ).map(mapAgent);
  }

  agent(id: string): Agent | undefined {
    const row = get<AgentRow>(
      this.db.prepare(
        `select agents.*, machines.name as machine_name
         from agents join machines on machines.id = agents.machine_id
         where agents.id = ?`,
      ),
      id,
    );
    return row ? mapAgent(row) : undefined;
  }

  markAgentsOffline(machineId: string, keepNames: readonly string[]): void {
    const agents = this.agents().filter((agent) => agent.machineId === machineId);
    for (const agent of agents) {
      if (!keepNames.includes(agent.name)) {
        this.db.prepare('update agents set online = 0 where id = ?').run(agent.id);
      }
    }
  }

  setMachineAgentsOffline(machineId: string): void {
    this.db.prepare('update agents set online = 0 where machine_id = ?').run(machineId);
  }

  insertMessage(input: {
    clientId: string | null;
    senderKind: Message['senderKind'];
    senderId: string;
    senderName: string;
    body: string;
    taskId: string | null;
    origin: Message['origin'];
    externalId: string | null;
    link: string | null;
    hop: number;
    at: string;
  }): Message {
    const id = newId('msg');
    this.db
      .prepare(
        `insert into messages (
          id, client_id, sender_kind, sender_id, sender_name, body, task_id, created_at, origin, external_id, link, hop
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.clientId,
        input.senderKind,
        input.senderId,
        input.senderName,
        input.body,
        input.taskId,
        input.at,
        input.origin,
        input.externalId,
        input.link,
        input.hop,
      );
    return {
      id,
      clientId: input.clientId,
      senderKind: input.senderKind,
      senderId: input.senderId,
      senderName: input.senderName,
      body: input.body,
      taskId: input.taskId,
      createdAt: input.at,
      origin: input.origin,
      externalId: input.externalId,
      link: input.link,
      hop: input.hop,
    };
  }

  messageByClient(senderId: string, clientId: string): Message | undefined {
    const row = get<MessageRow>(
      this.db.prepare('select * from messages where sender_id = ? and client_id = ?'),
      senderId,
      clientId,
    );
    return row ? mapMessage(row) : undefined;
  }

  messageByExternal(origin: string, externalId: string): Message | undefined {
    const row = get<MessageRow>(
      this.db.prepare('select * from messages where origin = ? and external_id = ?'),
      origin,
      externalId,
    );
    return row ? mapMessage(row) : undefined;
  }

  recentMessages(limit: number): Message[] {
    return all<MessageRow>(
      this.db.prepare('select * from messages order by created_at desc, id desc limit ?'),
      limit,
    )
      .map(mapMessage)
      .reverse();
  }

  insertTask(input: {
    clientId: string;
    requesterId: string;
    requesterName: string;
    agent: Agent;
    mode: TaskMode;
    body: string;
    state: TaskState;
    approved: boolean;
    hop: number;
    at: string;
    approvalExpiresAt: string | null;
  }): Task {
    const id = newId('tsk');
    this.db
      .prepare(
        `insert into tasks (
          id, client_id, requester_id, requester_name, agent_id, agent_name, machine_id, machine_name,
          mode, body, state, approved, hop, created_at, updated_at, approval_expires_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.clientId,
        input.requesterId,
        input.requesterName,
        input.agent.id,
        input.agent.name,
        input.agent.machineId,
        input.agent.machineName,
        input.mode,
        input.body,
        input.state,
        input.approved ? 1 : 0,
        input.hop,
        input.at,
        input.at,
        input.approvalExpiresAt,
      );
    const task = this.task(id);
    if (!task) throw new Error('Task disappeared during insert.');
    return task;
  }

  task(id: string): Task | undefined {
    const row = get<TaskRow>(this.db.prepare('select * from tasks where id = ?'), id);
    return row ? mapTask(row) : undefined;
  }

  taskByClient(requesterId: string, clientId: string, agentId: string): Task | undefined {
    const row = get<TaskRow>(
      this.db.prepare('select * from tasks where requester_id = ? and client_id = ? and agent_id = ?'),
      requesterId,
      clientId,
      agentId,
    );
    return row ? mapTask(row) : undefined;
  }

  saveTask(task: Task): void {
    this.db
      .prepare(
        `update tasks set
          state = ?, approved = ?, result = ?, error = ?, question = ?,
          pending_input_id = ?, pending_input = ?, updated_at = ?, approval_expires_at = ?
        where id = ?`,
      )
      .run(
        task.state,
        task.approved ? 1 : 0,
        task.result,
        task.error,
        task.question,
        task.pendingInputId,
        task.pendingInput,
        task.updatedAt,
        task.approvalExpiresAt,
        task.id,
      );
  }

  recentTasks(limit: number): Task[] {
    return all<TaskRow>(this.db.prepare('select * from tasks order by updated_at desc, id desc limit ?'), limit)
      .map(mapTask)
      .reverse();
  }

  openTasks(machineId: string): Task[] {
    return all<TaskRow>(
      this.db.prepare(
        `select * from tasks
         where machine_id = ?
         and state in ('queued', 'delivered', 'accepted', 'running', 'needs_input')
         order by created_at asc`,
      ),
      machineId,
    ).map(mapTask);
  }

  expiredApprovals(now: string): Task[] {
    return all<TaskRow>(
      this.db.prepare(
        `select * from tasks
         where state = 'needs_approval' and approval_expires_at is not null and approval_expires_at < ?`,
      ),
      now,
    ).map(mapTask);
  }

  addTaskEvent(taskId: string, state: TaskState, note: string | null, at: string): TaskEvent {
    const result = this.db
      .prepare('insert into task_events (task_id, state, note, created_at) values (?, ?, ?, ?)')
      .run(taskId, state, note, at);
    return { id: Number(result.lastInsertRowid), taskId, state, note, createdAt: at };
  }

  taskEventsFor(ids: readonly string[]): TaskEvent[] {
    if (ids.length === 0) return [];
    const marks = ids.map(() => '?').join(', ');
    return all<TaskEventRow>(
      this.db.prepare(`select * from task_events where task_id in (${marks}) order by id asc`),
      ...ids,
    ).map(mapTaskEvent);
  }

  fanout(event: Omit<FanEvent, 'cursor'>): FanEvent {
    const result = this.db
      .prepare('insert into fanout (type, payload, created_at) values (?, ?, ?)')
      .run(event.type, JSON.stringify(event), nowIso());
    return { ...event, cursor: Number(result.lastInsertRowid) };
  }

  eventsSince(cursor: number): FanEvent[] {
    const rows = all<{ id: number; payload: string }>(
      this.db.prepare('select id, payload from fanout where id > ? order by id asc limit 500'),
      cursor,
    );
    return rows.map((row) => ({ ...(JSON.parse(row.payload) as Omit<FanEvent, 'cursor'>), cursor: row.id }));
  }

  cursor(): number {
    const row = get<{ cursor: number }>(this.db.prepare('select coalesce(max(id), 0) as cursor from fanout'));
    return row?.cursor ?? 0;
  }

  savePush(userId: string, endpoint: string, p256dh: string, auth: string): void {
    this.db.prepare('delete from push_subs where endpoint = ?').run(endpoint);
    this.db
      .prepare('insert into push_subs (id, user_id, endpoint, p256dh, auth, created_at) values (?, ?, ?, ?, ?, ?)')
      .run(newId('psh'), userId, endpoint, p256dh, auth, nowIso());
  }

  deletePush(endpoint: string): void {
    this.db.prepare('delete from push_subs where endpoint = ?').run(endpoint);
  }

  pushesFor(userIds: readonly string[]): PushSub[] {
    if (userIds.length === 0) return [];
    const marks = userIds.map(() => '?').join(', ');
    return all<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }>(
      this.db.prepare(`select * from push_subs where user_id in (${marks})`),
      ...userIds,
    ).map((row) => ({
      id: row.id,
      userId: row.user_id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
    }));
  }
}
