import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoPdfEngine, FoxitMcpPdfEngine, foxitCredentialsPresent, type McpClientLike } from '../src/pdf-engine.js';

function textPayload(payload: Record<string, unknown>) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

describe('PDF engines', () => {
  let runtimeDir: string;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), 'signgate-pdf-'));
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it('labels the deterministic preview as an HTML proof, never a Foxit PDF', async () => {
    const artifact = await new DemoPdfEngine().prepare('<html>proof</html>', 'draft', runtimeDir);
    expect(artifact.bytes.toString()).toBe('<html>proof</html>');
    expect(artifact.evidence).toMatchObject({ mode: 'demo', provider: 'deterministic-preview', tools: [] });
    expect(artifact.path).toBe(join(runtimeDir, 'draft.html'));
  });

  it('runs the official three-tool render path and cleans remote documents', async () => {
    const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
    const close = vi.fn(async () => undefined);
    const client: McpClientLike = {
      close,
      async callTool(input) {
        calls.push(input);
        if (input.name === 'upload_document') {
          const args = input.arguments ?? {};
          expect(args).toEqual({ filePath: join(runtimeDir, 'draft.html') });
          expect(await readFile(String(args.filePath), 'utf8')).toBe('<html>agreement</html>');
          return textPayload({ success: true, documentId: 'source-1' });
        }
        if (input.name === 'pdf_from_html') return textPayload({ success: true, taskId: 'task-1', resultDocumentId: 'pdf-1' });
        if (input.name === 'download_document') {
          await writeFile(String(input.arguments?.outputPath), Buffer.from('%PDF-live-proof'));
          return textPayload({ success: true, outputPath: input.arguments?.outputPath });
        }
        if (input.name === 'delete_document') return textPayload({ success: true });
        throw new Error(`unexpected tool ${input.name}`);
      },
    };
    const factory = vi.fn(async () => client);
    const engine = new FoxitMcpPdfEngine(factory);

    const artifact = await engine.prepare('<html>agreement</html>', 'draft', runtimeDir);

    expect(artifact.bytes.toString()).toBe('%PDF-live-proof');
    expect(artifact.evidence).toMatchObject({
      mode: 'live',
      provider: 'foxit-pdf-api-mcp',
      tools: ['upload_document', 'pdf_from_html', 'download_document'],
      taskId: 'task-1',
      sourceDocumentId: 'source-1',
      resultDocumentId: 'pdf-1',
    });
    expect(calls.map((call) => call.name)).toEqual([
      'upload_document',
      'pdf_from_html',
      'download_document',
      'delete_document',
      'delete_document',
    ]);
    await expect(readFile(join(runtimeDir, 'draft.html'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(factory).toHaveBeenCalledOnce();
    await engine.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('cleans the uploaded source when conversion fails', async () => {
    const calls: string[] = [];
    const client: McpClientLike = {
      close: async () => undefined,
      async callTool(input) {
        calls.push(input.name);
        if (input.name === 'upload_document') return textPayload({ success: true, documentId: 'source-1' });
        if (input.name === 'pdf_from_html') return textPayload({ success: false, error: 'conversion failed' });
        if (input.name === 'delete_document') return textPayload({ success: true });
        throw new Error('unexpected');
      },
    };
    const engine = new FoxitMcpPdfEngine(async () => client);

    await expect(engine.prepare('<html>agreement</html>', 'draft', runtimeDir)).rejects.toThrow('conversion failed');
    expect(calls).toEqual(['upload_document', 'pdf_from_html', 'delete_document']);
  });

  it('detects credential presence without exposing either credential', () => {
    const oldId = process.env.FOXIT_CLOUD_API_CLIENT_ID;
    const oldSecret = process.env.FOXIT_CLOUD_API_CLIENT_SECRET;
    delete process.env.FOXIT_CLOUD_API_CLIENT_ID;
    delete process.env.FOXIT_CLOUD_API_CLIENT_SECRET;
    expect(foxitCredentialsPresent()).toBe(false);
    process.env.FOXIT_CLOUD_API_CLIENT_ID = 'id';
    process.env.FOXIT_CLOUD_API_CLIENT_SECRET = 'secret';
    expect(foxitCredentialsPresent()).toBe(true);
    if (oldId === undefined) delete process.env.FOXIT_CLOUD_API_CLIENT_ID;
    else process.env.FOXIT_CLOUD_API_CLIENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.FOXIT_CLOUD_API_CLIENT_SECRET;
    else process.env.FOXIT_CLOUD_API_CLIENT_SECRET = oldSecret;
  });
});
