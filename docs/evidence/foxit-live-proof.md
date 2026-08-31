# Foxit live proof — 2026-09-01

This report records a consented self-test through the Foxit US-region sandbox. The raw signed PDF remains in the gitignored, private-permission `runtime/` directory because it contains signer identity and handwritten-signature data.

## Provider lifecycle

| Check | Verified result |
| --- | --- |
| Official PDF API MCP | HTML uploaded by absolute path, converted, downloaded, and remote intermediates deleted |
| Exact-artifact approval | Approval bound to the provider-rendered PDF SHA-256 and canonical recipient |
| eSign dispatch | One invitation sent; one-shot approval consumed before the provider call |
| Terminal status | `EXECUTED` |
| Final signed SHA-256 | `d492d86e364934258399314e1d1f39a298f45387563b8530764c085a61d78190` |
| Restart recovery | `completed` state, final hash, and valid audit chain recovered after a cold restart |

## Final PDF verification

| Property | Observed result |
| --- | --- |
| File | 146,459 bytes; PDF 1.4 |
| Layout | One tagged A4 page; no clipping or overlap observed |
| Safety | Unencrypted; no JavaScript |
| Form structure | One AcroForm signature field with a non-empty appearance |
| Cryptographic signature | Detached PKCS#7 using SHA-256; `pdfsig` reports the signature as valid |
| Structural validation | `qpdf --check` reports no syntax or stream-encoding errors |
| Post-sign revision | One incremental `/DSS` revision for validation material |
| Signed-vs-final rendering | Pixel-identical at 150 DPI; zero changed-pixel bounding box |

The local `pdfsig` process could not establish certificate-chain trust because its NSS certificate database failed to initialize, so this report does not claim independent certificate-chain validation. It claims only the successfully checked signature integrity, provider terminal state, document structure, and content-preserving DSS append.

## Scope boundary

The final page visibly carries Foxit's `TEST MODE` watermark. This proves the complete sandbox workflow and human-in-the-loop control; it is not presented as a production or legally deployable signature transaction.
