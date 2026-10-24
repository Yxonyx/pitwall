import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { Message, Snapshot } from './protocol/types.js';
import { startPitwall, type PitwallServer } from './relay/server.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function call(base: string, route: string, body: unknown, token?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function messages(base: string, token: string): Promise<Message[]> {
  const response = await fetch(`${base}/api/snapshot`, { headers: { authorization: `Bearer ${token}` } });
  return ((await response.json()) as Snapshot).messages;
}

test('a bot talks in the room as an agent, and can neither ask for work nor invite nor approve', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pitwall-bot-'));
  const server: PitwallServer = await startPitwall({ dataDir: path.join(dir, 'relay'), host: '127.0.0.1', port: 0, web: null });
  cleanup.push(() => server.close());

  const owner = await call(server.url, '/api/join', { invite: server.room.bootstrapOwnerInvite().code, kind: 'person', name: 'Owner' });
  const ownerToken = owner.json.token as string;
  const machineInvite = await call(server.url, '/api/invites', { kind: 'machine' }, ownerToken);
  await call(server.url, '/api/join', {
    invite: machineInvite.json.code,
    kind: 'machine',
    name: 'backend',
    agents: [{ name: 'coder', runtime: 'echo' }],
  });
  const botInvite = await call(server.url, '/api/invites', { kind: 'person', role: 'bot' }, ownerToken);
  expect(botInvite.json.role).toBe('bot');
  const bot = await call(server.url, '/api/join', { invite: botInvite.json.code, kind: 'person', name: 'Helper' });
  const botToken = bot.json.token as string;
  expect((bot.json.user as { role: string }).role).toBe('bot');

  const said = await call(server.url, '/api/say', { body: 'Build is green.', clientId: 'bot-line-0001' }, botToken);
  expect(said.status).toBe(200);
  expect(said.json.duplicate).toBe(false);
  const again = await call(server.url, '/api/say', { body: 'Build is green.', clientId: 'bot-line-0001' }, botToken);
  expect(again.json.duplicate).toBe(true);

  const seen = (await messages(server.url, ownerToken)).filter((message) => message.body === 'Build is green.');
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ senderKind: 'agent', senderName: 'Helper' });

  const asksAgent = await call(server.url, '/api/say', { body: '@coder please edit the repo' }, botToken);
  expect(asksAgent.status).toBe(403);
  const invite = await call(server.url, '/api/invites', { kind: 'person', role: 'owner' }, botToken);
  expect(invite.status).toBe(403);
  expect((await messages(server.url, ownerToken)).some((message) => message.body.includes('please edit the repo'))).toBe(false);
});

test('an anonymous caller cannot say anything', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pitwall-bot-'));
  const server: PitwallServer = await startPitwall({ dataDir: path.join(dir, 'relay'), host: '127.0.0.1', port: 0, web: null });
  cleanup.push(() => server.close());
  const said = await call(server.url, '/api/say', { body: 'hello' });
  expect(said.status).toBe(401);
});
