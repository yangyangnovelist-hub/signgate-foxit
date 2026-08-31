import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from './hash.js';
import type { DraftRecord, PdfEvidence } from './types.js';

interface PersistedArtifact {
  path: string;
  evidence: PdfEvidence;
  contentSha256: string;
}

interface PersistedDraftRecord extends Omit<DraftRecord, 'artifact'> {
  artifact: PersistedArtifact;
}

interface PersistedEnvelope {
  version: 1;
  record: PersistedDraftRecord;
  recordHash: string;
}

export interface DraftStoreLike {
  loadAll(): DraftRecord[];
  save(record: DraftRecord): Promise<void>;
}

function assertRecordPath(runtimeDir: string, path: string, label: string): string {
  const resolved = resolve(path);
  if (!resolved.startsWith(`${runtimeDir}${sep}`)) {
    throw new Error(`${label} escapes the SignGate runtime directory`);
  }
  return resolved;
}

export class FileDraftStore implements DraftStoreLike {
  private readonly runtimeDir: string;
  private readonly draftsDir: string;

  constructor(runtimeDir: string) {
    this.runtimeDir = resolve(runtimeDir);
    this.draftsDir = resolve(this.runtimeDir, 'drafts');
  }

  loadAll(): DraftRecord[] {
    if (!existsSync(this.draftsDir)) return [];
    return readdirSync(this.draftsDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => this.loadOne(resolve(this.draftsDir, name)));
  }

  async save(record: DraftRecord): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(record.id)) throw new Error('Draft id is not a UUID');
    const artifactPath = assertRecordPath(this.runtimeDir, record.artifact.path, 'Artifact path');
    const { bytes, ...artifact } = record.artifact;
    const persistedRecord: PersistedDraftRecord = {
      ...record,
      artifact: { ...artifact, path: artifactPath, contentSha256: sha256(bytes) },
      ...(record.finalProof
        ? { finalProof: { ...record.finalProof, path: assertRecordPath(this.runtimeDir, record.finalProof.path, 'Final proof path') } }
        : {}),
    };
    const payload = { version: 1 as const, record: persistedRecord };
    const envelope: PersistedEnvelope = { ...payload, recordHash: sha256(JSON.stringify(payload)) };
    await mkdir(this.draftsDir, { recursive: true, mode: 0o700 });
    await chmod(this.draftsDir, 0o700);
    await this.atomicWrite(artifactPath, bytes);
    if (record.finalProof) {
      const finalBytes = await readFile(record.finalProof.path);
      if (sha256(finalBytes) !== record.finalProof.signedSha256) {
        throw new Error('Final proof failed its SHA-256 check before persistence');
      }
      await chmod(record.finalProof.path, 0o600);
    }
    const target = resolve(this.draftsDir, `${record.id}.json`);
    await this.atomicWrite(target, Buffer.from(`${JSON.stringify(envelope)}\n`));
  }

  private loadOne(path: string): DraftRecord {
    let envelope: PersistedEnvelope;
    try {
      envelope = JSON.parse(readFileSync(path, 'utf8')) as PersistedEnvelope;
    } catch (error) {
      throw new Error(`Persisted draft ${basename(path)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (envelope.version !== 1 || !envelope.record || typeof envelope.recordHash !== 'string') {
      throw new Error(`Persisted draft ${basename(path)} has an unsupported format`);
    }
    const payload = { version: envelope.version, record: envelope.record };
    if (sha256(JSON.stringify(payload)) !== envelope.recordHash) {
      throw new Error(`Persisted draft ${basename(path)} failed its metadata integrity check`);
    }
    if (`${envelope.record.id}.json` !== basename(path)) {
      throw new Error(`Persisted draft ${basename(path)} does not match its record id`);
    }
    const artifactPath = assertRecordPath(this.runtimeDir, envelope.record.artifact.path, 'Artifact path');
    const bytes = readFileSync(artifactPath);
    if (sha256(bytes) !== envelope.record.artifact.contentSha256) {
      throw new Error(`Persisted draft ${basename(path)} failed its artifact SHA-256 check`);
    }
    if (envelope.record.approval?.pdfSha256 && envelope.record.approval.pdfSha256 !== envelope.record.pdfSha256) {
      throw new Error(`Persisted draft ${basename(path)} has an approval bound to a different artifact`);
    }
    let finalProof;
    if (envelope.record.finalProof) {
      const finalPath = assertRecordPath(this.runtimeDir, envelope.record.finalProof.path, 'Final proof path');
      const finalBytes = readFileSync(finalPath);
      if (sha256(finalBytes) !== envelope.record.finalProof.signedSha256) {
        throw new Error(`Persisted draft ${basename(path)} failed its final artifact SHA-256 check`);
      }
      finalProof = { ...envelope.record.finalProof, path: finalPath };
    }
    return {
      ...envelope.record,
      artifact: { ...envelope.record.artifact, path: artifactPath, bytes },
      ...(finalProof ? { finalProof } : {}),
    };
  }

  private async atomicWrite(target: string, bytes: Buffer): Promise<void> {
    const temporary = resolve(this.draftsDir, `.${basename(target)}.${randomUUID()}.tmp`);
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, target);
    await chmod(target, 0o600);
  }
}
