import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditTrail } from '../src/audit.js';
import { DemoESignProvider } from '../src/esign.js';
import { DemoPdfEngine } from '../src/pdf-engine.js';
import { DeterministicPlanner } from '../src/planner.js';
import { GateError, SignGateService } from '../src/service.js';

const validInput = {
  prompt: 'Prepare a 14-day mutual evaluation agreement governed by Hong Kong law for an AI workflow pilot.',
  recipient: { firstName: 'Jordan', lastName: 'Lee', email: 'Jordan@Example.com' },
};

describe('SignGateService', () => {
  let runtimeDir: string;
  let service: SignGateService;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), 'signgate-test-'));
    service = new SignGateService({
      runtimeDir,
      planner: new DeterministicPlanner(),
      pdfEngine: new DemoPdfEngine(),
      eSignProvider: new DemoESignProvider(),
      audit: new AuditTrail(),
    });
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it('prepares a transparently labelled demo artifact with a stable fingerprint', async () => {
    const draft = await service.prepare(validInput);

    expect(draft.status).toBe('prepared');
    expect(draft.evidence).toMatchObject({ mode: 'demo', provider: 'deterministic-preview', tools: [] });
    expect(draft.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(draft.approvalPhrase).toBe(`APPROVE ${draft.pdfSha256.slice(0, 8).toUpperCase()}`);
    expect(draft.artifactUrl).toMatch(/^\/artifacts\/.+\.html$/);
  });

  it('rejects a brief that is too short before any artifact exists', async () => {
    await expect(service.prepare({ ...validInput, prompt: 'too short' })).rejects.toThrow();
    expect(service.audit.events).toHaveLength(0);
  });

  it('rejects an invalid recipient email', async () => {
    await expect(service.prepare({ ...validInput, recipient: { ...validInput.recipient, email: 'not-email' } })).rejects.toThrow();
  });

  it('keeps the gate closed for an inexact approval phrase', async () => {
    const draft = await service.prepare(validInput);
    await expect(service.approve(draft.id, {
      phrase: 'yes',
      attestExactRecipient: true,
      attestAuthority: true,
    })).rejects.toMatchObject({ code: 'PHRASE_MISMATCH' });
  });

  it('requires both explicit attestations', async () => {
    const draft = await service.prepare(validInput);
    await expect(service.approve(draft.id, {
      phrase: draft.approvalPhrase,
      attestExactRecipient: true,
      attestAuthority: false,
    })).rejects.toMatchObject({ code: 'ATTESTATION_REQUIRED' });
  });

  it('binds approval to the artifact hash and canonical recipient', async () => {
    const draft = await service.prepare(validInput);
    const approved = await service.approve(draft.id, {
      phrase: draft.approvalPhrase,
      attestExactRecipient: true,
      attestAuthority: true,
    });

    expect(approved.status).toBe('approved');
    expect(approved.approval).toMatchObject({
      pdfSha256: draft.pdfSha256,
      recipientEmail: 'jordan@example.com',
    });
  });

  it('makes repeated identical approval idempotent while it is unspent', async () => {
    const draft = await service.prepare(validInput);
    const body = { phrase: draft.approvalPhrase, attestExactRecipient: true, attestAuthority: true };
    const first = await service.approve(draft.id, body);
    const second = await service.approve(draft.id, body);

    expect(second.approval?.id).toBe(first.approval?.id);
    expect(service.audit.events.filter((event) => event.type === 'exact_artifact_approved')).toHaveLength(1);
  });

  it('refuses dispatch without approval', async () => {
    const draft = await service.prepare(validInput);
    await expect(service.send(draft.id)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('consumes one approval for one transparent simulation', async () => {
    const draft = await service.prepare(validInput);
    await service.approve(draft.id, { phrase: draft.approvalPhrase, attestExactRecipient: true, attestAuthority: true });
    const sent = await service.send(draft.id);

    expect(sent.status).toBe('simulated');
    expect(sent.envelope).toMatchObject({ mode: 'demo', status: 'simulated', providerStatus: 'SIMULATED_NOT_SENT' });
    expect(sent.approval?.consumedAt).toBeTruthy();
    expect(sent.envelope?.detail).toContain('sent no email');
  });

  it('never lets one approval spill into a second dispatch', async () => {
    const draft = await service.prepare(validInput);
    await service.approve(draft.id, { phrase: draft.approvalPhrase, attestExactRecipient: true, attestAuthority: true });
    await service.send(draft.id);

    await expect(service.send(draft.id)).rejects.toMatchObject({ code: 'APPROVAL_SPENT' });
  });

  it('hard-blocks a recipient changed after approval', async () => {
    const draft = await service.prepare(validInput);
    await service.approve(draft.id, { phrase: draft.approvalPhrase, attestExactRecipient: true, attestAuthority: true });
    await service.tamper(draft.id, 'recipient');

    await expect(service.send(draft.id)).rejects.toMatchObject({ code: 'APPROVAL_BINDING_BROKEN' });
    expect(service.get(draft.id).status).toBe('blocked');
    expect(service.get(draft.id).approval?.consumedAt).toBeUndefined();
  });

  it('hard-blocks artifact bytes changed after approval', async () => {
    const draft = await service.prepare(validInput);
    await service.approve(draft.id, { phrase: draft.approvalPhrase, attestExactRecipient: true, attestAuthority: true });
    await service.tamper(draft.id, 'artifact');

    await expect(service.send(draft.id)).rejects.toMatchObject({ code: 'APPROVAL_BINDING_BROKEN' });
  });

  it('maintains a verifiable hash-chained audit trail', async () => {
    const draft = await service.prepare(validInput);
    await service.approve(draft.id, { phrase: draft.approvalPhrase, attestExactRecipient: true, attestAuthority: true });
    await service.send(draft.id);

    expect(service.audit.verify()).toBe(true);
    expect(service.audit.events.map((event) => event.type)).toEqual([
      'artifact_prepared',
      'exact_artifact_approved',
      'dispatch_attempted',
      'dispatch_simulated',
    ]);
  });

  it('collects and hashes a completed Foxit signing artifact only after terminal status', async () => {
    const liveProvider = {
      mode: 'live' as const,
      send: async () => ({
        mode: 'live' as const,
        status: 'sent' as const,
        folderId: 'folder-42',
        providerStatus: 'SENT',
        detail: 'sent',
      }),
      status: async () => ({ folder: { folderId: 'folder-42', folderStatus: 'EXECUTED' } }),
      download: async () => Buffer.from('%PDF-signed-proof'),
    };
    const liveService = new SignGateService({
      runtimeDir,
      planner: new DeterministicPlanner(),
      pdfEngine: new DemoPdfEngine(),
      eSignProvider: liveProvider,
      audit: new AuditTrail(),
    });
    const draft = await liveService.prepare(validInput);
    await liveService.approve(draft.id, { phrase: draft.approvalPhrase, attestExactRecipient: true, attestAuthority: true });
    await liveService.send(draft.id);
    const completed = await liveService.collectFinal(draft.id);

    expect(completed.status).toBe('completed');
    expect(completed.finalProof).toMatchObject({
      folderId: 'folder-42',
      providerStatus: 'EXECUTED',
      artifactUrl: expect.stringMatching(/-signed\.pdf$/),
    });
    expect(completed.finalProof?.signedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(liveService.audit.events.at(-1)?.type).toBe('signed_artifact_collected');
  });

  it('does not download or claim a final PDF while the signature is pending', async () => {
    const download = vi.fn(async () => Buffer.from('should not download'));
    const liveProvider = {
      mode: 'live' as const,
      send: async () => ({ mode: 'live' as const, status: 'sent' as const, folderId: 'folder-42', detail: 'sent' }),
      status: async () => ({ folder: { folderStatus: 'WAITING_FOR_SIGNATURE' } }),
      download,
    };
    const liveService = new SignGateService({
      runtimeDir,
      planner: new DeterministicPlanner(),
      pdfEngine: new DemoPdfEngine(),
      eSignProvider: liveProvider,
      audit: new AuditTrail(),
    });
    const draft = await liveService.prepare(validInput);
    await liveService.approve(draft.id, { phrase: draft.approvalPhrase, attestExactRecipient: true, attestAuthority: true });
    await liveService.send(draft.id);

    await expect(liveService.collectFinal(draft.id)).rejects.toMatchObject({ code: 'SIGNATURE_PENDING' });
    expect(download).not.toHaveBeenCalled();
    expect(liveService.get(draft.id).finalProof).toBeUndefined();
  });

  it('does not expose the original brief in the public draft', async () => {
    const draft = await service.prepare(validInput);
    expect(draft).not.toHaveProperty('prompt');
  });

  it('returns a typed 404 for an unknown draft', () => {
    expect(() => service.get('missing')).toThrow(GateError);
    expect(() => service.get('missing')).toThrow('Draft not found');
  });
});
