import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { Assign } from '../protocol/types.js';
import { AgentDaemon, type DaemonTransport } from './daemon.js';
import { RunStore } from './local.js';
import { askingRunner, echoRunner } from './runners.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function store(): RunStore {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pitwall-daemon-'));
  dirs.push(dir);
  return RunStore.open(path.join(dir, 'runs.sqlite'));
}

function assign(extra: Partial<Assign> = {}): Assign {
  return {
    id: 'task_1',
    state: 'queued',
    mode: 'talk',
    body: 'Read this.',
    agentId: 'agt_1',
    agentName: 'coder',
    machineId: 'mch_1',
    requesterName: 'Ada',
    approved: true,
    hop: 0,
    pendingInputId: null,
    pendingInput: null,
    ...extra,
  };
}

function transport(): { calls: Record<string, unknown>[]; transport: DaemonTransport } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    transport: {
      async request(message) {
        calls.push(message);
      },
    },
  };
}

test('a second delivery does not run the echo twice', async () => {
  const runs = store();
  const counter = { n: 0 };
  const wire = transport();
  const daemon = new AgentDaemon({
    agents: ['coder'],
    runner: echoRunner(counter),
    runs,
    allowWork: true,
    transport: wire.transport,
  });
  const first = assign();
  await daemon.handleAssign(first);
  await daemon.handleAssign(first);
  expect(counter.n).toBe(1);
  expect(wire.calls.filter((call) => call.state === 'completed')).toHaveLength(1);
  runs.close();
});

test('a row left running becomes uncertain and is not started again', async () => {
  const runs = store();
  runs.save('task_1', { state: 'running' });
  const counter = { n: 0 };
  const wire = transport();
  const daemon = new AgentDaemon({
    agents: ['coder'],
    runner: echoRunner(counter),
    runs,
    allowWork: true,
    transport: wire.transport,
  });
  await daemon.handleAssign(assign());
  expect(counter.n).toBe(0);
  expect(wire.calls.map((call) => call.state)).toEqual(['uncertain']);
  expect(runs.get('task_1')?.state).toBe('uncertain');
  runs.close();
});

test('a follow-up answer continues the same task', async () => {
  const runs = store();
  const wire = transport();
  const daemon = new AgentDaemon({
    agents: ['coder'],
    runner: askingRunner(),
    runs,
    allowWork: true,
    transport: wire.transport,
  });
  await daemon.handleAssign(assign());
  expect(wire.calls.at(-1)).toMatchObject({ state: 'needs_input', question: 'Which file should I open?' });
  await daemon.handleAssign(assign({ state: 'queued', pendingInputId: 'msg_2', pendingInput: 'README.md' }));
  expect(wire.calls.at(-1)).toMatchObject({ state: 'completed', result: 'Answer noted: README.md' });
  runs.close();
});

test('a saved result is replayed when the claim is already taken', async () => {
  const runs = store();
  runs.save('task_1', { state: 'completed', result: 'Already done.' });
  const counter = { n: 0 };
  const wire = transport();
  const daemon = new AgentDaemon({
    agents: ['coder'],
    runner: echoRunner(counter),
    runs,
    allowWork: true,
    transport: wire.transport,
  });
  await daemon.handleAssign(assign());
  expect(counter.n).toBe(0);
  expect(wire.calls.at(-1)).toMatchObject({ state: 'completed', result: 'Already done.' });
  runs.close();
});

test('work is refused locally when the daemon is not accepting it', async () => {
  const runs = store();
  const counter = { n: 0 };
  const wire = transport();
  const daemon = new AgentDaemon({
    agents: ['coder'],
    runner: echoRunner(counter),
    runs,
    allowWork: false,
    transport: wire.transport,
  });
  await daemon.handleAssign(assign({ mode: 'work', approved: true }));
  expect(counter.n).toBe(0);
  expect(wire.calls.at(-1)).toMatchObject({ state: 'failed', error: 'This machine is not accepting work.' });
  runs.close();
});
