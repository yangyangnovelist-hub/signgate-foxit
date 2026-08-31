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
| Ollama | Local inference runtime | MIT |
| qwen2.5:1.5b-instruct | Default local extraction model | Qwen model license |
| Vitest / Supertest | Unit and API tests | MIT |
| Playwright | Browser verification | Apache-2.0 |
| Fraunces / Sometype Mono | Product typography loaded from Google Fonts | SIL Open Font License |

The Foxit MCP server is consumed as a pinned npm dependency and launched as published. SignGate does not copy or reimplement its PDF API client.
