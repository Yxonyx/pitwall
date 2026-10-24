import { describe, expect, test } from 'vitest';
import { decideReplay, type LocalRun } from './decide.js';

function run(state: LocalRun['state'], extra: Partial<LocalRun> = {}): LocalRun {
  return {
    state,
    result: null,
    error: null,
    question: null,
    lastInputId: null,
    sessionId: null,
    ...extra,
  };
}

describe('decideReplay', () => {
  test('starts when this machine has no row', () => {
    expect(decideReplay(null, null)).toEqual({ kind: 'start' });
  });

  test('replays a saved result and refuses a completed row with no result', () => {
    expect(decideReplay(run('completed', { result: 'Done.' }), null)).toEqual({ kind: 'replay', state: 'completed', note: 'Done.' });
    expect(decideReplay(run('completed'), null)).toEqual({ kind: 'replay', state: 'failed', note: 'The result was lost on this machine.' });
  });

  test('does not restart a crash, a cancel, or a question that was already asked', () => {
    expect(decideReplay(run('running'), null).kind).toBe('uncertain');
    expect(decideReplay(run('cancelled'), null).kind).toBe('ignore');
    expect(decideReplay(run('uncertain'), null).kind).toBe('ignore');
    expect(decideReplay(run('needs_input', { lastInputId: 'm1' }), 'm1').kind).toBe('ignore');
    expect(decideReplay(run('needs_input', { lastInputId: 'm1' }), 'm2').kind).toBe('followup');
  });
});
