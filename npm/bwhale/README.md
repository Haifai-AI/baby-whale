# bwhale — Baby Whale in one command

Local-first knowledge-work coworker: give it a task, get back finished
Excel workbooks, PowerPoint decks, Word documents, and PDFs — built by
code, previewed pixel-perfect, and never leaving your machine.

```bash
npm install -g bwhale
bwhale
```

First run fetches the runtime once (~400 MB, from this project's GitHub
Releases) into `~/.bwhale`, checks your platform's prerequisites, and
opens `http://127.0.0.1:24680`. Later runs start instantly.

## Commands

| Command | What it does |
|---|---|
| `bwhale` | Start (first run installs the runtime) |
| `bwhale --no-open` | Start without opening the browser |
| `bwhale doctor` | Report what's present / missing on your machine |
| `bwhale update` | Refresh to the latest release on next start |
| `bwhale stop` | Stop a running server (closing the browser doesn't — `--stop` works too) |
| `bwhale --version` | Report the installed runtime version |

Supported platforms: macOS (arm64 + x64) and Linux (x64 + arm64).
Windows builds are not published yet — the launcher says so plainly
instead of failing mid-download.

## What it checks and installs

The app ships with its own Node — you only need the platform basics, and
`bwhale doctor` tells you exactly what's missing and the platform-native
command to get it:

- **macOS** — nothing else required; office libraries install themselves
  on first boot
- **Linux** — `git` required; `python3` for office-file creation;
  `libreoffice` optional (pixel-perfect previews, also installable
  in-app later)

Connect a model (one-time): create `~/.dsh/.credentials.yaml`:

```yaml
version: 1
refs:
  DEEPSEEK_API_KEY: sk-your-key-here
```

then `chmod 600 ~/.dsh/.credentials.yaml`.

## Privacy

Files, sessions, history, and the workspace live entirely on your machine.
The only network calls are the model provider you configure, the one-time
runtime download, and update checks.

MIT — a knowledge-work product built on the DeepSeek Harness.
