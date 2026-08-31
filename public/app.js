const $ = (selector) => document.querySelector(selector);

const state = {
  runtime: null,
  draft: null,
};

const elements = {
  form: $('#brief-form'),
  prepare: $('#prepare-button'),
  liveState: $('#live-state'),
  artifactMode: $('#artifact-mode'),
  placeholder: $('#paper-placeholder'),
  paper: $('#paper'),
  paperRegisterState: $('#paper-register-state'),
  title: $('#doc-title'),
  meta: $('#doc-meta'),
  purpose: $('#doc-purpose'),
  clauses: $('#doc-clauses'),
  fingerprint: $('#fingerprint'),
  hash: $('#artifact-hash'),
  artifactLink: $('#artifact-link'),
  riskStack: $('#risk-stack'),
  approvalBox: $('#approval-box'),
  sealLabel: $('#seal-label'),
  requiredPhrase: $('#required-phrase'),
  phrase: $('#approval-phrase'),
  attestRecipient: $('#attest-recipient'),
  attestAuthority: $('#attest-authority'),
  approve: $('#approve-button'),
  send: $('#send-button'),
  tamper: $('#tamper-button'),
  final: $('#final-button'),
  gateResult: $('#gate-result'),
  log: $('#event-log'),
  auditValid: $('#audit-valid'),
};

function clock() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function log(message, error = false) {
  const item = document.createElement('li');
  if (error) item.className = 'error';
  const time = document.createElement('time');
  time.textContent = clock();
  const text = document.createElement('span');
  text.textContent = message;
  item.append(time, text);
  elements.log.prepend(item);
}

function emit(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(`signgate:${name}`, { detail }));
}

function setStage(stage) {
  const order = ['brief', 'render', 'approve', 'send', 'proof'];
  const current = order.indexOf(stage);
  document.querySelectorAll('.rail li').forEach((item) => {
    const index = order.indexOf(item.dataset.stage);
    item.classList.toggle('active', index === current);
    item.classList.toggle('done', index < current);
  });
  emit('stage', { stage });
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `Request failed (${response.status})`);
    error.code = body.error;
    throw error;
  }
  return body;
}

function renderRuntime(runtime) {
  state.runtime = runtime;
  const dispatchArmed = runtime.eSignMode === 'live' && runtime.liveSendEnabled === true;
  const live = runtime.pdfMode === 'live' && dispatchArmed;
  elements.liveState.classList.remove('live', 'demo');
  elements.liveState.classList.add(live ? 'live' : 'demo');
  elements.liveState.querySelector('span:last-child').textContent = live
    ? 'Foxit live · dispatch armed'
    : runtime.pdfMode === 'live'
      ? 'Foxit PDF live · eSign safely disarmed'
      : 'Transparent demo · no external send';
  elements.auditValid.textContent = runtime.auditChainValid ? 'HASH CHAIN VALID' : 'CHAIN INVALID';
  emit('runtime', { live, dispatchArmed, pdfMode: runtime.pdfMode, eSignMode: runtime.eSignMode });
}

function renderDraft(draft) {
  state.draft = draft;
  elements.form.elements.email.value = draft.recipient.email;
  if (draft.status === 'prepared' || draft.status === 'approved') {
    elements.gateResult.hidden = true;
    elements.gateResult.className = 'gate-result';
  }
  elements.placeholder.hidden = true;
  elements.paper.hidden = false;
  elements.title.textContent = draft.plan.title;
  elements.meta.textContent = `Effective ${draft.plan.effectiveDate} · ${draft.plan.termDays} days · ${draft.plan.governingLaw} law`;
  elements.purpose.textContent = draft.plan.purpose;
  elements.clauses.replaceChildren(...draft.plan.clauses.map((clause, index) => {
    const section = document.createElement('section');
    section.className = 'doc-clause';
    const heading = document.createElement('h4');
    heading.textContent = `${index + 1}. ${clause.heading}`;
    const body = document.createElement('p');
    body.textContent = clause.body;
    section.append(heading, body);
    return section;
  }));

  elements.artifactMode.className = `mode-chip ${draft.evidence.mode}`;
  elements.artifactMode.textContent = draft.evidence.mode === 'live' ? 'FOXIT PDF / LIVE' : 'HTML PROOF / DEMO';
  elements.fingerprint.hidden = false;
  elements.hash.textContent = draft.pdfSha256;
  elements.hash.title = draft.pdfSha256;
  elements.artifactLink.href = draft.artifactUrl;

  elements.riskStack.replaceChildren(...draft.risks.map((risk) => {
    const item = document.createElement('div');
    item.className = `risk ${risk.level}`;
    const dot = document.createElement('span');
    dot.className = 'risk-dot';
    const content = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = risk.label;
    const detail = document.createElement('p');
    detail.textContent = risk.detail;
    content.append(strong, detail);
    item.append(dot, content);
    return item;
  }));

  elements.requiredPhrase.textContent = draft.approvalPhrase;
  const prepared = draft.status === 'prepared';
  const approved = draft.status === 'approved';
  const dispatchAvailable = state.runtime?.eSignMode !== 'live' || state.runtime?.liveSendEnabled === true;
  elements.approvalBox.classList.toggle('is-locked', !prepared);
  elements.approvalBox.classList.toggle('is-approved', ['approved', 'sent', 'completed', 'simulated', 'uncertain'].includes(draft.status));
  elements.sealLabel.textContent = prepared
    ? 'REVIEW'
    : draft.status === 'approved'
      ? 'APPROVED'
      : draft.status === 'sent'
        ? 'DISPATCHED'
        : draft.status === 'completed'
          ? 'SIGNED'
          : draft.status === 'simulated'
            ? 'CONSUMED'
            : draft.status === 'uncertain'
              ? 'SPENT'
              : draft.status === 'blocked'
                ? 'VOID'
          : 'LOCKED';
  elements.paperRegisterState.textContent = draft.status === 'completed'
    ? 'SIGNED'
    : ['approved', 'sent', 'simulated', 'uncertain'].includes(draft.status)
      ? 'APPROVED'
      : 'UNSIGNED';
  elements.phrase.disabled = !prepared;
  elements.attestRecipient.disabled = !prepared;
  elements.attestAuthority.disabled = !prepared;
  elements.approve.disabled = !prepared;
  elements.send.disabled = !approved || !dispatchAvailable;
  elements.send.title = approved && !dispatchAvailable
    ? 'Live dispatch is disarmed. Set SIGNGATE_LIVE_SEND_ENABLED=true before consuming this approval.'
    : '';
  elements.tamper.disabled = !approved;
  elements.final.disabled = !(draft.status === 'sent' && draft.envelope?.mode === 'live');

  if (draft.approval) {
    elements.phrase.value = draft.approvalPhrase;
    elements.attestRecipient.checked = true;
    elements.attestAuthority.checked = true;
  }
  setStage(draft.status === 'prepared' ? 'approve' : draft.status === 'approved' ? 'send' : 'proof');
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(elements.form);
  elements.prepare.disabled = true;
  elements.prepare.classList.add('busy');
  elements.prepare.querySelector('span:first-child').textContent = 'Structuring + rendering…';
  setStage('render');
  emit('scan-start');
  log('Brief frozen. Preparing one recipient-bound artifact.');
  try {
    const draft = await request('/api/drafts', {
      method: 'POST',
      body: JSON.stringify({
        prompt: data.get('prompt'),
        recipient: {
          firstName: data.get('firstName'),
          lastName: data.get('lastName'),
          email: data.get('email'),
        },
      }),
    });
    renderDraft(draft);
    emit('artifact', { hash: draft.pdfSha256, mode: draft.evidence.mode });
    const route = draft.evidence.tools.length ? draft.evidence.tools.join(' → ') : 'deterministic HTML proof';
    log(`Artifact prepared via ${route}; SHA-256 ${draft.pdfSha256.slice(0, 12)}…`);
    await refreshStatus();
  } catch (error) {
    log(error.message, true);
    setStage('brief');
  } finally {
    emit('scan-stop');
    elements.prepare.disabled = false;
    elements.prepare.classList.remove('busy');
    elements.prepare.querySelector('span:first-child').textContent = 'Prepare exact artifact';
  }
});

elements.approve.addEventListener('click', async () => {
  if (!state.draft) return;
  elements.approve.disabled = true;
  try {
    const draft = await request(`/api/drafts/${state.draft.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        phrase: elements.phrase.value,
        attestExactRecipient: elements.attestRecipient.checked,
        attestAuthority: elements.attestAuthority.checked,
      }),
    });
    renderDraft(draft);
    emit('approved', { hash: draft.pdfSha256 });
    log(`One-shot approval issued for ${draft.pdfSha256.slice(0, 12)}… and the displayed recipient.`);
  } catch (error) {
    log(`Gate stayed closed: ${error.message}`, true);
    elements.approve.disabled = false;
  }
});

elements.send.addEventListener('click', async () => {
  if (!state.draft) return;
  elements.send.disabled = true;
  elements.tamper.disabled = true;
  log(state.runtime?.eSignMode === 'live' ? 'Consuming approval before one Foxit eSign attempt.' : 'Consuming approval in transparent simulation; no email will leave.');
  try {
    const draft = await request(`/api/drafts/${state.draft.id}/send`, { method: 'POST', body: '{}' });
    renderDraft(draft);
    emit('sent', { mode: draft.envelope.mode, status: draft.envelope.status });
    log(draft.envelope.detail);
    elements.gateResult.hidden = false;
    elements.gateResult.className = 'gate-result';
    elements.gateResult.textContent = draft.envelope.status === 'sent'
      ? `FOXIT ACCEPTED · FOLDER ${draft.envelope.folderId}`
      : 'DEMO CLOSED · APPROVAL CONSUMED · NO EMAIL SENT';
  } catch (error) {
    log(`${error.code || 'SEND_BLOCKED'}: ${error.message}`, true);
  }
});

elements.tamper.addEventListener('click', async () => {
  if (!state.draft) return;
  elements.send.disabled = true;
  elements.tamper.disabled = true;
  try {
    const mutated = await request(`/api/drafts/${state.draft.id}/tamper`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'recipient' }),
    });
    renderDraft(mutated);
    log('Adversarial test injected a different recipient after approval. Attempting dispatch…');
    await request(`/api/drafts/${state.draft.id}/send`, { method: 'POST', body: '{}' });
    log('Unexpected: tampered dispatch was accepted.', true);
  } catch (error) {
    log(`EXPECTED HARD BLOCK · ${error.code}: ${error.message}`);
    elements.gateResult.hidden = false;
    elements.gateResult.className = 'gate-result blocked';
    elements.gateResult.textContent = `EXPECTED HARD BLOCK · ${error.code} · ZERO PROVIDER CALLS`;
    setStage('proof');
    emit('tampered', { code: error.code });
  }
});

elements.final.addEventListener('click', async () => {
  if (!state.draft) return;
  elements.final.disabled = true;
  log('Re-reading Foxit envelope status before collecting a final artifact.');
  try {
    const draft = await request(`/api/drafts/${state.draft.id}/collect-final`, { method: 'POST', body: '{}' });
    renderDraft(draft);
    log(`Final signed PDF collected; SHA-256 ${draft.finalProof.signedSha256.slice(0, 12)}…`);
    elements.gateResult.hidden = false;
    elements.gateResult.className = 'gate-result';
    elements.gateResult.textContent = `FINAL FOXIT PROOF · ${draft.finalProof.providerStatus} · ${draft.finalProof.signedSha256.slice(0, 12)}…`;
    setStage('proof');
    emit('final', { hash: draft.finalProof.signedSha256 });
  } catch (error) {
    log(`${error.code || 'FINAL_NOT_READY'}: ${error.message}`, error.code !== 'SIGNATURE_PENDING');
    elements.final.disabled = false;
  }
});

async function refreshStatus() {
  const runtime = await request('/api/status');
  renderRuntime(runtime);
}

refreshStatus().catch((error) => log(`Runtime inspection failed: ${error.message}`, true));
