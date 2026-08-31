import type { EnvelopeResult, Recipient } from './types.js';

export interface SendEnvelopeInput {
  title: string;
  recipient: Recipient;
  pdf: Buffer;
  pdfSha256: string;
}

export interface ESignProvider {
  readonly mode: 'live' | 'demo';
  send(input: SendEnvelopeInput): Promise<EnvelopeResult>;
  status?(folderId: string): Promise<Record<string, unknown>>;
  download?(folderId: string): Promise<Buffer>;
}

export class DemoESignProvider implements ESignProvider {
  readonly mode = 'demo' as const;

  async send(input: SendEnvelopeInput): Promise<EnvelopeResult> {
    return {
      mode: 'demo',
      status: 'simulated',
      providerStatus: 'SIMULATED_NOT_SENT',
      detail: `Approval consumed for ${input.recipient.email}; demo mode sent no email and created no Foxit envelope.`,
    };
  }
}

export function liveSendEnabled(): boolean {
  return process.env.SIGNGATE_LIVE_SEND_ENABLED === 'true';
}

export function eSignCredentialsPresent(): boolean {
  return Boolean(process.env.FOXIT_CLOUD_API_CLIENT_ID && process.env.FOXIT_CLOUD_API_CLIENT_SECRET);
}

interface FoxitCreateResponse {
  result?: string;
  folder?: {
    folderId?: number | string;
    folderStatus?: string;
  };
  message?: string;
}

export class FoxitESignProvider implements ESignProvider {
  readonly mode = 'live' as const;
  private readonly host: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { host?: string; clientId?: string; clientSecret?: string; fetchImpl?: typeof fetch } = {}) {
    this.host = (options.host ?? process.env.FOXIT_ESIGN_HOST ?? 'https://na1.fusion.foxit.com').replace(/\/$/, '');
    this.clientId = options.clientId ?? process.env.FOXIT_CLOUD_API_CLIENT_ID ?? '';
    this.clientSecret = options.clientSecret ?? process.env.FOXIT_CLOUD_API_CLIENT_SECRET ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    if (!this.clientId || !this.clientSecret) throw new Error('Foxit eSign credentials are not configured');
    return {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      'content-type': 'application/json',
    };
  }

  async send(input: SendEnvelopeInput): Promise<EnvelopeResult> {
    if (!liveSendEnabled()) throw new Error('Live eSign dispatch is disabled by SIGNGATE_LIVE_SEND_ENABLED');
    const response = await this.fetchImpl(`${this.host}/esign/api/v1/folders/createfolder`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        folderName: input.title,
        inputType: 'base64',
        base64FileString: [input.pdf.toString('base64')],
        fileNames: [`${input.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'agreement'}.pdf`],
        parties: [{
          firstName: input.recipient.firstName,
          lastName: input.recipient.lastName,
          emailId: input.recipient.email,
          permission: 'FILL_FIELDS_AND_SIGN',
          sequence: 1,
        }],
        processTextTags: true,
        processAcroFields: false,
        createEmbeddedSigningSession: false,
        sendNow: true,
      }),
    });
    const body = await response.json().catch(() => ({})) as FoxitCreateResponse;
    const folderId = body.folder?.folderId;
    if (!response.ok || !folderId || body.result?.toLowerCase() === 'error') {
      const reason = !folderId ? 'no folder id' : (body.message ?? body.result ?? 'unknown provider error');
      throw new Error(`Foxit eSign createfolder failed (${response.status}): ${reason}`);
    }
    return {
      mode: 'live',
      status: 'sent',
      folderId: String(folderId),
      providerStatus: body.folder?.folderStatus ?? 'SENT',
      detail: 'Foxit accepted the exact approved PDF and dispatched one signing invitation.',
    };
  }

  async status(folderId: string): Promise<Record<string, unknown>> {
    const url = new URL(`${this.host}/esign/api/v1/folders/myfolder`);
    url.searchParams.set('folderId', folderId);
    const response = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`Foxit eSign status failed (${response.status})`);
    return body;
  }

  async download(folderId: string): Promise<Buffer> {
    const url = new URL(`${this.host}/esign/api/v1/folders/download`);
    url.searchParams.set('folderId', folderId);
    const response = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Foxit eSign download failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }
}
