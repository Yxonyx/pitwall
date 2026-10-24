import { describe, expect, test } from 'vitest';
import { claudeArgv, outcomeFromClaude, parseClaudeOutput, type ClaudeTask } from './claude.js';

function task(mode: ClaudeTask['mode']): ClaudeTask {
  return {
    mode,
    body: 'Look at the readme.',
    agentName: 'coder',
    requesterName: 'Ada',
    input: null,
    sessionId: null,
    taskId: 'task_1',
  };
}

describe('claude runner arguments', () => {
  test('talk plans and work accepts edits, without a permission bypass', () => {
    const talk = claudeArgv(task('talk')).join(' ');
    const work = claudeArgv({ ...task('work'), sessionId: 'sess_1' }).join(' ');
    expect(talk).toContain('--permission-mode plan');
    expect(work).toContain('--permission-mode acceptEdits');
    expect(work).toContain('--resume sess_1');
    expect(talk).not.toContain('dangerously-skip-permissions');
    expect(work).not.toContain('bypassPermissions');
    expect(talk).toContain('--permission-prompts none');
  });

  test('reads a JSON result, a question line, and an error', () => {
    expect(parseClaudeOutput('{"result":"Noted.","session_id":"sess_9","is_error":false}')).toEqual({
      text: 'Noted.',
      sessionId: 'sess_9',
      isError: false,
    });
    const question = outcomeFromClaude({
      text: 'I looked.\nRAJ_NEEDS_INPUT: Which file?',
      sessionId: 'sess_9',
      isError: false,
    });
    expect(question).toMatchObject({ type: 'needs_input', question: 'Which file?' });
    expect(outcomeFromClaude({ text: '', sessionId: null, isError: false }).type).toBe('failed');
    expect(outcomeFromClaude({ text: 'nope', sessionId: null, isError: true })).toMatchObject({ type: 'failed', error: 'nope' });
  });
});
