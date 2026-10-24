export interface LocalRun {
  state: 'running' | 'needs_input' | 'completed' | 'failed' | 'uncertain' | 'cancelled';
  result: string | null;
  error: string | null;
  question: string | null;
  lastInputId: string | null;
  sessionId: string | null;
}

export type ReplayDecision =
  | { kind: 'start' }
  | { kind: 'followup' }
  | { kind: 'replay'; state: 'completed' | 'failed'; note: string }
  | { kind: 'uncertain' }
  | { kind: 'ignore' };

export function decideReplay(local: LocalRun | null, resumeInputId: string | null): ReplayDecision {
  if (!local) return { kind: 'start' };
  if (local.state === 'completed') {
    if (!local.result?.trim()) {
      return { kind: 'replay', state: 'failed', note: 'The result was lost on this machine.' };
    }
    return { kind: 'replay', state: 'completed', note: local.result };
  }
  if (local.state === 'failed') {
    return { kind: 'replay', state: 'failed', note: local.error?.trim() || 'The task failed.' };
  }
  if (local.state === 'uncertain' || local.state === 'cancelled') return { kind: 'ignore' };
  if (local.state === 'needs_input') {
    if (resumeInputId && resumeInputId !== local.lastInputId) return { kind: 'followup' };
    return { kind: 'ignore' };
  }
  return { kind: 'uncertain' };
}
