import { appendFile, mkdir } from 'node:fs/promises';
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

  constructor(private readonly outputPath?: string) {}

  async append(type: string, draftId: string, detail: Record<string, unknown> = {}): Promise<AuditEvent> {
    const sequence = this.events.length + 1;
    const previousHash = this.events.at(-1)?.eventHash ?? 'GENESIS';
    const unsigned = { sequence, at: new Date().toISOString(), type, draftId, detail, previousHash };
    const event: AuditEvent = { ...unsigned, eventHash: sha256(JSON.stringify(unsigned)) };
    this.events.push(event);
    if (this.outputPath) {
      await mkdir(dirname(this.outputPath), { recursive: true });
      await appendFile(this.outputPath, `${JSON.stringify(event)}\n`, 'utf8');
    }
    return event;
  }

  verify(): boolean {
    return this.events.every((event, index) => {
      const previousHash = index === 0 ? 'GENESIS' : this.events[index - 1]!.eventHash;
      const { eventHash, ...unsigned } = event;
      return event.previousHash === previousHash && eventHash === sha256(JSON.stringify(unsigned));
    });
  }
}
