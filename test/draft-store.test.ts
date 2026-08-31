import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileDraftStore } from '../src/draft-store.js';
import { approvalPhrase, sha256 } from '../src/hash.js';
import type { DraftRecord } from '../src/types.js';

const id = '11111111-1111-4111-8111-111111111111';

describe('FileDraftStore', () => {
  let runtimeDir: string;
  let artifactPath: string;
  let record: DraftRecord;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), 'signgate-store-'));
    artifactPath = join(runtimeDir, `${id}.pdf`);
    const bytes = Buffer.from('%PDF-durable-artifact');
    const pdfSha256 = sha256(bytes);
    record = {
      id,
      prompt: 'Prepare a durable agreement record that survives a process restart without losing its approval boundary.',
      recipient: { firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com' },
      plan: {
        title: 'Durable Agreement',
        purpose: 'Exercise durable draft recovery for a completed approval and provider attempt.',
        effectiveDate: '2026-09-01',
        termDays: 14,
        governingLaw: 'Hong Kong',
        clauses: [
          { heading: 'Scope', body: 'The parties evaluate one bounded workflow for the stated term.' },
          { heading: 'Confidentiality', body: 'Each party protects confidential material received during evaluation.' },
          { heading: 'Termination', body: 'Either party may terminate the evaluation by written notice.' },
        ],
      },
      html: '<!doctype html><title>Durable Agreement</title>',
      artifact: {
        bytes,
        path: artifactPath,
        evidence: { mode: 'live', provider: 'foxit-pdf-api-mcp', tools: ['upload_document', 'pdf_from_html', 'download_document'], artifactLabel: 'FOXIT PDF / LIVE' },
      },
      pdfSha256,
      approvalPhrase: approvalPhrase(pdfSha256),
      risks: [],
      status: 'approved',
      createdAt: '2026-09-01T00:00:00.000Z',
      approval: {
        id: '22222222-2222-4222-8222-222222222222',
        draftId: id,
        pdfSha256,
        recipientEmail: 'jordan@example.com',
        approvedAt: '2026-09-01T00:01:00.000Z',
      },
    };
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it('atomically restores artifact bytes and approval state with private permissions', async () => {
    const store = new FileDraftStore(runtimeDir);
    await store.save(record);
    const [restored] = store.loadAll();

    expect(restored).toMatchObject({ id, status: 'approved', approval: { pdfSha256: record.pdfSha256 } });
    expect(restored?.artifact.bytes.equals(record.artifact.bytes)).toBe(true);
    expect((await stat(join(runtimeDir, 'drafts'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(runtimeDir, 'drafts', `${id}.json`))).mode & 0o777).toBe(0o600);
    expect((await stat(artifactPath)).mode & 0o777).toBe(0o600);
  });

  it('fails closed when persisted metadata changes', async () => {
    const store = new FileDraftStore(runtimeDir);
    await store.save(record);
    const metadataPath = join(runtimeDir, 'drafts', `${id}.json`);
    const envelope = JSON.parse(await readFile(metadataPath, 'utf8')) as { record: { status: string } };
    envelope.record.status = 'sent';
    await writeFile(metadataPath, JSON.stringify(envelope));

    expect(() => store.loadAll()).toThrow('metadata integrity check');
  });

  it('fails closed when persisted artifact bytes change outside the state machine', async () => {
    const store = new FileDraftStore(runtimeDir);
    await store.save(record);
    await writeFile(artifactPath, Buffer.from('%PDF-tampered-outside-signgate'));

    expect(() => store.loadAll()).toThrow('artifact SHA-256 check');
  });

  it('fails closed when a completed signed artifact changes after collection', async () => {
    const store = new FileDraftStore(runtimeDir);
    const finalPath = join(runtimeDir, `${id}-signed.pdf`);
    const finalBytes = Buffer.from('%PDF-signed-proof');
    await writeFile(finalPath, finalBytes);
    record.status = 'completed';
    record.finalProof = {
      folderId: 'folder-42',
      providerStatus: 'COMPLETED',
      signedSha256: sha256(finalBytes),
      downloadedAt: '2026-09-01T00:02:00.000Z',
      path: finalPath,
    };
    await store.save(record);
    await writeFile(finalPath, Buffer.from('%PDF-mutated-signed-proof'));

    expect(() => store.loadAll()).toThrow('final artifact SHA-256 check');
  });
});
