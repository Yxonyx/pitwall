import { ProtocolError } from './errors.js';
import type { Activity } from './types.js';

const SLUG = /^[a-z][a-z0-9-]{0,30}$/;
const CLIENT_ID = /^[A-Za-z0-9._:-]{8,80}$/;

export function cleanPersonName(input: unknown): string {
  if (typeof input !== 'string') {
    throw new ProtocolError('bad_name', 'Enter a name.');
  }
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    throw new ProtocolError('bad_name', 'Use a name of 1 to 40 characters.');
  }
  return name;
}

export function cleanSlug(input: unknown, label: string): string {
  if (typeof input !== 'string' || !SLUG.test(input) || input === 'all' || input === 'system') {
    throw new ProtocolError('bad_name', `${label} must be a lowercase name, such as backend or mac-studio.`);
  }
  return input;
}

export function cleanBody(input: unknown, allowEmpty = false): string {
  if (typeof input !== 'string') {
    throw new ProtocolError('bad_message', 'The message is missing.');
  }
  // Control characters, escape included, never belong in a chat line: a terminal would act on them. Newline and tab stay.
  const body = input.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').trim();
  if (!allowEmpty && body.length === 0) {
    throw new ProtocolError('bad_message', 'Write a message first.');
  }
  if (body.length > 4000) {
    throw new ProtocolError('bad_message', 'Keep a message under 4000 characters.');
  }
  return body;
}

export function cleanClientId(input: unknown): string {
  if (typeof input !== 'string' || !CLIENT_ID.test(input)) {
    throw new ProtocolError('bad_message', 'The message id is not valid.');
  }
  return input;
}

export function statusBoard(
  agents: readonly { name: string; machineName: string; online: boolean; activity: Activity }[],
  note?: string,
): string {
  const head = note?.trim() ? `Status: ${note.trim()}` : 'Status';
  if (agents.length === 0) return `${head}\nNo agents yet.`;
  const lines = [...agents]
    .sort((a, b) => a.machineName.localeCompare(b.machineName) || a.name.localeCompare(b.name))
    .map(
      (agent) =>
        `${agent.name} · ${agent.machineName} · ${agent.activity} · ${agent.online ? 'online' : 'offline'}`,
    );
  return [head, ...lines].join('\n');
}

export function safeHttps(raw: string): string | null {
  let value = raw.trim();
  while (value.length > 0 && /[).,!?:;]$/.test(value)) value = value.slice(0, -1);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export const MAX_HOP = 3;

export function withinHop(hop: number): boolean {
  return Number.isInteger(hop) && hop >= 0 && hop < MAX_HOP;
}
