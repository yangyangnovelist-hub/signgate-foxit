import { createHash } from 'node:crypto';

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function approvalPhrase(hash: string): string {
  return `APPROVE ${hash.slice(0, 8).toUpperCase()}`;
}

export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}
