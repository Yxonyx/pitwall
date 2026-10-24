import { createHash, randomBytes } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function nowIso(): string {
  return new Date().toISOString();
}
