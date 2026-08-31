import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { PreparedArtifact } from './types.js';

export interface PdfEngine {
  readonly mode: 'live' | 'demo';
  prepare(html: string, draftId: string, runtimeDir: string): Promise<PreparedArtifact>;
}

export class DemoPdfEngine implements PdfEngine {
  readonly mode = 'demo' as const;

  async prepare(html: string, draftId: string, runtimeDir: string): Promise<PreparedArtifact> {
    const path = join(runtimeDir, `${draftId}.html`);
    const bytes = Buffer.from(html, 'utf8');
    await writeFile(path, bytes);
    return {
      bytes,
      path,
      evidence: {
        mode: 'demo',
        provider: 'deterministic-preview',
        tools: [],
        artifactLabel: 'HTML proof · no PDF or email claimed',
      },
    };
  }
}

interface ToolPayload {
  success: boolean;
  error?: string;
  code?: string;
  documentId?: string;
  taskId?: string;
  resultDocumentId?: string;
  outputPath?: string;
}

function childEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export function foxitCredentialsPresent(): boolean {
  return Boolean(process.env.FOXIT_CLOUD_API_CLIENT_ID && process.env.FOXIT_CLOUD_API_CLIENT_SECRET);
}

export interface McpClientLike {
  callTool(input: { name: string; arguments?: Record<string, unknown> }): Promise<{ content?: unknown }>;
  close(): Promise<void>;
}

export class FoxitMcpPdfEngine implements PdfEngine {
  readonly mode = 'live' as const;
  private client: McpClientLike | undefined;

  constructor(private readonly clientFactory?: () => Promise<McpClientLike>) {}

  private async getClient(): Promise<McpClientLike> {
    if (this.client) return this.client;
    if (this.clientFactory) {
      this.client = await this.clientFactory();
      return this.client;
    }
    if (!foxitCredentialsPresent()) throw new Error('Foxit PDF credentials are not configured');
    const transport = new StdioClientTransport({
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args: ['-y', '@foxitsoftware/foxit-pdf-api-mcp-server@0.2.3'],
      env: childEnv(),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'signgate', version: '0.1.0' });
    await client.connect(transport);
    this.client = client as McpClientLike;
    return this.client;
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<ToolPayload> {
    const client = await this.getClient();
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content.find((item) => item.type === 'text')?.text;
    if (!text) throw new Error(`Foxit MCP tool ${name} returned no text payload`);
    const payload = JSON.parse(text) as ToolPayload;
    if (!payload.success) throw new Error(`Foxit MCP ${name} failed: ${payload.error ?? payload.code ?? 'unknown error'}`);
    return payload;
  }

  async prepare(html: string, draftId: string, runtimeDir: string): Promise<PreparedArtifact> {
    let sourceDocumentId: string | undefined;
    let resultDocumentId: string | undefined;
    const sourcePath = join(runtimeDir, `${draftId}.html`);
    const outputPath = join(runtimeDir, `${draftId}.pdf`);
    try {
      await writeFile(sourcePath, html, 'utf8');
      const upload = await this.callTool('upload_document', {
        filePath: sourcePath,
      });
      if (!upload.documentId) throw new Error('Foxit MCP upload returned no documentId');
      sourceDocumentId = upload.documentId;

      const convert = await this.callTool('pdf_from_html', {
        documentId: sourceDocumentId,
        config: { pageMode: 'MULTIPLE_PAGE', scalingMode: 'SCALE' },
      });
      if (!convert.resultDocumentId) throw new Error('Foxit MCP conversion returned no resultDocumentId');
      resultDocumentId = convert.resultDocumentId;

      await this.callTool('download_document', {
        documentId: resultDocumentId,
        outputPath,
        filename: `${draftId}.pdf`,
      });
      const bytes = await readFile(outputPath);
      return {
        bytes,
        path: outputPath,
        evidence: {
          mode: 'live',
          provider: 'foxit-pdf-api-mcp',
          tools: ['upload_document', 'pdf_from_html', 'download_document'],
          ...(convert.taskId ? { taskId: convert.taskId } : {}),
          sourceDocumentId,
          resultDocumentId,
          artifactLabel: 'PDF rendered by official Foxit PDF API MCP',
        },
      };
    } finally {
      if (sourceDocumentId) await this.callTool('delete_document', { documentId: sourceDocumentId }).catch(() => undefined);
      if (resultDocumentId) await this.callTool('delete_document', { documentId: resultDocumentId }).catch(() => undefined);
      await unlink(sourcePath).catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
  }
}
