# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Knowledge workers — analysts, consultants, operators, founders — who need a finished file rather than a code change: a workbook with live formulas, a deck, a report, a PDF. They are comfortable installing a CLI and editing a YAML credential file, but they are not necessarily programmers, and they do not read the transcript the way an engineer does. They work at a desk, often for a full working day, frequently beside Excel, PowerPoint, and Word. They arrive with a task in their head ("the Q3 numbers as a deck my director will accept") and leave with an artifact they can send.

A secondary audience is the developer evaluating the harness itself, who does read the tool log and cares about turns, steps, tokens, and cache behavior. Their needs are real but subordinate: developer telemetry must remain reachable without setting the interface's tone.

## Product Purpose

Baby Whale runs an agent locally and produces finished office documents. The user states a task in chat; the agent writes code that builds an .xlsx, .pptx, .docx, or .pdf; the app previews the result pixel-perfectly in an in-app studio; the user downloads it. Success is a file the user sends to someone else without further editing. The product exists so that the gap between "I need a deck" and "here is a deck" closes inside one window, on the user's own machine.

## Positioning

Local-first document production, with the preview as proof. A neighboring chat product can write text about a spreadsheet; Baby Whale returns the spreadsheet, rendered, with formulas that still calculate. Files, sessions, and workspaces stay on the machine — only the model API call leaves it. The preview studio is the mechanism a text-only competitor cannot truthfully copy.

## Operating Context

The GUI is served at `http://127.0.0.1:<port>` by a locally installed runtime (`bwhale`), opened in the user's own browser — it is a web app wearing the expectations of a desktop one. Sessions are long: a user runs several in a day and returns to them. Work happens in named workspaces (a folder treated as a project); a session belongs to one. Every session has a workspace directory holding its produced files. There are two presets: Coworker mode (office tools, skills, deliverables) and Standard mode (chat only). The transcript mixes assistant prose, reasoning, tool calls, and produced files. Sessions can be scheduled to recur, with a live task board. A details panel carries artifacts, todos, context usage, and the raw session log.

## Capabilities and Constraints

- Stack is fixed: React in a plugin architecture on vendored Cordis; every UI feature is a dynamically loaded client plugin. Styling is CSS Modules plus shared `--dsw-*` custom properties — no Tailwind, no component library, no inline theme branches.
- 134 CSS Module sheets across 40 client packages consume the shared token layer. The token layer is the only lever that reaches all of them at once.
- Feature packages may only consume `--dsw-alias-*` semantic aliases; light/dark overrides live solely in the theme owner. Theme selectors in feature CSS are a contract violation.
- Product copy is Chinese; code comments are English. Copy shown in this session's captures is the app's own English locale.
- Client packages sit under a per-file 100% coverage gate; visual changes must not break ARIA/text snapshots.
- The app runs in the user's browser: no native window chrome, no traffic lights, no OS menu bar. Anything that reads as "desktop app" must be drawn in CSS.
- Model providers are configured by the user (DeepSeek and compatible endpoints). No component may assume a specific model.
- Theme preference is light / dark / system, currently surfaced in Settings.

## Brand Commitments

- The name is Baby Whale (小鲸鱼); the whale mark and a whale emoji are established brand assets and stay.
- The product is a Chinese-language product with an English locale. Both must render correctly; Chinese text must not fall back to a serif or a monospace face.
- Existing `--dsw-*` token names are consumed by 134 sheets and are not part of the redesign's freedom; the redesign may change every value and add new names, but renaming the existing semantic aliases would be a mechanical sweep with no user-visible benefit.

## Evidence on Hand

- `README.md` and `README.zh.md` carry the product description quoted above.
- Real captured sessions in the running app (a presentation-building session and a document session) are available as screenshots in `/tmp/bw-shots/`; these are real model output, not fixtures.
- The in-app Office preview studio renders real .xlsx/.pptx/.docx files through LibreOffice when the user opts into the runtime download.
- No customer names, benchmarks, logos, or commercial claims exist and none may be invented.

## Product Principles

1. **The deliverable is the hero.** The document the user came for outranks the process that made it. Work is shown so it can be trusted, never so it can be admired.
2. **Proof over assertion.** A rendered page of the actual workbook beats a sentence claiming the workbook is finished.
3. **Local means quiet.** Nothing that leaves the machine should be implied by the interface's tone; the app is a tool on a desk, not a service with a business model.
4. **Developer truth stays reachable, not ambient.** Tokens, cache, and timing are available on demand and never compete with the task.
5. **Calm at hour six.** The interface is looked at all day; density and contrast decisions are made for the sixth hour, not the first screenshot.

## Accessibility & Inclusion

Contrast must clear WCAG AA for all text in both themes; the previous state of this codebase shipped several sub-AA pairs, so this is a live requirement rather than a formality. Focus must remain visible on every interactive element. Motion must respect `prefers-reduced-motion`. The interface is keyboard-operable: the composer, the session list, the tabs, and the settings dialog are all reachable without a pointer. No text may be conveyed by color alone.
