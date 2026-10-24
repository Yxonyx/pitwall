import { ProtocolError } from './errors.js';
import type { Activity } from './types.js';

const SLUG = /^[a-z][a-z0-9-]{0,30}$/;
const CLIENT_ID = /^[A-Za-z0-9._:-]{8,80}$/;

export function cleanPersonName(input: unknown): string {
  if (typeof input !== 'string') {
    throw new ProtocolError('bad_name', 'Enter a name.');
  }
  // Compatibility forms (full width letters, ligatures) fold to plain ones, so one name has one spelling.
  const name = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  // No control characters, and no invisible formatting ones (zero width joiners, bidi marks): they make a name
  // that looks like another one.
  if (name.length < 1 || name.length > 40 || /[\u0000-\u001f\u007f-\u009f\u2800]|\p{Cf}|\p{Default_Ignorable_Code_Point}/u.test(name)) {
    throw new ProtocolError('bad_name', 'Use a name of 1 to 40 characters.');
  }
  // One alphabet to a name: "coder" with a Cyrillic o is a different name that looks the same.
  const alphabets = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u].filter((alphabet) => alphabet.test(name));
  if (alphabets.length > 1) {
    throw new ProtocolError('bad_name', 'Write a name in one alphabet.');
  }
  return name;
}

const LOOKALIKES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's',
  α: 'a', ο: 'o', ρ: 'p', ν: 'v', τ: 't', ι: 'i', κ: 'k', χ: 'x', υ: 'u',
};

/**
 * What a name looks like once spelling tricks are gone: compatibility forms folded, invisible characters dropped,
 * lowercase, common Cyrillic and Greek lookalikes written as the Latin letter, and only letters and digits kept.
 * Two names with the same skeleton can pass for each other.
 */
export function skeleton(name: string): string {
  return [...name.normalize('NFKC').toLowerCase().replace(/\p{Cf}/gu, '')]
    .map((char) => LOOKALIKES[char] ?? char)
    .join('')
    .replace(/[^\p{L}\p{N}]/gu, '');
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
