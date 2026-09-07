# Roadmap

Baby Whale is a local-first knowledge-work coworker, forked from
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — and
iterated on at a pace the upstream release cycle can't match. Everything
here ships as plugins on that engine.

**Principles**

- **Local-first, always.** Files, sessions, memory: your machine. The only
  traffic is the model call you configure. No account, no telemetry.
- **Cache-respect.** The upstream tool-call layout earns ~99.9% prefix-cache
  hits. We extend it, never churn it.
- **Everything is a plugin.** Features land as plugins; disabling one removes
  it completely.

## Now — v0.1.x hardening

- [ ] Windows bundle pipeline settled and smoke-proven (bundles build, boot test green)
- [ ] First-run onboarding wizard — key setup to first deliverable in five minutes (#7)
- [ ] Preview quick wins: watch-mode refresh, open-in-system-app, zoom

## Next — v0.2 Use the computer

- [ ] **Browser use** (#1) — a managed local browser the agent drives: open,
      read, screenshot, click, fill. Per-domain permission gates.
- [ ] **Computer use** (#2) — screenshot + mouse/keyboard with explicit
      grants, visible indicator, full audit log, one-click revoke.
- [ ] **MCP client** (#3) — add any Model Context Protocol server (stdio +
      HTTP); its tools appear natively. Compatible config import.
- [ ] **Preview studio expansion** (#4) — images, markdown, code, HTML,
      JSON; zoom, thumbnail rails, in-preview search.

## Then — v0.3 and beyond

- [ ] **Tool-calling upgrades inside the cache rules** (#5) — parallel
      execution, precise retries, trailing-segment compaction, sub-agent
      side-chains. Measured against cache-hit rate, never shipped blind.
- [ ] **Durable memory** (#6) — preferences, project facts, corrections.
      Local, reviewable, forgettable.
- [ ] **Skills marketplace** (#8) — one-command install, reviewable before
      enabling.

## Deliberately unscheduled

MCP server mode (Baby Whale's tools exposed to other clients) · update
channels (stable/beta) · more locales. Say what you want in
[Issues](https://github.com/Haifai-AI/baby-whale/issues) — the fastest
iteration wins.
