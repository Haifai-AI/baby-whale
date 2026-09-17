# Agent Note: 预发布标签绝不占用安装方跟随的任何通道

Status: implemented

[English](2026-09-16-prerelease-tags-never-take-an-installer-channel.md) | 中文

## Problem

便携包会从每个 `v*` 标签发布两条分发通道，而除非标签的版本另有说明，两条都默认指向稳定通道。

GitHub Release 是 `npm/bwhale/bin/bwhale.js` 所跟随的那条：它通过请求 `https://api.github.com/repos/Haifai-AI/baby-whale/releases/latest` 来解析更新。`.github/workflows/bundle.yml` 中的发布步骤始终以 `--latest` 且不带预发布标志创建每个 release，于是两侧对预发布标签的含义理解不一致。GitHub 在回答 `releases/latest` 时会跳过标记为预发布的 release，但 `--latest` 标志会覆盖该标记，无论标签如何都把通道指向这个 release。

npm 启动器是 `npm install -g @haifai/bwhale` 所跟随的那条。除非另有指示，`npm publish` 会采用 `latest` dist-tag，而该步骤从未给出指示。

这使得在决定安装方抓取什么的两处位置上，演练标签与稳定标签都无法区分。为了让预览产物送到测试者手中而打上 `v0.2.0-preview`，会在所有既有安装下次启动时把该预览推送给它们，并推送给所有从 npm 安装启动器的人。更新器读取的是通道而不是版本：`pickAsset` 接受 `releases/latest` 所指的任何东西并安装它。

## Decision

两个发布步骤都用 shell `case` 从 `GITHUB_REF_NAME` 选择其通道标志。名称中含 `-` 的标签是 semver 预发布：GitHub release 以 `--prerelease` 发布，npm 包以 `--tag next` 发布。其他所有标签以 `--latest` 发布并采用默认的 `latest` dist-tag。

因此预发布 release 照常携带其 bundle zip 与校验和 sidecar 作为普通资产，可从 Releases 页面按标签访问，并且对 `releases/latest` 不可见；启动器版本在 `next` dist-tag 下可见，而不在 `latest` 下。两种情况下 `--generate-notes` 都仍会列出与上一个 release 的差异。

安装预览是显式行为。要么从 npm 安装启动器（`npm install -g @haifai/bwhale@next`）并用 `BWHALE_VERSION=v0.2.0-preview bwhale` 固定运行时，要么直接抓取该标签的 zip 及其校验和 sidecar。启动器通过 `releaseByTag` 解析固定的标签，而它能找到预发布 release。

两个打包脚本还必须在命名资产所用的版本上保持一致。`make-bundle.ps1` 只接受 `^\d+\.\d+\.\d+$`，因此预发布标签会落到应用版本，Windows 资产只有在两者恰好相等时才与标签匹配；`make-bundle.sh` 接受一个宽松的 glob，它还会放行诸如 `0.2.0-` 之类的值。两者现在求值同一个模式 `^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`，因此预发布版本完整保留，而分支名或畸形标签会回退。Windows 作业带有 `continue-on-error`，所以不匹配会发布一个没有 Windows bundle 的 release，且没有任何红灯。

`scripts/ci-workflow.spec.ts` 固定两个工作流步骤：各自的 `case` 两个分支、各自的数组展开，以及对 GitHub release 而言不存在会架空该分支的裸 `--generate-notes --latest`。`scripts/bundle-asset-naming.spec.ts` 让两个打包脚本与启动器互相约束：它求值每个打包脚本实际发布的守卫（POSIX 那个通过 `bash`，PowerShell 那个用从脚本中提取的模式），断言两者都保留标签版本、都对非发布引用回退，并断言启动器从标签重建出的名称正是两个打包脚本所写入的名称。

## Alternatives considered

- **不改动工作流，改为在预览 release 创建后手工标记**——该步骤有四个矩阵作业竞争，且由第一个创建 release，因此手工纠正只能发生在某次运行已经发布该通道之后；拒绝，因为那个窗口正是危害发生的时刻。
- **把预览 bundle 作为 workflow artifact 而非 Release 发布**——artifact 会过期、抓取需要仓库读权限，且 `bwhale` 没有通往它们的路径；拒绝，因为没有 GitHub 账号就无法安装的预览不算预览通道。
- **在预发布标签上跳过 npm 发布**——该步骤本就带有 `continue-on-error`，因此被跳过的发布与失败的发布无法区分，而一个从未发布的启动器版本会读起来像是已发布；拒绝，改为发布到含义为“非稳定”的通道，这也是 `scripts/release/publish.ts` 已为 dsh 家族作出的同一决定（[npm 发布序列](2026-08-10-npm-release-sequences.zh.md)）。
- **在发布步骤中拒绝预发布标签**——这会让演练变得不可能而非安全，而版本方案本就为此目的使用预发布（[npm 发布序列](2026-08-10-npm-release-sequences.zh.md)）；拒绝。
- **让 `bwhale` 自行过滤预发布**——该过滤器只能保护已经带有它的本地启动器，而发布步骤才是对所有曾安装过的启动器作出决定的地方；拒绝，改为选择所有读取方都一致的一侧。

## Consequences

预览 release 不再可能在两条分发路径上意外顶替稳定通道，而且两项检查都是机械的：带预发布段的标签无法创建 `latest` release 或 `latest` npm 版本，因此预发布路径在构造上就是安全的，而不是靠记得传某个标志。

代价是安装预览需要一次刻意的安装，并且本笔记是记录该规则的唯一位置——这些守卫固定的是工作流文本而非 GitHub 与 npm 的 API 行为，因此 `case` 分支必须持续匹配规格所断言的那些拼写。启动器包位于 pnpm 工作区之外，因此 `release:dsh` 不会提升 `npm/bwhale/package.json`；发布提交必须手工移动该版本，因为 npm 拒绝重复发布已存在的版本，而过期的版本会在 `continue-on-error` 之后静默失败。
