import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FoxitESignProvider } from '../src/esign.js';

describe('FoxitESignProvider', () => {
  const originalFlag = process.env.SIGNGATE_LIVE_SEND_ENABLED;

  beforeEach(() => {
    process.env.SIGNGATE_LIVE_SEND_ENABLED = 'true';
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.SIGNGATE_LIVE_SEND_ENABLED;
    else process.env.SIGNGATE_LIVE_SEND_ENABLED = originalFlag;
  });

  it('sends the approved PDF as base64 with one aligned signer and required text-tag processing', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ result: 'success', folder: { folderId: 42, folderStatus: 'SENT' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const provider = new FoxitESignProvider({
      host: 'https://na1.fusion.foxit.com',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await provider.send({
      title: 'Pilot Agreement',
      recipient: { firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com' },
      pdf: Buffer.from('%PDF-test'),
      pdfSha256: 'abc',
    });

    expect(result).toMatchObject({ mode: 'live', status: 'sent', folderId: '42', providerStatus: 'SENT' });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://na1.fusion.foxit.com/esign/api/v1/folders/createfolder');
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      inputType: 'base64',
      processTextTags: true,
      processAcroFields: false,
      createEmbeddedSigningSession: false,
      sendNow: true,
      parties: [{ emailId: 'jordan@example.com', permission: 'FILL_FIELDS_AND_SIGN', sequence: 1 }],
    });
    expect(Buffer.from(payload.base64FileString[0], 'base64').toString()).toBe('%PDF-test');
  });

  it('refuses to call Foxit while the live dispatch flag is false', async () => {
    process.env.SIGNGATE_LIVE_SEND_ENABLED = 'false';
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response());
    const provider = new FoxitESignProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: fetchImpl as typeof fetch });

    await expect(provider.send({
      title: 'Agreement',
      recipient: { firstName: 'A', lastName: 'B', email: 'a@example.com' },
      pdf: Buffer.from('pdf'),
      pdfSha256: 'hash',
    })).rejects.toThrow('Live eSign dispatch is disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not claim success without a returned folder id', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ result: 'success' }), { status: 200 }));
    const provider = new FoxitESignProvider({ clientId: 'id', clientSecret: 'secret', fetchImpl: fetchImpl as typeof fetch });

    await expect(provider.send({
      title: 'Agreement',
      recipient: { firstName: 'A', lastName: 'B', email: 'a@example.com' },
      pdf: Buffer.from('pdf'),
      pdfSha256: 'hash',
    })).rejects.toThrow('no folder id');
  });

  it('retrieves envelope status by exact folder id', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ folder: { folderId: 42, folderStatus: 'EXECUTED' } }), { status: 200 }));
    const provider = new FoxitESignProvider({ host: 'https://host.test', clientId: 'id', clientSecret: 'secret', fetchImpl: fetchImpl as typeof fetch });
    const status = await provider.status('42');

    expect(status).toMatchObject({ folder: { folderStatus: 'EXECUTED' } });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://host.test/esign/api/v1/folders/myfolder?folderId=42');
  });

  it('can inspect an existing envelope while new live dispatch is disarmed', async () => {
    process.env.SIGNGATE_LIVE_SEND_ENABLED = 'false';
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ folder: { folderId: 42, folderStatus: 'WAITING_FOR_SIGNATURE' } }), { status: 200 }));
    const provider = new FoxitESignProvider({ host: 'https://host.test', clientId: 'id', clientSecret: 'secret', fetchImpl: fetchImpl as typeof fetch });

    await expect(provider.status('42')).resolves.toMatchObject({ folder: { folderStatus: 'WAITING_FOR_SIGNATURE' } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('downloads completed envelope bytes', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(Uint8Array.from([37, 80, 68, 70]), { status: 200 }));
    const provider = new FoxitESignProvider({ host: 'https://host.test', clientId: 'id', clientSecret: 'secret', fetchImpl: fetchImpl as typeof fetch });
    const bytes = await provider.download('42');

    expect(bytes.toString()).toBe('%PDF');
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://host.test/esign/api/v1/folders/download?folderId=42');
  });
});
