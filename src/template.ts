import type { DocumentPlan, Recipient } from './types.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderAgreement(plan: DocumentPlan, recipient: Recipient): string {
  const clauses = plan.clauses.map((clause, index) => `
    <section class="clause">
      <h2>${index + 1}. ${escapeHtml(clause.heading)}</h2>
      <p>${escapeHtml(clause.body)}</p>
    </section>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 54px 62px; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17211d; font: 13px/1.55 Georgia, serif; }
    .eyebrow { color: #3c6a54; font: 700 10px/1.2 Arial, sans-serif; letter-spacing: .18em; text-transform: uppercase; }
    h1 { margin: 16px 0 7px; font-size: 28px; line-height: 1.08; }
    .meta { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #17211d; color: #55635c; }
    .purpose { padding: 14px 16px; background: #eff3ed; border-left: 4px solid #69da86; }
    .clause { break-inside: avoid; margin-top: 17px; }
    h2 { margin: 0 0 5px; font: 700 13px/1.3 Arial, sans-serif; }
    p { margin: 0; }
    .sign { margin-top: 38px; padding-top: 18px; border-top: 1px solid #adb7b0; }
    .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
    .line { margin-top: 36px; border-top: 1px solid #17211d; padding-top: 5px; }
    .foxit-tag { color: #fff; font-size: 2px; line-height: 2px; }
    footer { margin-top: 26px; color: #68756e; font: 9px/1.4 Arial, sans-serif; }
  </style>
</head>
<body>
  <div class="eyebrow">Prepared through SignGate · exact-artifact review required</div>
  <h1>${escapeHtml(plan.title)}</h1>
  <div class="meta">Effective ${escapeHtml(plan.effectiveDate)} · ${plan.termDays} days · ${escapeHtml(plan.governingLaw)} law</div>
  <div class="purpose"><strong>Purpose.</strong> ${escapeHtml(plan.purpose)}</div>
  ${clauses}
  <section class="sign">
    <h2>Acceptance</h2>
    <p>By signing, the recipient confirms authority to accept this agreement.</p>
    <div class="sign-grid">
      <div>
        <div class="foxit-tag">\${signfield:1:y:Signer_signature:________________}</div>
        <div class="line">${escapeHtml(recipient.firstName)} ${escapeHtml(recipient.lastName)} · Signature</div>
      </div>
      <div>
        <div class="foxit-tag">\${datefield:1:y:Date_signed:____________}</div>
        <div class="line">Date signed</div>
      </div>
    </div>
  </section>
  <footer>This draft was generated from a user brief and must be reviewed by a qualified person before use. SignGate is not a law firm and does not provide legal advice.</footer>
</body>
</html>`;
}
