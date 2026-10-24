import type { Role } from './types.js';

export function canPost(role: Role): boolean {
  return role === 'owner' || role === 'peer' || role === 'bot';
}

/** Bots join the conversation as agents, so the room shows them as agents. */
export function senderKindOf(role: Role): 'human' | 'agent' {
  return role === 'bot' ? 'agent' : 'human';
}

export function canRequestWork(role: Role): boolean {
  return role === 'owner' || role === 'peer';
}

export function workNeedsApproval(role: Role): boolean {
  return role !== 'owner';
}

export function canApprove(role: Role): boolean {
  return role === 'owner';
}

export function canInvite(role: Role): boolean {
  return role === 'owner';
}

export function canCancel(role: Role, isRequester: boolean): boolean {
  return role === 'owner' || (role === 'peer' && isRequester);
}
