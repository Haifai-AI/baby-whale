# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Whale coworker mode

Whale is this harness's **knowledge-work personality** — Claude-Cowork-style
office work, fully local and open-source:

```sh
npx @deepseek-ai/dsh web --profile default   # pick the “Whale Coworker” preset in the UI
```

- **Office deliverables**: `xlsx_create` (live formulas, number formats, data
  bars, native charts, themed banners), `pptx_create` (KPI stat slides,
  two-column layouts, native charts, speaker notes), `docx_create` (cover
  pages, callouts, banded tables).
- **Read what users upload**: drop any .xlsx/.csv/.docx into the chat — the
  file lands in the session workspace and `xlsx_read` / `csv_read` /
  `docx_text` analyze it.
- **Skills**: seven knowledge-work skills ship with the Coworker preset;
  manage them in Settings → Skills. Everything is a plugin — disable the
  plugin and the section disappears with it.
- **Scheduled tasks**: `whale_task_*` tools plus a live task board; missed
  runs are surfaced honestly instead of silently dropped.
- **Try it in five minutes**:
  [examples/whale-demo](examples/whale-demo) ships a messy spreadsheet and a
  walkthrough script.

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
