import { describe, expect, test } from 'vitest';
import { parseArgs, UsageError } from './args.js';

const env = { home: '/Users/ada', cwd: '/work/pitwall' };

describe('parseArgs', () => {
  test('defaults the relay to this machine only', () => {
    expect(parseArgs(['relay', 'start'], env)).toEqual({
      kind: 'relay-start',
      dataDir: '/work/pitwall/data',
      host: '127.0.0.1',
      port: 8787,
    });
  });

  test('parses a daemon join', () => {
    expect(
      parseArgs(
        ['daemon', 'join', 'http://127.0.0.1:8787/room', 'join_abc', '--name', 'backend', '--agent', 'coder', '--agent', 'review'],
        env,
      ),
    ).toMatchObject({
      kind: 'daemon-join',
      url: 'http://127.0.0.1:8787',
      invite: 'join_abc',
      name: 'backend',
      agents: ['coder', 'review'],
      runner: 'echo',
      allowWork: true,
      home: '/Users/ada/.pitwall',
    });
  });

  test('claude requires a project and --no-work is explicit', () => {
    expect(() => parseArgs(['daemon', 'join', 'http://localhost:8787', 'join_abc', '--name', 'backend', '--agent', 'coder', '--runner', 'claude'], env)).toThrow(
      UsageError,
    );
    const command = parseArgs(
      ['daemon', 'join', 'https://pitwall.example', 'join_abc', '--name', 'backend', '--agent', 'coder', '--runner', 'claude', '--project', '/src/app', '--no-work'],
      env,
    );
    expect(command).toMatchObject({ runner: 'claude', project: '/src/app', allowWork: false });
  });

  test('rejects a bad radio command and an unknown flag', () => {
    expect(() => parseArgs(['relay', 'radio'], env)).toThrow(UsageError);
    expect(() => parseArgs(['relay', 'init', '--no-work'], env)).toThrow(UsageError);
  });

  test('parses a bot joining, saying and reading', () => {
    expect(parseArgs(['member', 'join', 'http://127.0.0.1:8787', 'join_abc', '--name', 'Helper Bot'], env)).toEqual({
      kind: 'member-join',
      url: 'http://127.0.0.1:8787',
      invite: 'join_abc',
      name: 'Helper Bot',
      home: '/Users/ada/.pitwall',
    });
    expect(parseArgs(['say', 'build', 'is', 'green', '--as', 'helper-bot'], env)).toEqual({
      kind: 'say',
      text: 'build is green',
      as: 'helper-bot',
      home: '/Users/ada/.pitwall',
    });
    expect(parseArgs(['read', '--limit', '5'], env)).toEqual({ kind: 'read', as: undefined, limit: 5, home: '/Users/ada/.pitwall' });
  });

  test('refuses an empty say and a limit that is not a number', () => {
    expect(() => parseArgs(['say'], env)).toThrow(UsageError);
    expect(() => parseArgs(['read', '--limit', 'many'], env)).toThrow(UsageError);
  });
});
