import { describe, expect, it, vi } from 'vitest';
import { OllamaPlanner, DeterministicPlanner, ResilientPlanner } from '../src/planner.js';
import { renderAgreement } from '../src/template.js';

describe('document planning and rendering', () => {
  it('extracts a bounded duration and governing law without an LLM', async () => {
    const plan = await new DeterministicPlanner().plan('Draft a 6-week NDA for evaluation under Singapore law.');
    expect(plan.termDays).toBe(42);
    expect(plan.governingLaw).toBe('Singapore');
    expect(plan.title).toBe('Mutual Non-Disclosure Agreement');
  });

  it('uses the structured Ollama response only after schema validation', async () => {
    const planned = {
      title: 'Pilot Agreement',
      purpose: 'Evaluate a document workflow for a limited commercial pilot.',
      effectiveDate: '2026-08-31',
      termDays: 14,
      governingLaw: 'Hong Kong',
      clauses: [
        { heading: 'Scope', body: 'The parties will evaluate the workflow only.' },
        { heading: 'Data', body: 'No production personal data may enter the pilot.' },
        { heading: 'Exit', body: 'Either party may stop the evaluation immediately.' },
      ],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: { content: JSON.stringify(planned) } }), { status: 200 }));
    const planner = new OllamaPlanner({ fetchImpl: fetchImpl as typeof fetch });

    const result = await planner.plan('A sufficiently detailed agreement prompt for testing.');
    expect(result).toMatchObject({
      title: 'Pilot Agreement',
      purpose: 'A sufficiently detailed agreement prompt for testing.',
      termDays: 14,
      governingLaw: 'Hong Kong',
    });
    expect(result.clauses).toHaveLength(5);
    expect(result.clauses.map((clause) => clause.heading)).toContain('No commercial commitment');
    expect(result.clauses.some((clause) => clause.body.includes('30 days'))).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('falls back deterministically when the local model is unavailable', async () => {
    const primary = { mode: 'ollama' as const, plan: vi.fn(async () => { throw new Error('offline'); }) };
    const planner = new ResilientPlanner(primary, new DeterministicPlanner());
    const plan = await planner.plan('Prepare a 10-day evaluation agreement governed by California law.');

    expect(plan.termDays).toBe(10);
    expect(plan.governingLaw).toBe('California');
  });

  it('escapes user-controlled content in the generated agreement', async () => {
    const plan = await new DeterministicPlanner().plan('Prepare an agreement for <script>alert(1)</script> lasting 10 days.');
    const html = renderAgreement(plan, { firstName: '<Jordan>', lastName: 'Lee', email: 'jordan@example.com' });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;Jordan&gt; Lee');
  });

  it('embeds required Foxit eSign tags for party one', async () => {
    const plan = await new DeterministicPlanner().plan('Prepare a 14-day pilot agreement governed by Hong Kong law.');
    const html = renderAgreement(plan, { firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com' });

    expect(html).toContain('${signfield:1:y:Signer_signature:________________}');
    expect(html).toContain('${datefield:1:y:Date_signed:____________}');
  });
});
