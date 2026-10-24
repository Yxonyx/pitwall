#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentDaemon } from '../daemon/daemon.js';
import { RunStore } from '../daemon/local.js';
import { runnerByName } from '../daemon/runners.js';
import { createConfig, readConfig, writeConfig, type RelayConfig } from '../relay/config.js';
import { Hub } from '../relay/hub.js';
import { webPushSender } from '../relay/push.js';
import { assertRepo } from '../relay/radio.js';
import { Room } from '../relay/room.js';
import { startRaj } from '../relay/server.js';
import { Store } from '../relay/store.js';
import { helpText, parseArgs, UsageError, type Command } from './args.js';

interface DaemonFile {
  url: string;
  token: string;
  name: string;
  agents: string[];
  runner: 'echo' | 'claude';
  project: string | null;
  allowWork: boolean;
}

export async function main(argv: string[]): Promise<void> {
  const command = parseArgs(argv);
  if (command.kind === 'help') {
    console.log(helpText());
    return;
  }
  if (command.kind === 'relay-init') {
    await initRelay(command.dataDir);
    return;
  }
  if (command.kind === 'relay-recover') {
    recoverRelay(command.dataDir);
    return;
  }
  if (command.kind === 'relay-radio') {
    setRadio(command.dataDir, command.repo);
    return;
  }
  if (command.kind === 'relay-start') {
    await startRelay(command.dataDir, command.host, command.port);
    return;
  }
  if (command.kind === 'daemon-join') {
    await joinDaemon(command);
    return;
  }
  await startDaemon(command.home, command.name);
}

async function initRelay(dataDir: string): Promise<void> {
  await createConfig(dataDir);
  const invite = mintOwner(dataDir);
  console.log('Raj is initialized.');
  console.log(`Owner invite, valid until ${invite.expiresAt}:`);
  console.log(invite.code);
  console.log('Give this to the first person once. It is also in data/owner-invite.txt on this machine.');
  console.log('Next: raj relay start');
}

function recoverRelay(dataDir: string): void {
  readConfig(dataDir);
  const store = Store.open(dataDir);
  try {
    if (store.userCount() > 0) {
      console.log('Someone has already joined. Create the next invite from People.');
      return;
    }
  } finally {
    store.close();
  }
  const invite = mintOwner(dataDir);
  console.log('No one has joined yet. A new owner invite:');
  console.log(invite.code);
  console.log(`Valid until ${invite.expiresAt}.`);
}

function setRadio(dataDir: string, repo: string): void {
  assertRepo(repo);
  const config = readConfig(dataDir);
  const next: RelayConfig = { ...config, radioRepo: repo };
  writeConfig(dataDir, next);
  console.log(`Radio mirror set to ${repo}. Restart the relay to poll it.`);
  console.log('The mirror copies comments into the room. It does not create tasks.');
}

async function startRelay(dataDir: string, host: string, port: number): Promise<void> {
  const config = readConfig(dataDir);
  const server = await startRaj({
    dataDir,
    host,
    port,
    push: webPushSender(config.vapidPublicKey, config.vapidPrivateKey),
    pushPublicKey: config.vapidPublicKey,
    radioRepo: config.radioRepo,
    gh: config.radioRepo ? ghRunner : undefined,
  });
  const shown = host === '0.0.0.0' ? `http://127.0.0.1:${server.port}` : server.url;
  console.log(`Raj is on ${shown}`);
  if (host === '127.0.0.1' || host === 'localhost') {
    console.log('This address is only this computer. For a phone on the same network: raj relay start --host 0.0.0.0');
  } else {
    for (const address of lanAddresses()) console.log(`On this network: http://${address}:${server.port}`);
  }
  console.log('iPhone notifications need Raj on the Home Screen and an HTTPS address. The room itself works over HTTP while it is open.');
  if (server.store.userCount() === 0) {
    const file = path.join(dataDir, 'owner-invite.txt');
    if (existsSync(file)) {
      const code = readFileSync(file, 'utf8').trim();
      if (code) {
        console.log('No one has joined yet. Owner invite:');
        console.log(code);
      }
    }
  }
  const stop = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => undefined);
}

function mintOwner(dataDir: string): { code: string; expiresAt: string } {
  const store = Store.open(dataDir);
  const room = new Room(store, new Hub(), null);
  try {
    const invite = room.bootstrapOwnerInvite();
    const file = path.join(dataDir, 'owner-invite.txt');
    writeFileSync(file, `${invite.code}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    return invite;
  } finally {
    store.close();
  }
}

async function joinDaemon(command: Extract<Command, { kind: 'daemon-join' }>): Promise<void> {
  const dir = daemonDir(command.home);
  const file = path.join(dir, `${command.name}.json`);
  if (existsSync(file)) {
    throw new Error(`A daemon named ${command.name} is already configured. Run: raj daemon start --name ${command.name}`);
  }
  const response = await fetch(new URL('/api/join', command.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      invite: command.invite,
      kind: 'machine',
      name: command.name,
      agents: command.agents.map((name) => ({ name, runtime: command.runner })),
    }),
  });
  const body = (await response.json()) as { token?: string; error?: string };
  if (!response.ok || typeof body.token !== 'string') throw new Error(body.error || 'The room refused this invite.');
  const saved: DaemonFile = {
    url: command.url,
    token: body.token,
    name: command.name,
    agents: command.agents,
    runner: command.runner,
    project: command.project ?? null,
    allowWork: command.allowWork,
  };
  writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`Joined the room as ${command.name}.`);
  await listen(saved, command.home);
}

async function startDaemon(home: string, name: string | undefined): Promise<void> {
  await listen(loadDaemon(home, name), home);
}

async function listen(saved: DaemonFile, home: string): Promise<void> {
  const runsDir = path.join(home, 'runs');
  mkdirSync(runsDir, { recursive: true, mode: 0o700 });
  const runs = RunStore.open(path.join(runsDir, `${saved.name}.sqlite`));
  const daemon = new AgentDaemon({
    url: saved.url,
    token: saved.token,
    agents: saved.agents,
    runner: runnerByName(saved.runner),
    runs,
    allowWork: saved.allowWork,
    project: saved.project ?? undefined,
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log(`Listening as ${saved.name}. Press Ctrl-C to stop.`);
  try {
    await daemon.connectLoop(controller.signal);
  } finally {
    runs.close();
  }
}

function loadDaemon(home: string, name: string | undefined): DaemonFile {
  const dir = path.join(home, 'daemons');
  if (!name) {
    const files = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.json')) : [];
    if (files.length === 1) name = files[0]?.replace(/\.json$/, '');
    else if (files.length === 0) throw new Error('No daemon is configured. Run raj daemon join.');
    else throw new Error(`Name the daemon: ${files.map((file) => file.replace(/\.json$/, '')).join(', ')}`);
  }
  if (!name) throw new Error('Name the daemon with --name.');
  const file = path.join(dir, `${name}.json`);
  if (!existsSync(file)) throw new Error(`No daemon named ${name}. Run raj daemon join.`);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<DaemonFile>;
  if (typeof parsed.url !== 'string' || typeof parsed.token !== 'string' || !Array.isArray(parsed.agents)) {
    throw new Error('The daemon config is incomplete. Join the room again with a new machine name.');
  }
  if (parsed.runner !== 'echo' && parsed.runner !== 'claude') throw new Error('The daemon runner must be echo or claude.');
  return {
    url: parsed.url,
    token: parsed.token,
    name: parsed.name || name,
    agents: parsed.agents.filter((agent): agent is string => typeof agent === 'string'),
    runner: parsed.runner,
    project: typeof parsed.project === 'string' ? parsed.project : null,
    allowWork: parsed.allowWork !== false,
  };
}

function daemonDir(home: string): string {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  const dir = path.join(home, 'daemons');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

function lanAddresses(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      found.push(entry.address);
    }
  }
  return found;
}

function ghRunner(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 20_000, maxBuffer: 2_000_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Raj failed.';
    console.error(error instanceof UsageError ? message : message);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}
