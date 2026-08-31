# SignGate

**Let the agent prepare anything. Let it send only this.**

SignGate turns a plain-language brief into a signable agreement, renders it through Foxit's official PDF API MCP, and permits Foxit eSign dispatch only for the exact PDF and exact recipient a human approved. One approval authorizes one provider attempt. Change one byte or the email address and the gate closes.

Built for the **DevNetwork [API + Cloud + AI] Hackathon 2026 — Foxit challenge**.

## Why this exists

Prompt-to-document products make creation fast, then treat “Send” as a normal next step. That is the dangerous boundary. An agent can quietly rewrite a clause, change a recipient, reuse old consent, or retry after a timeout that may already have sent an invitation.

SignGate separates preparation from authority:

```text
brief
  → local AI extracts document shape
  → deterministic policy compiler writes the commitments
  → official Foxit MCP renders the PDF
  → SHA-256 + exact recipient + risks shown to a human
  → exact phrase + two attestations mint one one-shot receipt
  → Foxit eSign receives that exact PDF once
  → terminal Foxit status is re-read
  → completed signed PDF is downloaded, hashed, and added to the audit chain
```

The AI can suggest. It cannot invent the authority to send.

## The decisive demo

1. Click **Prepare exact artifact**.
2. Inspect the document, recipient, risk signals, and full SHA-256.
3. Type the generated `APPROVE XXXXXXXX` phrase and check both attestations.
4. Click **Change recipient, then try**.
5. SignGate returns `APPROVAL_BINDING_BROKEN`; no provider call occurs and the approval remains unspent.

For the success path, prepare a fresh artifact, approve it, and dispatch. Without Foxit credentials, the UI explicitly says **HTML PROOF / DEMO** and reports that no PDF, envelope, or email was created. With credentials and the live-send flag, the same path uses Foxit.

## What is mechanically enforced

| Failure mode | Code-enforced response |
| --- | --- |
| Vague consent such as “yes” | Rejected; exact digest phrase required |
| Recipient changes after approval | Hard block before eSign |
| Artifact changes after approval | SHA-256 mismatch; hard block before eSign |
| Reusing one approval | Rejected as `APPROVAL_SPENT` |
| Provider timeout / ambiguous result | Approval stays spent; no automatic retry or false success |
| Model invents a new commercial obligation | Model clauses are discarded; deterministic clause compiler owns commitment text |
| Missing Foxit credentials | Honest demo mode; no Foxit claims |
| Signature still pending | No final download or completion claim |
| Completed signature | Final Foxit PDF downloaded, separately hashed, and audit-chained |

The gate is in [`src/service.ts`](src/service.ts), not in an LLM prompt.

## Foxit is load-bearing

### PDF Services via the official MCP

Live rendering starts the published [`@foxitsoftware/foxit-pdf-api-mcp-server`](https://github.com/foxitsoftware/foxit-pdf-api-mcp-server) package and calls:

```text
upload_document → pdf_from_html → download_document
```

Intermediate Foxit documents are deleted after the local PDF is safely downloaded. The resulting PDF bytes—not the source prompt—are fingerprinted for approval.

### eSign API

After approval, SignGate calls:

```text
POST /esign/api/v1/folders/createfolder
inputType: base64
processTextTags: true
sendNow: true
```

The generated PDF contains required party-1 signature and date tags. `parties[0].sequence` is fixed to `1`, so the field assignment and recipient cannot drift apart.

After the signer acts, SignGate re-reads:

```text
GET /esign/api/v1/folders/myfolder?folderId=…
```

Only `EXECUTED`, `COMPLETED`, or `COMPLETE` unlocks the final download:

```text
GET /esign/api/v1/folders/download?folderId=…
```

## AI without autonomous legal hallucinations

The local Ollama planner extracts a title, duration, and governing law from the brief. SignGate then replaces model-authored obligations with a deterministic, inspectable clause set. The original brief remains the purpose statement.

If Ollama is unavailable or its JSON fails schema validation, a deterministic parser takes over. The UI still works; the fallback is not hidden.

Default local model: `qwen2.5:1.5b-instruct`.

## Audit evidence

Every material transition is appended to a SHA-256 hash chain:

- artifact prepared;
- exact artifact approved;
- dispatch attempted;
- envelope sent, simulated, blocked, or uncertain;
- signature pending;
- final signed artifact collected.

Recipient addresses are represented by hashes in the audit payload. The product UI displays the exact recipient only where a human must verify it.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm start
```

Open `http://127.0.0.1:8787`.

Demo mode is the safe default. It runs the full approval and adversarial flows but sends nothing.

### Enable the real Foxit path

Copy `.env.example` to `.env` and load the values into your process environment:

```bash
FOXIT_CLOUD_API_HOST=https://na1.fusion.foxit.com/pdf-services
FOXIT_CLOUD_API_CLIENT_ID=…
FOXIT_CLOUD_API_CLIENT_SECRET=…
FOXIT_ESIGN_HOST=https://na1.fusion.foxit.com
SIGNGATE_LIVE_SEND_ENABLED=false
```

With credentials present and the send flag still `false`, Foxit PDF rendering is live while eSign remains mechanically disarmed. Set `SIGNGATE_LIVE_SEND_ENABLED=true` only when the displayed recipient has consented to receive the signing invitation.

Secrets stay server-side and `.env` is gitignored.

## Verification

```bash
npm run check
npm run test:coverage
```

Current verified result:

- **38 tests passing**;
- **93.15% statements / lines coverage** across the tested application core;
- TypeScript strict typecheck passing;
- npm audit: **0 known vulnerabilities**;
- local Ollama real inference verified;
- headless Chromium passes prepare → approve → transparent simulation;
- headless Chromium passes post-approval recipient mutation → hard block;
- desktop and mobile layouts have no horizontal overflow.

Browser verification uses the native Playwright script at [`test/browser_e2e.py`](test/browser_e2e.py).

## Honest current status

| Layer | Status |
| --- | --- |
| Local Ollama extraction | Real and verified |
| Deterministic commitment compiler | Real and tested |
| Exact-artifact / recipient gate | Real and adversarially tested |
| One-shot approval semantics | Real and tested |
| Browser product flow | Real and tested |
| Official Foxit MCP adapter | Implemented and unit-tested against the official tool contract |
| Live Foxit PDF proof | Pending developer-account identity verification and credentials |
| Live eSign invitation | Pending credentials, a consented signer, and explicit live-send enablement |
| Final human signature proof | Pending the live invitation and human signature |

No README, UI, or submission should claim the final three rows are complete until their provider evidence exists.

## Project map

| Path | Responsibility |
| --- | --- |
| `src/planner.ts` | Ollama extraction, validation, deterministic fallback and commitment compiler |
| `src/template.ts` | Signable HTML with Foxit party-1 Text Tags |
| `src/pdf-engine.ts` | Official Foxit MCP client and honest demo engine |
| `src/esign.ts` | Direct Foxit eSign create, status, and final download client |
| `src/service.ts` | Exact-artifact gate, one-shot semantics, terminal proof collection |
| `src/audit.ts` | Append-only hash-chained evidence |
| `public/` | Judge-facing product interface |
| `test/` | Unit, API, adapter, adversarial, and browser checks |

## Scope and limitations

- This event build supports one document and one signer per run.
- The built-in agreement is a short evaluation agreement, not a universal legal-document generator.
- SignGate is not a law firm and does not provide legal advice.
- The audit trail is local and append-only within one server process; production deployment should persist it to durable storage with access control.
- eSign completion is currently checked on demand. A production deployment should also verify Foxit webhooks.

## Third-party foundation

SignGate deliberately reuses Foxit's official MCP server, the Model Context Protocol SDK, Express, Zod, Ollama, Vitest, and Playwright. See [`THIRD_PARTY.md`](THIRD_PARTY.md). No Foxit SDK behavior is reimplemented.

MIT licensed.
