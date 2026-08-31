# SignGate

**One approval. One exact artifact. One provider attempt.**

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
| Live-send switch is off | Rejected before approval consumption and before any provider call |
| Service restarts after sending | Checksum-verified draft, spent receipt, and Foxit folder ID are restored; no resend |
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

The JSONL chain is serialized under concurrent requests, then loaded and verified when the server starts, so sequence and `previousHash` continuity survive restarts. Draft state is also atomically stored with a metadata digest and artifact-content digests. A sent Foxit folder can therefore be queried and collected after restart without minting another approval or invitation. If persisted evidence, source artifact bytes, or final signed bytes fail verification, startup fails closed.

## Interface as evidence

The interface is designed as a chain-of-custody instrument rather than a generic AI landing page. State changes drive the visuals: the artifact moves through the provenance route, Foxit rendering activates a scanner beam, approval lands as a seal, tampering trips the route into a hard-block state, and final completion draws the signature trace.

The state animation uses pinned MIT-licensed [Motion](https://github.com/motiondivision/motion) and [tsParticles](https://github.com/tsparticles/tsparticles) packages. Particles are confined to the provenance channel, disabled on the compact layout, and removed when the operating system requests reduced motion.

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

With credentials present and the send flag still `false`, Foxit PDF rendering is live while new eSign dispatch remains mechanically disarmed before approval consumption. Status and final-download calls for an already-sent envelope remain available. Set `SIGNGATE_LIVE_SEND_ENABLED=true` only when the displayed recipient has consented to receive the signing invitation.

Secrets stay server-side and `.env` is gitignored.

## Verification

```bash
npm run check
npm run test:coverage
```

Current verified result:

- **48 tests passing**;
- **92.79% statements / lines, 75.52% branches, and 95.16% functions coverage** across the tested application core;
- TypeScript strict typecheck passing;
- npm audit: **0 known vulnerabilities**;
- local Ollama real inference verified;
- headless Chromium passes prepare → approve → transparent simulation;
- headless Chromium passes post-approval recipient mutation → hard block;
- desktop and mobile layouts have no horizontal overflow;
- state-linked Motion and tsParticles effects load without console errors;
- reduced-motion mode removes ambient effects;
- live Foxit MCP returned a visually verified 85,253-byte A4 PDF;
- live Foxit eSign accepted one invitation to a consented self-test recipient and a fresh status read correctly reports signature pending.
- the real sent envelope and spent approval survive a cold restart while new dispatch remains disabled.

With the app running in demo mode, browser verification is reproducible with `npm run test:e2e`; the native Playwright script lives at [`test/browser-e2e.mjs`](test/browser-e2e.mjs).

## Honest current status

| Layer | Status |
| --- | --- |
| Local Ollama extraction | Real and verified |
| Deterministic commitment compiler | Real and tested |
| Exact-artifact / recipient gate | Real and adversarially tested |
| One-shot approval semantics | Real and tested |
| Browser product flow | Real and tested |
| Official Foxit MCP adapter | Real, regression-tested, and executed against Foxit |
| Live Foxit PDF proof | Complete; provider-rendered PDF downloaded, hashed, and visually inspected |
| Foxit eSign activation and draft | Complete in the US-region sandbox |
| Live eSign invitation | Complete; sent once to a consented self-test recipient, then status re-read as pending |
| Cross-restart envelope recovery | Complete; recovered from checksummed state and re-queried with new dispatch disarmed |
| Final human signature proof | Pending the recipient's manual signature in the delivered invitation |

No README, UI, or submission should claim a completed signature or final signed PDF until the recipient acts and the matching provider evidence exists.

## Project map

| Path | Responsibility |
| --- | --- |
| `src/planner.ts` | Ollama extraction, validation, deterministic fallback and commitment compiler |
| `src/template.ts` | Signable HTML with Foxit party-1 Text Tags |
| `src/pdf-engine.ts` | Official Foxit MCP client and honest demo engine |
| `src/esign.ts` | Direct Foxit eSign create, status, and final download client |
| `src/service.ts` | Exact-artifact gate, one-shot semantics, terminal proof collection |
| `src/draft-store.ts` | Atomic, checksum-verified draft and envelope recovery across restarts |
| `src/audit.ts` | Append-only hash-chained evidence |
| `public/` | Judge-facing product interface |
| `test/` | Unit, API, adapter, adversarial, and browser checks |

## Scope and limitations

- This event build supports one document and one signer per run.
- The built-in agreement is a short evaluation agreement, not a universal legal-document generator.
- SignGate is not a law firm and does not provide legal advice.
- Draft/envelope state is local, private-permission JSON plus content digests; production deployment should use an authenticated transactional datastore.
- The audit trail is a persistent, restart-verified local JSONL chain; production deployment should move it to access-controlled WORM or equivalent durable storage.
- eSign completion is currently checked on demand. A production deployment should also verify Foxit webhooks.

## Third-party foundation

SignGate deliberately reuses Foxit's official MCP server, the Model Context Protocol SDK, Express, Zod, Ollama, Motion, tsParticles, Vitest, and Playwright. See [`THIRD_PARTY.md`](THIRD_PARTY.md). No Foxit SDK or animation runtime is reimplemented.

MIT licensed.
