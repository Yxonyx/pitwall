import os from 'node:os';
import path from 'node:path';

export type RunnerName = 'echo' | 'claude';

export type Command =
  | { kind: 'help' }
  | { kind: 'relay-init'; dataDir: string }
  | { kind: 'relay-start'; dataDir: string; host: string; port: number }
  | { kind: 'relay-recover'; dataDir: string }
  | { kind: 'relay-radio'; dataDir: string; repo: string }
  | {
      kind: 'daemon-join';
      url: string;
      invite: string;
      name: string;
      agents: string[];
      runner: RunnerName;
      project?: string;
      allowWork: boolean;
      home: string;
    }
  | { kind: 'daemon-start'; name?: string; home: string };

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const SLUG = /^[a-z][a-z0-9-]{0,30}$/;

export function parseArgs(argv: string[], env: { home?: string; cwd?: string } = {}): Command {
  const homeDir = env.home ?? os.homedir();
  const cwd = env.cwd ?? process.cwd();
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') return { kind: 'help' };
  const [group, action, ...rest] = argv;
  if (!group || !action) throw new UsageError('Unknown command. Run raj --help.');
  if (group === 'relay' && action === 'init') {
    const { flags } = tokenize(rest, ['data'], []);
    return { kind: 'relay-init', dataDir: resolveDir(cwd, one(flags, 'data') ?? 'data') };
  }
  if (group === 'relay' && action === 'start') {
    const { flags } = tokenize(rest, ['data', 'host', 'port'], []);
    return {
      kind: 'relay-start',
      dataDir: resolveDir(cwd, one(flags, 'data') ?? 'data'),
      host: one(flags, 'host') ?? '127.0.0.1',
      port: portOf(one(flags, 'port') ?? '8787'),
    };
  }
  if (group === 'relay' && action === 'recover') {
    const { flags } = tokenize(rest, ['data'], []);
    return { kind: 'relay-recover', dataDir: resolveDir(cwd, one(flags, 'data') ?? 'data') };
  }
  if (group === 'relay' && action === 'radio') {
    const { positionals, flags } = tokenize(rest, ['data'], []);
    const repo = positionals[0];
    if (!repo || positionals.length !== 1) throw new UsageError('Usage: raj relay radio owner/name');
    return { kind: 'relay-radio', dataDir: resolveDir(cwd, one(flags, 'data') ?? 'data'), repo };
  }
  if (group === 'daemon' && action === 'join') {
    const { positionals, flags, bools } = tokenize(rest, ['name', 'agent', 'runner', 'project', 'home'], ['no-work']);
    const url = positionals[0];
    const invite = positionals[1];
    if (!url || !invite || positionals.length !== 2) {
      throw new UsageError('Usage: raj daemon join <url> <invite> --name <machine> --agent <agent>');
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new UsageError('The room URL must start with http:// or https://.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new UsageError('The room URL must start with http:// or https://.');
    }
    const name = one(flags, 'name');
    if (!name || !SLUG.test(name) || name === 'all' || name === 'system') {
      throw new UsageError('Machine name must be lowercase, such as backend or mac-studio.');
    }
    const agents = flags.get('agent') ?? [];
    if (agents.length === 0) throw new UsageError('Name at least one agent with --agent.');
    for (const agent of agents) {
      if (!SLUG.test(agent) || agent === 'all' || agent === 'system') {
        throw new UsageError('Agent name must be lowercase, such as coder.');
      }
    }
    if (new Set(agents).size !== agents.length) throw new UsageError('Agent names on one machine must be unique.');
    const runner = (one(flags, 'runner') ?? 'echo') as string;
    if (runner !== 'echo' && runner !== 'claude') throw new UsageError('Runner must be echo or claude.');
    const project = one(flags, 'project');
    if (runner === 'claude' && !project) throw new UsageError('Claude needs --project, the folder it may edit.');
    return {
      kind: 'daemon-join',
      url: parsed.origin,
      invite,
      name,
      agents,
      runner,
      project,
      allowWork: !bools.has('no-work'),
      home: homePath(one(flags, 'home'), homeDir),
    };
  }
  if (group === 'daemon' && action === 'start') {
    const { positionals, flags } = tokenize(rest, ['name', 'home'], []);
    if (positionals.length > 0) throw new UsageError('Usage: raj daemon start --name <machine>');
    return {
      kind: 'daemon-start',
      name: one(flags, 'name'),
      home: homePath(one(flags, 'home'), homeDir),
    };
  }
  throw new UsageError('Unknown command. Run raj --help.');
}

export function helpText(): string {
  return [
    'Raj is a shared room for people and the coding agents on their machines.',
    '',
    'Relay',
    '  raj relay init [--data dir]',
    '  raj relay start [--data dir] [--host 127.0.0.1] [--port 8787]',
    '  raj relay recover [--data dir]',
    '  raj relay radio owner/name [--data dir]',
    '',
    'Daemon, on each machine that runs an agent',
    '  raj daemon join <url> <invite> --name <machine> --agent <agent> [--agent <agent>]',
    '      [--runner echo|claude] [--project dir] [--no-work] [--home dir]',
    '  raj daemon start [--name <machine>] [--home dir]',
    '',
    'The default runner is echo. It changes nothing. Claude edits files only after an owner approves work.',
  ].join('\n');
}

function tokenize(
  args: string[],
  allowed: readonly string[],
  boolsAllowed: readonly string[],
): { positionals: string[]; flags: Map<string, string[]>; bools: Set<string> } {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) continue;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (!name) throw new UsageError('Unknown flag.');
    if (boolsAllowed.includes(name)) {
      bools.add(name);
      continue;
    }
    if (!allowed.includes(name)) throw new UsageError(`Unknown flag --${name}.`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new UsageError(`Missing value for --${name}.`);
    index += 1;
    const list = flags.get(name) ?? [];
    list.push(value);
    flags.set(name, list);
  }
  return { positionals, flags, bools };
}

function one(flags: Map<string, string[]>, name: string): string | undefined {
  const list = flags.get(name);
  if (!list || list.length === 0) return undefined;
  if (list.length > 1) throw new UsageError(`Use --${name} once.`);
  return list[0];
}

function homePath(value: string | undefined, homeDir: string): string {
  if (!value) return path.join(homeDir, '.raj');
  if (value.startsWith('~')) return path.resolve(os.homedir(), value.slice(1).replace(/^\//, ''));
  return path.resolve(value);
}

function resolveDir(base: string, value: string): string {
  if (value.startsWith('~')) return path.resolve(os.homedir(), value.slice(1).replace(/^\//, ''));
  return path.resolve(base, value);
}

function portOf(value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError('Port must be a number.');
  const port = Number(value);
  if (port < 1 || port > 65535) throw new UsageError('Port must be from 1 to 65535.');
  return port;
}
