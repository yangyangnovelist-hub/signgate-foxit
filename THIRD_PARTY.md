# Third-party components

SignGate follows a reuse-first implementation strategy.

| Component | Use | Source / license |
| --- | --- | --- |
| Foxit PDF API MCP Server `0.2.3` | Official PDF upload, conversion, download, cleanup | [Foxit repository](https://github.com/foxitsoftware/foxit-pdf-api-mcp-server), MIT |
| Model Context Protocol SDK | Stdio client for the official Foxit server | [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk), MIT |
| Foxit PDF Services / eSign | Hosted PDF and signing provider | [Foxit Developer API](https://developer-api.foxit.com/), provider terms |
| Express | HTTP application | MIT |
| dotenv | Server-side environment loading | BSD-2-Clause |
| Zod | Runtime schemas | MIT |
| Motion `13.1.1` | State-linked document, route, seal, and signature animation | [motiondivision/motion](https://github.com/motiondivision/motion), MIT |
| tsParticles Slim `4.4.0` | Low-density provenance particles confined to the evidence route | [tsparticles/tsparticles](https://github.com/tsparticles/tsparticles), MIT |
| Ollama | Local inference runtime | MIT |
| qwen2.5:1.5b-instruct | Default local extraction model | Qwen model license |
| Qwen3-TTS 1.7B CustomVoice 8-bit / MLX Audio | Locally generated demo narration using Qwen's built-in AI voice, with no real-person reference or cloned reference chain | [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), Apache-2.0; [MLX Audio](https://github.com/Blaizzy/mlx-audio), MIT |
| Vitest / Supertest | Unit and API tests | MIT |
| Playwright `1.62.1` | Reproducible Chrome browser verification | Apache-2.0 |
| esbuild | Bundles the local animation dependencies | MIT |
| IBM Plex Sans Condensed / IBM Plex Mono / Newsreader | Product typography loaded from Google Fonts | SIL Open Font License |

The Foxit MCP server and animation engines are consumed as pinned npm dependencies. SignGate does not copy or reimplement their clients or runtimes. Demo narration uses Qwen's built-in AI speaker directly; it is not a recording or clone of a real person.
