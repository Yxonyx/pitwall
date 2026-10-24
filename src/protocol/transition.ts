import { ProtocolError } from './errors.js';
import type { TaskState } from './types.js';

export const ALLOWED: Record<TaskState, readonly TaskState[]> = {
  queued: ['delivered', 'cancelled', 'failed', 'uncertain'],
  needs_approval: ['queued', 'cancelled', 'failed'],
  delivered: ['accepted', 'failed', 'cancelled', 'uncertain'],
  accepted: ['running', 'failed', 'cancelled', 'uncertain'],
  running: ['needs_input', 'completed', 'failed', 'cancelled', 'uncertain'],
  needs_input: ['queued', 'cancelled', 'failed'],
  uncertain: ['failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

const LANE: readonly TaskState[] = ['queued', 'delivered', 'accepted', 'running'];

export interface MoveDetail {
  result?: string | null;
  error?: string | null;
  question?: string | null;
}

export function assertTransition(from: TaskState, to: TaskState, detail: MoveDetail = {}): void {
  if (from !== to && !ALLOWED[from].includes(to)) {
    throw new ProtocolError('invalid_state', `A task cannot move from ${from} to ${to}.`);
  }
  if (to === 'completed' && from !== 'completed' && !detail.result?.trim()) {
    throw new ProtocolError('invalid_state', 'A finished task needs a result.');
  }
  if (to === 'failed' && from !== 'failed' && !detail.error?.trim()) {
    throw new ProtocolError('invalid_state', 'A failed task needs a reason.');
  }
  if (to === 'needs_input' && from !== 'needs_input' && !detail.question?.trim()) {
    throw new ProtocolError('invalid_state', 'A question needs the question text.');
  }
}

export function stepsTo(from: TaskState, to: TaskState): TaskState[] {
  if (from === to) return [];
  const fromIndex = LANE.indexOf(from);
  const toIndex = LANE.indexOf(to);
  if (fromIndex !== -1 && toIndex !== -1) {
    if (toIndex < fromIndex) {
      throw new ProtocolError('invalid_state', `A task cannot move from ${from} to ${to}.`);
    }
    return LANE.slice(fromIndex + 1, toIndex + 1);
  }
  if (fromIndex !== -1 && (to === 'completed' || to === 'needs_input')) {
    return [...LANE.slice(fromIndex + 1), to];
  }
  if (ALLOWED[from].includes(to)) return [to];
  throw new ProtocolError('invalid_state', `A task cannot move from ${from} to ${to}.`);
}
