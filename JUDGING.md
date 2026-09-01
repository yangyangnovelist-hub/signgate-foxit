# SignGate judging guide

- Live judge build: https://signgate-foxit-production.up.railway.app/
- Narrated demo: https://youtu.be/-KQ27Cqxdfk
- Public source: https://github.com/yangyangnovelist-hub/signgate-foxit
- Executed Foxit proof: [`docs/evidence/foxit-live-proof.md`](docs/evidence/foxit-live-proof.md)

The public build is intentionally disarmed and labels itself **Transparent demo**. It proves the interactive controls without sending email. The linked evidence records the separate, completed Foxit sandbox lifecycle.

## 90-second proof

1. Open the app and point to the runtime badge. It must say either **Foxit live** or **Transparent demo**.
2. Click **Prepare exact artifact**.
3. Show the exact recipient, document SHA-256, Foxit evidence chip, and four risk signals.
4. Enter the exact approval phrase and both attestations.
5. Click **Change recipient, then try**.
6. Show `APPROVAL_BINDING_BROKEN` in the audit feed and explain that no eSign call occurred.
7. Prepare again, approve, and dispatch. In demo mode, show the explicit “sent no email” result. In live mode, show the Foxit folder ID.
8. After a real signer completes, click **Collect completed Foxit proof** and show the second SHA-256 for the signed PDF.

## What makes the integration non-trivial

- Foxit's official MCP performs the PDF lifecycle rather than appearing as a logo or export button.
- Foxit eSign Text Tags are generated into the document and aligned to recipient sequence `1`.
- Authority is bound to actual PDF bytes after Foxit rendering, not to a prompt or preview.
- The eSign adapter refuses success without a Foxit folder ID.
- Final proof requires a fresh terminal-state read and a downloadable signed artifact.

## Adversarial questions

| Judge asks | Show |
| --- | --- |
| “What if the agent changes the email?” | Tamper button → hard block |
| “What if it changes one PDF byte?” | Artifact mutation test in `test/service.test.ts` |
| “Can it reuse my yes?” | `APPROVAL_SPENT` test |
| “What happens on a timeout?” | `uncertain` state; token remains spent; no retry |
| “What happens if the service restarts?” | Sent envelope and spent receipt reload; final collection still works; no resend |
| “Can a disabled live path burn approval?” | `LIVE_SEND_DISABLED` occurs before token consumption or provider call |
| “Did an LLM write legal obligations?” | `planner.ts`: model clauses are discarded |
| “Is this really Foxit?” | MCP tool evidence + direct eSign endpoints + folder ID |
| “Is it actually signed?” | `EXECUTED` status, second SHA-256, valid detached signature, and pixel-identical DSS revision in `docs/evidence/foxit-live-proof.md` |

## Evidence commands

```bash
npm run check
npm run test:coverage
```

Expected baseline: 48 tests; at least 85% statements and lines, 72% branches, and 82% functions. Current observed coverage is 92.46% statements/lines, 75.52% branches, and 95.16% functions.

## Submission boundary

The live Foxit PDF lifecycle and one consented self-test eSign invitation were executed successfully on 2026-09-01. The signer completed the Foxit sandbox flow, the envelope reached `EXECUTED`, and SignGate downloaded and hashed the final PDF. The completed proof then survived a cold restart with its audit chain valid and new dispatch disabled. The visible `TEST MODE` watermark must remain disclosed; do not describe this as a production or legally deployable signature transaction.
