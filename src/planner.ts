import { DocumentPlanSchema, type DocumentPlan } from './types.js';

export interface DocumentPlanner {
  readonly mode: 'ollama' | 'deterministic';
  plan(prompt: string): Promise<DocumentPlan>;
}

function inferTermDays(prompt: string): number {
  const days = prompt.match(/(\d{1,4})\s*[- ]?day/i)?.[1];
  const weeks = prompt.match(/(\d{1,3})\s*[- ]?week/i)?.[1];
  const months = prompt.match(/(\d{1,2})\s*[- ]?month/i)?.[1];
  if (days) return Math.min(3_650, Number(days));
  if (weeks) return Math.min(3_650, Number(weeks) * 7);
  if (months) return Math.min(3_650, Number(months) * 30);
  return 30;
}

function inferLaw(prompt: string): string {
  const candidates = ['Hong Kong', 'California', 'New York', 'England and Wales', 'Singapore'];
  return candidates.find((candidate) => prompt.toLowerCase().includes(candidate.toLowerCase())) ?? 'Hong Kong';
}

function normalizeLaw(value: string): string {
  return value.replace(/^laws?\s+of\s+/i, '').replace(/\s+law$/i, '').trim();
}

function standardClauses(termDays: number, governingLaw: string): DocumentPlan['clauses'] {
  return [
    {
      heading: 'Evaluation scope',
      body: 'The parties may exchange materials solely to evaluate the project described in the brief. No production deployment, resale, or unrelated use is authorized.',
    },
    {
      heading: 'Confidential handling',
      body: 'Each party will protect non-public materials with reasonable care, limit access to people working on the evaluation, and use the materials only for the stated purpose.',
    },
    {
      heading: 'No commercial commitment',
      body: 'The evaluation creates no fee, exclusivity, purchase obligation, employment relationship, partnership, or license except the limited evaluation right stated here.',
    },
    {
      heading: 'Return and deletion',
      body: 'On written request, each party will return or delete confidential materials, except for one archival copy retained solely for legal compliance.',
    },
    {
      heading: 'Term and law',
      body: `This agreement lasts ${termDays} days from the effective date and is governed by the laws of ${governingLaw}.`,
    },
  ];
}

export class DeterministicPlanner implements DocumentPlanner {
  readonly mode = 'deterministic' as const;

  async plan(prompt: string): Promise<DocumentPlan> {
    const purpose = prompt.replace(/\s+/g, ' ').trim().slice(0, 600);
    const termDays = inferTermDays(prompt);
    const governingLaw = inferLaw(prompt);
    return DocumentPlanSchema.parse({
      title: /nda|non-disclosure|confidential/i.test(prompt)
        ? 'Mutual Non-Disclosure Agreement'
        : 'Mutual Evaluation Agreement',
      purpose,
      effectiveDate: new Date().toISOString().slice(0, 10),
      termDays,
      governingLaw,
      clauses: standardClauses(termDays, governingLaw),
    });
  }
}

interface OllamaPlannerOptions {
  host?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class OllamaPlanner implements DocumentPlanner {
  readonly mode = 'ollama' as const;
  private readonly host: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OllamaPlannerOptions = {}) {
    this.host = (options.host ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b-instruct';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async plan(prompt: string): Promise<DocumentPlan> {
    const response = await this.fetchImpl(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [
          {
            role: 'system',
            content: 'You compile a short business agreement plan. Return JSON only with title, purpose, effectiveDate, termDays, governingLaw, and 3-7 clauses. Each clause has heading and body. Do not invent names, prices, warranties, or obligations absent from the brief. This is a draft for human review, not legal advice.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama planner returned HTTP ${response.status}`);
    const body = await response.json() as { message?: { content?: string } };
    if (!body.message?.content) throw new Error('Ollama planner returned no content');
    const suggestion = DocumentPlanSchema.parse(JSON.parse(body.message.content));
    const purpose = prompt.replace(/\s+/g, ' ').trim().slice(0, 600);
    return DocumentPlanSchema.parse({
      title: suggestion.title.replace(/^\d+[.)]\s*/, ''),
      purpose,
      effectiveDate: new Date().toISOString().slice(0, 10),
      termDays: suggestion.termDays,
      governingLaw: normalizeLaw(suggestion.governingLaw),
      clauses: standardClauses(suggestion.termDays, normalizeLaw(suggestion.governingLaw)),
    });
  }
}

export class ResilientPlanner implements DocumentPlanner {
  readonly mode: 'ollama' | 'deterministic' = 'ollama';

  constructor(
    private readonly primary: DocumentPlanner = new OllamaPlanner(),
    private readonly fallback: DocumentPlanner = new DeterministicPlanner(),
  ) {}

  async plan(prompt: string): Promise<DocumentPlan> {
    try {
      return await this.primary.plan(prompt);
    } catch {
      return this.fallback.plan(prompt);
    }
  }
}
