# Baby Whale


https://github.com/user-attachments/assets/87803b2a-8f83-47b3-afa1-b43b5d46fad5


**Baby Whale** is a local-first knowledge-work coworker. Give it a task in
the chat; it writes the code that builds the finished file — Excel
workbooks with live formulas, PowerPoint decks, Word documents, PDFs —
previews them pixel-perfect in the app, and hands them back as
deliverable cards. Your files, sessions, and workspace never leave your
machine; only the model API call does.

```sh
npm install -g @haifai/bwhale
bwhale
```

The first run fetches the runtime once (~400 MB) into `~/.bwhale`, checks
your platform's prerequisites, and opens `http://127.0.0.1:24680`. Later
runs start instantly and update themselves.

## What it does

- **Office deliverables** — `xlsx_create` (live formulas, number formats,
  data bars, native charts, themed banners), `pptx_create` (KPI stat
  slides, two-column layouts, native charts, speaker notes), `docx_create`
  (cover pages, callouts, banded tables), PDF generation. Each deck gets a
  fresh design — palettes and typography are chosen per task, never reused.
- **Reads what you drop in** — any .xlsx/.csv/.docx lands in the session
  workspace and `xlsx_read` / `csv_read` / `docx_text` analyze it.
- **Pixel-perfect previews** — an in-app studio renders workbooks as
  spreadsheets, decks as slide galleries, documents as pages. A one-time
  LibreOffice runtime (offered inside the app) makes them exact.
- **Knowledge-work skills** — a set of skills ships with the Coworker
  preset; manage them in Settings → Skills. Everything is a plugin —
  disable the plugin and the section disappears with it.
- **Scheduled tasks** — recurring tasks with a live board; missed runs are
  surfaced honestly instead of silently dropped.
- **Standard mode** — a lighter chat-only preset without the office tools.

## Commands

| Command | What it does |
|---|---|
| `bwhale` | Start (first run installs the runtime) |
| `bwhale --no-open` | Start without opening the browser |
| `bwhale doctor` | Report what's present / missing on your machine |
| `bwhale update` | Refresh to the latest release on next start |
| `bwhale stop` | Stop a running server (closing the browser doesn't) |
| `bwhale --version` | Report the installed runtime version |

Platforms: macOS (arm64 + x64), Linux (x64 + arm64), Windows x64.

## Give the coworker a real office engine (optional)

Baby Whale previews spreadsheets and documents out of the box. If you want
to go further — the coworker drafting slides, docs, and multi-sheet
workbooks in a live office canvas with drag-and-resize windows, reviewing
each change before it lands, and exporting to `.xlsx` / `.docx` / `.pptx` —
install the Univer Office plugin:

```bash
bwhale plugin --profile web add dsh-univer-office
```

Restart `bwhale` and refresh the browser page. The plugin runs fully local
and is maintained by the Univer (DreamNum) team; it adds its own skills and
tools next to the built-in ones, and the built-in previews keep working
exactly as before without it.

## Connect a model (one time)

Create `~/.dsh/.credentials.yaml`:

```yaml
version: 1
refs:
  DEEPSEEK_API_KEY: sk-your-key-here
```

Restart `bwhale`. Everything else — files, sessions, deliverables — stays
on this machine.

## Privacy

Zero cloud anything: sessions, workspaces, and produced files live in your
home directory. The only network traffic is the LLM provider call you
configure, and the one-time runtime downloads you approve.

## Heritage

Baby Whale's engine is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(MIT), the open-source agent harness where everything is a plugin, built
on [Cordis](https://github.com/cordiverse/cordis). The whale coworker
experience — office skills, deliverables, previews, the `bwhale` launcher —
is built by [Haifai-AI](https://github.com/Haifai-AI) on that foundation.

## Development

```sh
pnpm install
pnpm run build
pnpm dsh web
```

Start with the [development guide](docs/development.md) and
[architecture documentation](docs/architecture.md). For agents, follow
[AGENTS.md](AGENTS.md). Release engineering lives in
[scripts/make-bundle.sh](scripts/make-bundle.sh) (macOS/Linux),
[scripts/make-bundle.ps1](scripts/make-bundle.ps1) (Windows), and
[.github/workflows/bundle.yml](.github/workflows/bundle.yml).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
