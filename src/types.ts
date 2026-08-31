import { z } from 'zod';

export const RecipientSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
});

export const PrepareDraftSchema = z.object({
  prompt: z.string().trim().min(20).max(4_000),
  recipient: RecipientSchema,
});

export const DocumentPlanSchema = z.object({
  title: z.string().trim().min(3).max(120),
  purpose: z.string().trim().min(10).max(600),
  effectiveDate: z.string().trim().min(4).max(40),
  termDays: z.number().int().min(1).max(3_650),
  governingLaw: z.string().trim().min(2).max(100),
  clauses: z.array(z.object({
    heading: z.string().trim().min(2).max(80),
    body: z.string().trim().min(10).max(900),
  })).min(3).max(7),
});

export type Recipient = z.infer<typeof RecipientSchema>;
export type PrepareDraftInput = z.infer<typeof PrepareDraftSchema>;
export type DocumentPlan = z.infer<typeof DocumentPlanSchema>;

export type ExecutionMode = 'live' | 'demo';
export type DraftStatus = 'prepared' | 'approved' | 'sent' | 'completed' | 'simulated' | 'blocked' | 'uncertain';

export interface PdfEvidence {
  mode: ExecutionMode;
  provider: 'foxit-pdf-api-mcp' | 'deterministic-preview';
  tools: string[];
  taskId?: string;
  sourceDocumentId?: string;
  resultDocumentId?: string;
  artifactLabel: string;
}

export interface PreparedArtifact {
  bytes: Buffer;
  path: string;
  evidence: PdfEvidence;
}

export interface RiskSignal {
  level: 'info' | 'warning' | 'critical';
  label: string;
  detail: string;
}

export interface ApprovalReceipt {
  id: string;
  draftId: string;
  pdfSha256: string;
  recipientEmail: string;
  approvedAt: string;
  consumedAt?: string;
}

export interface EnvelopeResult {
  mode: ExecutionMode;
  status: 'sent' | 'simulated' | 'uncertain';
  folderId?: string;
  providerStatus?: string;
  detail: string;
}

export interface FinalProof {
  folderId: string;
  providerStatus: string;
  signedSha256: string;
  downloadedAt: string;
  path: string;
}

export interface DraftRecord {
  id: string;
  prompt: string;
  recipient: Recipient;
  plan: DocumentPlan;
  html: string;
  artifact: PreparedArtifact;
  pdfSha256: string;
  approvalPhrase: string;
  risks: RiskSignal[];
  status: DraftStatus;
  createdAt: string;
  approval?: ApprovalReceipt;
  envelope?: EnvelopeResult;
  finalProof?: FinalProof;
}

export interface PublicDraft {
  id: string;
  recipient: Recipient;
  plan: DocumentPlan;
  pdfSha256: string;
  approvalPhrase: string;
  risks: RiskSignal[];
  status: DraftStatus;
  createdAt: string;
  evidence: PdfEvidence;
  artifactUrl: string;
  approval?: ApprovalReceipt;
  envelope?: EnvelopeResult;
  finalProof?: Omit<FinalProof, 'path'> & { artifactUrl: string };
}
