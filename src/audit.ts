import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sha256 } from './hash.js';

export interface AuditEvent {
  sequence: number;
  at: string;
  type: string;
  draftId: string;
  detail: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
}

export class AuditTrail {
  readonly events: AuditEvent[] = [];
  private appendQueue: Promise<void> = Promise.resolve();

  constructor(private readonly outputPath?: string) {
    if (!outputPath || !existsSync(outputPath)) return;
    const contents = readFileSync(outputPath, 'utf8').trim();
    if (!contents) return;
    try {
      this.events.push(...contents.split('\n').map((line) => JSON.parse(line) as AuditEvent));
    } catch (error) {
      throw new Error(`Audit trail is not valid JSONL: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!this.verify()) throw new Error('Audit trail hash chain is invalid; refusing to append');
  }

  append(type: string, draftId: string, detail: Record<string, unknown> = {}): Promise<AuditEvent> {
    const operation = this.appendQueue.then(async () => {
      const sequence = (this.events.at(-1)?.sequence ?? 0) + 1;
      const previousHash = this.events.at(-1)?.eventHash ?? 'GENESIS';
      const unsigned = { sequence, at: new Date().toISOString(), type, draftId, detail, previousHash };
      const event: AuditEvent = { ...unsigned, eventHash: sha256(JSON.stringify(unsigned)) };
      if (this.outputPath) {
        await mkdir(dirname(this.outputPath), { recursive: true });
        await appendFile(this.outputPath, `${JSON.stringify(event)}\n`, 'utf8');
      }
      this.events.push(event);
      return event;
    });
    this.appendQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  verify(): boolean {
    return this.events.every((event, index) => {
      const previousHash = index === 0 ? 'GENESIS' : this.events[index - 1]!.eventHash;
      const { eventHash, ...unsigned } = event;
      return event.sequence === index + 1
        && event.previousHash === previousHash
        && eventHash === sha256(JSON.stringify(unsigned));
    });
  }
}
