import type { TaskMode } from '../protocol/types.js';
import { claudePrompt, runClaude, type ClaudeTask } from './claude.js';

export interface RunRequest {
  id: string;
  mode: TaskMode;
  body: string;
  agentName: string;
  requesterName: string;
  input: string | null;
  sessionId: string | null;
}

export interface RunContext {
  cwd?: string;
  signal: AbortSignal;
}

export type RunOutcome =
  | { type: 'completed'; result: string; sessionId?: string | null }
  | { type: 'needs_input'; question: string; result?: string; sessionId?: string | null }
  | { type: 'failed'; error: string };

export interface Runner {
  id: string;
  run(task: RunRequest, context: RunContext): Promise<RunOutcome>;
}

export function echoRunner(counter?: { n: number }): Runner {
  return {
    id: 'echo',
    async run(task, context) {
      if (counter) counter.n += 1;
      if (context.signal.aborted) return { type: 'failed', error: 'Cancelled.' };
      if (task.mode === 'work') {
        return {
          type: 'completed',
          result: `Echo finished the work. No files were changed.\n\n${task.body}`,
        };
      }
      const follow = task.input ? `\n\nFollow-up: ${task.input}` : '';
      return {
        type: 'completed',
        result: `Echo read this and changed nothing.\n\n${task.body}${follow}`,
      };
    },
  };
}

export function askingRunner(): Runner {
  return {
    id: 'echo',
    async run(task) {
      if (task.input) return { type: 'completed', result: `Answer noted: ${task.input}` };
      return { type: 'needs_input', question: 'Which file should I open?', result: 'I need a file name before I continue.' };
    },
  };
}

export function claudeRunner(): Runner {
  return {
    id: 'claude',
    async run(task, context) {
      if (!context.cwd) {
        return { type: 'failed', error: 'This machine has no project folder. Start it with --project.' };
      }
      const timeout = AbortSignal.timeout(task.mode === 'work' ? 15 * 60_000 : 3 * 60_000);
      const signal = AbortSignal.any([context.signal, timeout]);
      const claudeTask: ClaudeTask = {
        mode: task.mode,
        body: task.body,
        agentName: task.agentName,
        requesterName: task.requesterName,
        input: task.input,
        sessionId: task.sessionId,
        taskId: task.id,
      };
      const outcome = await runClaude(claudeTask, { cwd: context.cwd, signal });
      if (timeout.aborted && !context.signal.aborted) {
        return { type: 'failed', error: 'Claude took too long.' };
      }
      if (context.signal.aborted) return { type: 'failed', error: 'Cancelled.' };
      if (outcome.type === 'needs_input') {
        return { type: 'needs_input', question: outcome.question, result: outcome.result, sessionId: outcome.sessionId };
      }
      if (outcome.type === 'failed') return outcome;
      return { type: 'completed', result: outcome.result, sessionId: outcome.sessionId };
    },
  };
}

export function runnerByName(name: string): Runner {
  if (name === 'claude') return claudeRunner();
  if (name === 'echo') return echoRunner();
  throw new Error('Runner must be echo or claude.');
}

export { claudePrompt };
