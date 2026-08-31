import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuditTrail } from './audit.js';
import { canonicalEmail, approvalPhrase, sha256 } from './hash.js';
import { FileDraftStore, type DraftStoreLike } from './draft-store.js';
import { DemoESignProvider, FoxitESignProvider, eSignCredentialsPresent, liveSendEnabled, type ESignProvider } from './esign.js';
import { DemoPdfEngine, FoxitMcpPdfEngine, foxitCredentialsPresent, type PdfEngine } from './pdf-engine.js';
import { ResilientPlanner, type DocumentPlanner } from './planner.js';
import { renderAgreement } from './template.js';
import {
  PrepareDraftSchema,
  type DraftRecord,
  type PrepareDraftInput,
  type PublicDraft,
  type RiskSignal,
} from './types.js';

export class GateError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus = 400) {
    super(message);
    this.name = 'GateError';
  }
}

interface SignGateServiceOptions {
  runtimeDir: string;
  planner: DocumentPlanner;
  pdfEngine: PdfEngine;
  eSignProvider: ESignProvider;
  audit: AuditTrail;
  draftStore?: DraftStoreLike;
}

function risksFor(input: PrepareDraftInput, mode: 'live' | 'demo'): RiskSignal[] {
  return [
    {
      level: 'critical',
      label: 'External signing invitation',
      detail: `A live dispatch sends one email to ${input.recipient.email}. No other recipient is authorized.`,
    },
    {
      level: 'warning',
      label: 'Legal commitment',
      detail: 'The generated agreement may create binding obligations. SignGate does not replace legal review or signing authority checks.',
    },
    {
      level: 'info',
      label: 'Exact artifact boundary',
      detail: 'Approval is bound to the SHA-256 of the rendered artifact and the canonical recipient email. Any change closes the gate.',
    },
    mode === 'live'
      ? {
          level: 'info',
          label: 'Foxit live path',
          detail: 'The artifact was rendered through the official Foxit PDF API MCP. eSign still requires a separate explicit approval.',
        }
      : {
          level: 'warning',
          label: 'Demo path',
          detail: 'Foxit credentials are absent. This run creates an HTML proof only and cannot send email or claim a Foxit PDF.',
        },
  ];
}

export class SignGateService {
  private readonly drafts = new Map<string, DraftRecord>();
  readonly runtimeDir: string;
  readonly planner: DocumentPlanner;
  readonly pdfEngine: PdfEngine;
  readonly eSignProvider: ESignProvider;
  readonly audit: AuditTrail;
  readonly draftStore: DraftStoreLike;

  constructor(options: SignGateServiceOptions) {
    this.runtimeDir = resolve(options.runtimeDir);
    this.planner = options.planner;
    this.pdfEngine = options.pdfEngine;
    this.eSignProvider = options.eSignProvider;
    this.audit = options.audit;
    this.draftStore = options.draftStore ?? new FileDraftStore(this.runtimeDir);
    for (const draft of this.draftStore.loadAll()) this.drafts.set(draft.id, draft);
  }

  async prepare(rawInput: unknown): Promise<PublicDraft> {
    const input = PrepareDraftSchema.parse(rawInput);
    await mkdir(this.runtimeDir, { recursive: true });
    const id = randomUUID();
    const plan = await this.planner.plan(input.prompt);
    const html = renderAgreement(plan, input.recipient);
    const artifact = await this.pdfEngine.prepare(html, id, this.runtimeDir);
    const pdfSha256 = sha256(artifact.bytes);
    const record: DraftRecord = {
      id,
      prompt: input.prompt,
      recipient: input.recipient,
      plan,
      html,
      artifact,
      pdfSha256,
      approvalPhrase: approvalPhrase(pdfSha256),
      risks: risksFor(input, artifact.evidence.mode),
      status: 'prepared',
      createdAt: new Date().toISOString(),
    };
    this.drafts.set(id, record);
    await this.draftStore.save(record);
    await this.audit.append('artifact_prepared', id, {
      pdfSha256,
      recipientHash: sha256(canonicalEmail(input.recipient.email)),
      provider: artifact.evidence.provider,
      tools: artifact.evidence.tools,
    });
    return this.toPublic(record);
  }

  get(id: string): PublicDraft {
    return this.toPublic(this.mustGet(id));
  }

  async approve(id: string, input: { phrase?: unknown; attestExactRecipient?: unknown; attestAuthority?: unknown }): Promise<PublicDraft> {
    const draft = this.mustGet(id);
    if (draft.approval && !draft.approval.consumedAt) return this.toPublic(draft);
    if (input.phrase !== draft.approvalPhrase) {
      throw new GateError('PHRASE_MISMATCH', `Type the exact phrase ${draft.approvalPhrase}`, 409);
    }
    if (input.attestExactRecipient !== true || input.attestAuthority !== true) {
      throw new GateError('ATTESTATION_REQUIRED', 'Exact-recipient and signing-authority attestations are both required', 409);
    }
    draft.approval = {
      id: randomUUID(),
      draftId: id,
      pdfSha256: draft.pdfSha256,
      recipientEmail: canonicalEmail(draft.recipient.email),
      approvedAt: new Date().toISOString(),
    };
    draft.status = 'approved';
    await this.draftStore.save(draft);
    await this.audit.append('exact_artifact_approved', id, {
      approvalId: draft.approval.id,
      pdfSha256: draft.pdfSha256,
      recipientHash: sha256(draft.approval.recipientEmail),
    });
    return this.toPublic(draft);
  }

  async send(id: string): Promise<PublicDraft> {
    const draft = this.mustGet(id);
    const approval = draft.approval;
    if (!approval) throw new GateError('APPROVAL_REQUIRED', 'No exact-artifact approval exists', 409);
    if (approval.consumedAt) throw new GateError('APPROVAL_SPENT', 'This one-shot approval has already been consumed', 409);
    if (this.eSignProvider.canSend && !this.eSignProvider.canSend()) {
      throw new GateError('LIVE_SEND_DISABLED', 'Live eSign dispatch is disarmed; enable it explicitly before consuming this approval', 409);
    }

    const currentHash = sha256(draft.artifact.bytes);
    const currentRecipient = canonicalEmail(draft.recipient.email);
    if (currentHash !== approval.pdfSha256 || currentRecipient !== approval.recipientEmail) {
      draft.status = 'blocked';
      await this.draftStore.save(draft);
      await this.audit.append('dispatch_blocked', id, {
        artifactMatch: currentHash === approval.pdfSha256,
        recipientMatch: currentRecipient === approval.recipientEmail,
      });
      throw new GateError('APPROVAL_BINDING_BROKEN', 'Artifact or recipient changed after approval; a fresh draft and approval are required', 409);
    }

    approval.consumedAt = new Date().toISOString();
    draft.status = 'uncertain';
    draft.envelope = {
      mode: this.eSignProvider.mode,
      status: 'uncertain',
      detail: 'A provider attempt is in progress or was interrupted. Approval is already spent; SignGate will not retry automatically.',
    };
    await this.draftStore.save(draft);
    await this.audit.append('dispatch_attempted', id, {
      approvalId: approval.id,
      pdfSha256: currentHash,
      providerMode: this.eSignProvider.mode,
    });
    let envelope;
    try {
      envelope = await this.eSignProvider.send({
        title: draft.plan.title,
        recipient: draft.recipient,
        pdf: draft.artifact.bytes,
        pdfSha256: currentHash,
      });
    } catch (error) {
      draft.envelope = {
        mode: this.eSignProvider.mode,
        status: 'uncertain',
        detail: 'The provider call did not return a provable terminal result. Approval remains spent; SignGate will not retry automatically.',
      };
      await this.draftStore.save(draft);
      await this.audit.append('dispatch_uncertain', id, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new GateError('DISPATCH_UNCERTAIN', draft.envelope.detail, 502);
    }
    draft.envelope = envelope;
    draft.status = envelope.status === 'sent' ? 'sent' : 'simulated';
    await this.draftStore.save(draft);
    await this.audit.append(envelope.status === 'sent' ? 'envelope_sent' : 'dispatch_simulated', id, {
      folderId: envelope.folderId,
      providerStatus: envelope.providerStatus,
    });
    return this.toPublic(draft);
  }

  async tamper(id: string, kind: 'recipient' | 'artifact'): Promise<PublicDraft> {
    const draft = this.mustGet(id);
    if (!draft.approval || draft.approval.consumedAt) {
      throw new GateError('ACTIVE_APPROVAL_REQUIRED', 'Create an unspent approval before running the tamper proof', 409);
    }
    if (kind === 'recipient') {
      draft.recipient = { ...draft.recipient, email: 'changed-recipient@example.net' };
    } else {
      draft.artifact = { ...draft.artifact, bytes: Buffer.concat([draft.artifact.bytes, Buffer.from('\npost-approval mutation')]) };
    }
    await this.draftStore.save(draft);
    await this.audit.append('post_approval_mutation_injected', id, { kind });
    return this.toPublic(draft);
  }

  async collectFinal(id: string): Promise<PublicDraft> {
    const draft = this.mustGet(id);
    const folderId = draft.envelope?.folderId;
    if (!folderId || draft.envelope?.status !== 'sent') {
      throw new GateError('LIVE_ENVELOPE_REQUIRED', 'No live Foxit envelope is available for final collection', 409);
    }
    if (!this.eSignProvider.status || !this.eSignProvider.download) {
      throw new GateError('FINAL_COLLECTION_UNAVAILABLE', 'The active eSign provider cannot collect a final document', 409);
    }
    const snapshot = await this.eSignProvider.status(folderId);
    const providerStatus = extractProviderStatus(snapshot);
    if (!['EXECUTED', 'COMPLETED', 'COMPLETE'].includes(providerStatus)) {
      draft.envelope = { ...draft.envelope, ...(providerStatus ? { providerStatus } : {}) };
      await this.draftStore.save(draft);
      await this.audit.append('signature_still_pending', id, { folderId, providerStatus });
      throw new GateError('SIGNATURE_PENDING', `Foxit envelope is ${providerStatus || 'not complete'}; no final PDF was downloaded`, 409);
    }
    const bytes = await this.eSignProvider.download(folderId);
    const signedSha256 = sha256(bytes);
    const path = resolve(this.runtimeDir, `${id}-signed.pdf`);
    await writeFile(path, bytes);
    draft.finalProof = {
      folderId,
      providerStatus,
      signedSha256,
      downloadedAt: new Date().toISOString(),
      path,
    };
    draft.status = 'completed';
    await this.draftStore.save(draft);
    await this.audit.append('signed_artifact_collected', id, { folderId, providerStatus, signedSha256 });
    return this.toPublic(draft);
  }

  status(): Record<string, unknown> {
    return {
      product: 'SignGate',
      pdfMode: this.pdfEngine.mode,
      eSignMode: this.eSignProvider.mode,
      plannerMode: this.planner.mode,
      liveSendEnabled: liveSendEnabled(),
      credentialsPresent: foxitCredentialsPresent() && eSignCredentialsPresent(),
      officialMcpPackage: '@foxitsoftware/foxit-pdf-api-mcp-server@0.2.3',
      auditChainValid: this.audit.verify(),
    };
  }

  private mustGet(id: string): DraftRecord {
    const draft = this.drafts.get(id);
    if (!draft) throw new GateError('DRAFT_NOT_FOUND', 'Draft not found', 404);
    return draft;
  }

  private toPublic(draft: DraftRecord): PublicDraft {
    return {
      id: draft.id,
      recipient: draft.recipient,
      plan: draft.plan,
      pdfSha256: draft.pdfSha256,
      approvalPhrase: draft.approvalPhrase,
      risks: draft.risks,
      status: draft.status,
      createdAt: draft.createdAt,
      evidence: draft.artifact.evidence,
      artifactUrl: `/artifacts/${encodeURIComponent(basename(draft.artifact.path))}`,
      ...(draft.approval ? { approval: draft.approval } : {}),
      ...(draft.envelope ? { envelope: draft.envelope } : {}),
      ...(draft.finalProof ? {
        finalProof: {
          folderId: draft.finalProof.folderId,
          providerStatus: draft.finalProof.providerStatus,
          signedSha256: draft.finalProof.signedSha256,
          downloadedAt: draft.finalProof.downloadedAt,
          artifactUrl: `/artifacts/${encodeURIComponent(basename(draft.finalProof.path))}`,
        },
      } : {}),
    };
  }
}

function extractProviderStatus(snapshot: Record<string, unknown>): string {
  const folder = snapshot.folder && typeof snapshot.folder === 'object' ? snapshot.folder as Record<string, unknown> : undefined;
  const envelope = snapshot.envelope && typeof snapshot.envelope === 'object' ? snapshot.envelope as Record<string, unknown> : undefined;
  const value = folder?.folderStatus ?? folder?.envelopeStatus ?? envelope?.folderStatus ?? envelope?.envelopeStatus ?? snapshot.folderStatus ?? snapshot.envelopeStatus ?? snapshot.status;
  return typeof value === 'string' ? value.toUpperCase() : '';
}

export function createDefaultService(runtimeDir = resolve('runtime')): SignGateService {
  const pdfEngine = foxitCredentialsPresent() ? new FoxitMcpPdfEngine() : new DemoPdfEngine();
  const eSignProvider = eSignCredentialsPresent() ? new FoxitESignProvider() : new DemoESignProvider();
  return new SignGateService({
    runtimeDir,
    planner: new ResilientPlanner(),
    pdfEngine,
    eSignProvider,
    audit: new AuditTrail(resolve(runtimeDir, 'audit.jsonl')),
  });
}
