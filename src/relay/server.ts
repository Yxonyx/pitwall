import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { ProtocolError, httpStatus } from '../protocol/errors.js';
import type { Assign, Task } from '../protocol/types.js';
import { Hub } from './hub.js';
import type { PushSender } from './push.js';
import { fetchLatestRadio } from './radio.js';
import { Room } from './room.js';
import { Store } from './store.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

export interface PitwallServer {
  url: string;
  port: number;
  room: Room;
  store: Store;
  close: () => Promise<void>;
}

export function webRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/web');
}

export async function startPitwall(options: {
  dataDir: string;
  host?: string;
  port?: number;
  push?: PushSender | null;
  pushPublicKey?: string | null;
  radioRepo?: string | null;
  gh?: (args: string[]) => Promise<string>;
  web?: string | null;
}): Promise<PitwallServer> {
  const store = Store.open(options.dataDir);
  const hub = new Hub();
  const room = new Room(store, hub, options.push === undefined ? null : options.push);
  const root = options.web === undefined ? webRoot() : options.web;
  const server = createServer((req, res) => {
    void handle(req, res, room, root, options.pushPublicKey ?? null).catch((error) => fail(res, error));
  });
  const sockets = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/ws' && url.pathname !== '/api/machine') {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      if (url.pathname === '/api/machine') attachMachine(ws, room, hub);
      else attachPerson(ws, room, hub);
    });
  });

  const sweeper = setInterval(() => {
    room.expireApprovals();
    for (const machine of store.machines()) {
      if (!machine.online || !machine.lastSeenAt) continue;
      if (Date.now() - Date.parse(machine.lastSeenAt) > 45_000 && !hub.machine(machine.id)) {
        room.disconnectMachine(machine.id);
      }
    }
  }, 15_000);
  sweeper.unref();

  let radioTimer: NodeJS.Timeout | null = null;
  if (options.radioRepo && options.gh) {
    const repo = options.radioRepo;
    const gh = options.gh;
    const poll = () => {
      void fetchLatestRadio(repo, gh)
        .then((comments) => room.ingestMirror(repo, comments))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'radio poll failed';
          console.error(`Radio mirror: ${message}`);
        });
    };
    poll();
    radioTimer = setInterval(poll, 90_000);
    radioTimer.unref();
  }

  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Pitwall could not listen.');

  return {
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`,
    port: address.port,
    room,
    store,
    close: async () => {
      clearInterval(sweeper);
      if (radioTimer) clearInterval(radioTimer);
      hub.closeAll();
      sockets.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

function attachPerson(socket: WebSocket, room: Room, hub: Hub): void {
  let userId = '';
  const timer = setTimeout(() => socket.close(), 5_000);
  let chain = Promise.resolve();
  socket.on('message', (data) => {
    chain = chain
      .then(async () => {
        const message = parseMessage(data);
        if (!userId) {
          if (message.type !== 'auth' || typeof message.token !== 'string') {
            socket.close();
            return;
          }
          const user = room.userByToken(message.token);
          if (!user) {
            socket.send(JSON.stringify({ type: 'error', error: 'Sign in again.' }));
            socket.close();
            return;
          }
          clearTimeout(timer);
          userId = user.id;
          hub.addPerson(user.id, socket);
          room.connectPerson(user.id);
          socket.send(JSON.stringify({ type: 'authed' }));
          const since = typeof message.since === 'number' ? message.since : 0;
          for (const event of room.eventsSince(since)) socket.send(JSON.stringify({ type: 'event', event }));
          return;
        }
        const live = room.person(userId);
        if (!live) return;
        if (message.type === 'send') {
          const result = room.send(live, {
            clientId: message.clientId,
            body: message.body,
            mode: message.mode,
            agentId: message.agentId,
          });
          socket.send(JSON.stringify({ type: 'ack', clientId: message.clientId, duplicate: result.duplicate }));
        } else if (message.type === 'approve' && typeof message.taskId === 'string') {
          room.approve(live, message.taskId);
          socket.send(JSON.stringify({ type: 'ack', clientId: message.taskId, duplicate: false }));
        } else if (message.type === 'reject' && typeof message.taskId === 'string') {
          room.reject(live, message.taskId);
        } else if (message.type === 'answer' && typeof message.taskId === 'string') {
          room.answer(live, message.taskId, message.clientId, message.body);
        } else if (message.type === 'cancel' && typeof message.taskId === 'string') {
          room.cancel(live, message.taskId);
        }
      })
      .catch((error: unknown) => {
        socket.send(JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : 'Request failed.' }));
      });
  });
  socket.on('close', () => {
    clearTimeout(timer);
    if (!userId) return;
    const last = hub.removePerson(userId, socket);
    if (last) room.disconnectPerson(userId);
  });
}

function attachMachine(socket: WebSocket, room: Room, hub: Hub): void {
  let machineId = '';
  const timer = setTimeout(() => socket.close(), 5_000);
  let chain = Promise.resolve();
  socket.on('message', (data) => {
    chain = chain
      .then(async () => {
        const message = parseMessage(data);
        if (!machineId) {
          if (message.type !== 'auth' || typeof message.token !== 'string') {
            socket.close();
            return;
          }
          const machine = room.machineByToken(message.token);
          if (!machine) {
            socket.close();
            return;
          }
          clearTimeout(timer);
          machineId = machine.id;
          hub.setMachine(machine.id, socket);
          room.connectMachine(machine.id);
          socket.send(JSON.stringify({ type: 'authed', machine }));
          return;
        }
        try {
          if (message.type === 'hello') {
            const tasks = room.hello(machineId, message.agents);
            for (const task of tasks) sendAssign(socket, task);
          } else if (message.type === 'heartbeat') {
            room.heartbeat(machineId);
          } else if (message.type === 'progress') {
            room.progress(machineId, {
            taskId: message.taskId,
            state: message.state,
            result: message.result,
            error: message.error,
            question: message.question,
          });
            socket.send(JSON.stringify({ type: 'progress.ok', taskId: message.taskId, state: message.state }));
          }
        } catch (error) {
          socket.send(
            JSON.stringify({
              type: 'error',
              taskId: message.taskId,
              state: message.state,
              error: error instanceof Error ? error.message : 'Progress failed.',
            }),
          );
        }
      })
      .catch((error: unknown) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : 'Request failed.' }));
        }
      });
  });
  socket.on('close', () => {
    clearTimeout(timer);
    if (!machineId || hub.machine(machineId) !== socket) return;
    hub.clearMachine(machineId, socket);
    room.disconnectMachine(machineId);
  });
}

function sendAssign(socket: WebSocket, task: Task): void {
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
  socket.send(JSON.stringify({ type: 'assign', task: payload }));
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  room: Room,
  root: string | null,
  pushPublicKey: string | null,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    await api(req, res, room, url, pushPublicKey);
    return;
  }
  serveStatic(req, res, root, url.pathname);
}

async function api(
  req: IncomingMessage,
  res: ServerResponse,
  room: Room,
  url: URL,
  pushPublicKey: string | null,
): Promise<void> {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    send(res, 200, { ok: true });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/push/key') {
    send(res, 200, { publicKey: pushPublicKey });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/join') {
    const body = await readJson(req);
    const record = asRecord(body);
    const invite = stringField(record, 'invite');
    const kind = record.kind === 'machine' ? 'machine' : 'person';
    if (kind === 'machine') {
      const joined = room.joinMachine(invite, record.name, record.agents);
      send(res, 200, joined);
      return;
    }
    const joined = room.joinPerson(invite, record.name);
    send(res, 200, joined);
    return;
  }
  const user = bearer(req, room);
  if (req.method === 'GET' && url.pathname === '/api/snapshot') {
    send(res, 200, room.snapshot(user));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/invites') {
    const body = asRecord(await readJson(req));
    send(res, 200, room.createInvite(user, body.kind, body.role));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/push/subscribe') {
    room.savePush(user, await readJson(req));
    send(res, 200, { ok: true });
    return;
  }
  throw new ProtocolError('not_found', 'Not found.');
}

function bearer(req: IncomingMessage, room: Room) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? room.userByToken(token) : undefined;
  if (!user) throw new ProtocolError('unauthorized', 'Sign in again.');
  return user;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, root: string | null, pathname: string): void {
  if (!root || !existsSync(root)) {
    send(res, 503, { error: 'The web app is not built yet. Run pnpm build.' });
    return;
  }
  const asked = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(root, asked));
  if (file !== root && !file.startsWith(root + path.sep)) {
    send(res, 404, { error: 'Not found.' });
    return;
  }
  const exists = existsSync(file) && statSync(file).isFile();
  const target = exists ? file : path.extname(asked) ? '' : path.join(root, 'index.html');
  if (!target) {
    send(res, 404, { error: 'Not found.' });
    return;
  }
  if (!existsSync(target)) {
    send(res, 404, { error: 'Not found.' });
    return;
  }
  const ext = path.extname(target);
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    // Vite's hashed files never change; the icons, the manifest and the page keep their names, so they must be checked.
    'cache-control': target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 65_536) throw new ProtocolError('too_large', 'Request is too large.');
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ProtocolError('bad_message', 'The body is not JSON.');
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProtocolError('bad_message', 'Expected an object.');
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) throw new ProtocolError('bad_message', `Missing ${key}.`);
  return value.trim();
}

function parseMessage(data: WebSocket.RawData): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(data.toString()));
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError('bad_message', 'The message is not JSON.');
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(raw);
}

function fail(res: ServerResponse, error: unknown): void {
  if (res.headersSent) return;
  if (error instanceof ProtocolError) {
    send(res, httpStatus(error.code), { error: error.message });
    return;
  }
  send(res, 500, { error: 'Something went wrong.' });
}

