import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuditTrail } from '../src/audit.js';

describe('persistent audit trail', () => {
  let runtimeDir: string;
  let auditPath: string;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), 'signgate-audit-'));
    auditPath = join(runtimeDir, 'audit.jsonl');
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it('continues one verified hash chain after a process restart', async () => {
    const firstProcess = new AuditTrail(auditPath);
    const first = await firstProcess.append('artifact_prepared', 'draft-1', { hash: 'abc' });

    const secondProcess = new AuditTrail(auditPath);
    expect(secondProcess.events).toEqual([first]);
    const second = await secondProcess.append('exact_artifact_approved', 'draft-1', { approval: 'one-shot' });

    expect(second.sequence).toBe(2);
    expect(second.previousHash).toBe(first.eventHash);
    expect(secondProcess.verify()).toBe(true);
    expect((await readFile(auditPath, 'utf8')).trim().split('\n')).toHaveLength(2);
  });

  it('fails closed when persisted evidence was modified', async () => {
    const trail = new AuditTrail(auditPath);
    const event = await trail.append('artifact_prepared', 'draft-1', { hash: 'abc' });
    await writeFile(auditPath, `${JSON.stringify({ ...event, detail: { hash: 'changed' } })}\n`, 'utf8');

    expect(() => new AuditTrail(auditPath)).toThrow('hash chain is invalid');
  });

  it('serializes concurrent appends into the same on-disk hash order', async () => {
    const trail = new AuditTrail(auditPath);
    const events = await Promise.all(Array.from({ length: 20 }, (_, index) => trail.append('concurrent_event', `draft-${index}`)));
    const persisted = (await readFile(auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { sequence: number });

    expect(events.map((event) => event.sequence)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(persisted.map((event) => event.sequence)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(trail.verify()).toBe(true);
  });
});
