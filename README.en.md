# Metis VOC

[Developed with Codex: engineering case study](docs/CODEX_BUILD_CASE_STUDY.md)

An evidence-aware product research workspace for cross-border commerce. It connects research briefs, market observations, customer evidence, product concepts, human review and recorded decisions.

[中文](README.md) · [Setup](docs/QUICKSTART.md) · [Architecture](docs/ARCHITECTURE.md) · [Limitations](docs/LIMITATIONS.md)

## Run locally

Use Node.js 24 LTS and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm setup:local
pnpm dev
```

Open the local URL printed by the terminal. Random administrator credentials are saved in the ignored `.local/admin-credentials.json`. The Cloudflare development runtime supplies local D1 and Queue bindings. No paid API calls are enabled by default.

## What is included

- Tenant-aware authentication, user management and an idempotent credit ledger.
- Research jobs, market-data imports, configurable external providers and report rendering.
- A reference framework covering STP, JTBD, BCG, consumer psychology and customer journeys.
- Evidence/readiness gates, versioned human review and decision exports.
- Optional concept-generation integration and R2 asset archival.
- Source code, regression tests, CI and deployment documentation.

The shipped examples demonstrate report structure. Synthetic customer quotes are explicitly labelled. Historical public market references are not refreshed or independently verified by this release. Missing evidence must not be interpreted as a business finding.

This is a Cloudflare Workers application, not a standalone Node.js server. Production needs your own D1, Queues and Durable Objects; image archival additionally needs R2. The web file importer currently supports only Amazon US / USD / cat bed CSV/XLSX exports. API subscriptions, payment processing, server-side PDF/PPTX export and Feishu credentials are not included. The optional Python `research-kit` contains adapter scaffolding, not complete data-service implementations.

## Validate

```sh
pnpm check
pnpm audit:source
pnpm audit
pnpm test:smoke
```

MIT for original code and original synthetic fixtures. Dependencies, public source references and provider content retain their own licenses and terms. See [third-party notices](THIRD_PARTY_NOTICES.md).
