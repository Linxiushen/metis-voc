# Metis VOC: a project developed with Codex

Metis VOC is an evidence-aware product research and decision workspace. I developed the project with Codex as a coding assistant. The resulting application is a Cloudflare Workers system with a web workspace, research queues, persisted evidence, and human review before decisions are finalized.

## A concrete engineering walkthrough

Start with a research brief, create a task, confirm execution, and follow the task through the queue into a report. The application records evidence and checks report versions before review and export. When evidence is insufficient, the application blocks formal decision export instead of treating a generated report as verified research.

Three useful code paths to study are:

- `lib/research-queue.ts`: task leases, retries, recovery, and protection against stale executors.
- `lib/credits.ts`: idempotent debit and compensation records.
- `lib/decision-coordinator.ts`: coordination of decision writes and review state.

See [the architecture](ARCHITECTURE.md) for the HTTP, queue, storage, report, and review boundaries. This is a description of implemented behavior; it does not attribute every individual historical change to a recorded Codex session.

## Reproduce the application

Follow [QUICKSTART.md](QUICKSTART.md). The release uses synthetic examples, randomly generated local administrator credentials, and paid providers disabled by default. It can demonstrate the task lifecycle and evidence gates without including the original operating site's accounts or data.

Live data collection, model analysis, and concept-image generation require the operator's authorized data and provider accounts. The application's optional model adapters are separate from Codex's role during development. The Python `research-kit/` is a design scaffold and is not the running web application's agent pipeline.

## Validation evidence

The source baseline is commit `8d99e113e5849a12d5a4a0bb76cb6a45f40e073f`. Its [GitHub CI run](https://github.com/Linxiushen/metis-voc/actions/runs/35109662358) passed `pnpm check`, the strict source audit, the isolated local API smoke test, and the dependency audit. This is CI evidence for that baseline, not a claim that paid provider integrations were exercised.

During preparation of this case study on 2026-10-14, Codex reviewed the release documentation, checked that baseline's CI results, and ran the existing strict source audit. No production deployment or paid provider invocation was performed.

## A tutorial I can contribute

The first tutorial will walk through “Research task to reviewed decision,” using this runnable repository to explain task state, evidence checks, retries, and human review. A subsequent recorded Codex coding task can show a specific change, its diff, and its validation results. Historical development chat transcripts and customer data are not included in this source release.

## 中文简介

Metis VOC 是我使用 Codex 辅助开发的产品研究与决策工作台。它的主要展示路径是“研究简报 → 确认任务 → 队列执行 → 证据报告 → 人工审核与决策”。公开版本保留完整可自行部署的主应用、MIT 许可与合成样例，重点说明恢复、幂等与证据不足时的导出门禁。运行时模型接入与使用 Codex 开发是两个独立概念；未接入主应用的 Python 草案不作为已运行功能展示。
