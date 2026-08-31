# Devpost submission copy

## Project name

SignGate

## Tagline

A document agent that can prepare anything—but can send only the exact file a human approved.

## Inspiration

Document agents are becoming good at drafting, converting, and routing files. Their weak point is authority: a human approves an idea, then the agent may regenerate the file, change a recipient, reuse consent, or retry an uncertain send. We wanted the convenience of prompt-to-signature without turning “the model thought you said yes” into a security boundary.

## What it does

SignGate converts a business brief into a short signable agreement. A local model extracts document structure, but deterministic code owns the commitment text. Foxit's official PDF API MCP renders the artifact. SignGate then shows the exact recipient, risks, and PDF SHA-256. A human must type a digest-bound phrase and attest to recipient and authority. That approval can authorize one eSign attempt for one unchanged PDF and recipient.

After signing, SignGate re-reads Foxit's terminal envelope status, downloads the completed PDF, computes a second SHA-256, and appends the proof to a hash-chained audit trail.

## How we built it

- TypeScript + Express for the local service;
- Ollama for structured intent extraction with a deterministic fallback;
- Zod for strict document-plan validation;
- Foxit's official `@foxitsoftware/foxit-pdf-api-mcp-server` for upload, HTML-to-PDF, download, and cleanup;
- Foxit eSign REST API for one-recipient signature dispatch, status, and final download;
- SHA-256 content addressing and one-shot receipts for the safety gate;
- a responsive chain-of-custody UI in HTML/CSS/JavaScript with MIT-licensed Motion and tsParticles effects;
- Vitest, Supertest, and native Playwright for verification.

## What is novel

Most document automation approves an intent and later sends a regenerated artifact. SignGate moves approval after Foxit rendering and binds it to the actual bytes. The same mechanism proves a negative: the judge can mutate the recipient after approval and watch the system refuse to call eSign.

We also learned that schema-valid model output can still invent contradictory obligations. SignGate therefore treats AI output as a suggestion and compiles the legal commitment surface deterministically.

## Challenges

The hard part was not calling an API. It was handling ambiguity safely:

- Foxit eSign success must include a folder ID;
- a timeout may mean the email was already sent, so automatic retry is unsafe;
- Text Tag party numbers and recipient sequences must stay aligned;
- signature completion must be re-read from Foxit before a final document can be claimed;
- demo mode must remain useful without pretending provider evidence exists;
- the official MCP upload tool accepts an absolute `filePath`, not an in-memory base64 substitute, which only a live provider run exposed;
- a local audit chain must resume and verify across restarts rather than silently opening a new genesis segment;
- sent-envelope state must survive restart while a disabled live-send switch blocks new invitations before consuming approval.

## Accomplishments

- exact PDF and recipient binding;
- one approval = one provider attempt;
- adversarial recipient and byte-mutation blocks;
- live-verified official Foxit MCP integration with remote cleanup;
- direct eSign create, terminal status, and completed-file path;
- one real sandbox eSign invitation to a consented self-test recipient, completed to `EXECUTED` and downloaded with a second SHA-256;
- valid detached SHA-256 signature evidence plus a pixel-identical post-sign DSS revision;
- append-only hash-chained audit evidence that persists and verifies across restarts;
- atomic, checksum-verified recovery of the sent envelope and spent approval across a cold restart;
- 48 tests and 92.79% core statement/line coverage;
- verified desktop, mobile, motion, and reduced-motion browser flows.

The completed provider artifact visibly carries Foxit's sandbox `TEST MODE` watermark. It proves the end-to-end mechanism and human control, not production legal execution.

## What we learned

The trustworthy product boundary is not “AI generated a correct document.” It is “a human saw one immutable artifact and authorized one precisely bounded consequence.” Foxit's asynchronous PDF and signature lifecycles make this distinction concrete: generation, approval, dispatch, and completion are four different facts and need four different proofs.

## What's next

- remote WORM audit storage and authenticated teams;
- verified Foxit webhooks in addition to on-demand status checks;
- multi-party sequence visualization;
- policy packs for procurement, sales, HR, and clinical-trial operations;
- reusable Foxit templates with the same exact-artifact gate.

## Testing instructions

Run `npm install && npm start`, open `http://127.0.0.1:8787`, and follow the 90-second proof in `JUDGING.md`. With the app running in demo mode, `npm run test:e2e` reproduces the browser checks. Demo mode sends nothing. For live testing, configure the Foxit variables from `.env.example`; keep `SIGNGATE_LIVE_SEND_ENABLED=false` until using a consented signer.
