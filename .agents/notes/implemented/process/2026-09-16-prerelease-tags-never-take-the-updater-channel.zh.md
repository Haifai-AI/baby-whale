# Agent Note: 预发布标签绝不占用更新器跟随的通道

Status: implemented

[English](2026-09-16-prerelease-tags-never-take-the-updater-channel.md) | 中文

## Problem

便携包会为每个 `v*` 标签发布一个 GitHub Release，而 `npm/bwhale/bin/bwhale.js` 通过请求 `https://api.github.com/repos/Haifai-AI/baby-whale/releases/latest` 来解析更新。`.github/workflows/bundle.yml` 中的发布步骤始终以 `--latest` 且不带预发布标志创建每个 release，于是两侧对预发布标签的含义理解不一致：GitHub 在回答 `releases/latest` 时会跳过标记为预发布的 release，但 `--latest` 标志会覆盖这一点，无论标签如何都把这个 release 标记为该通道。

这使得在唯一决定已安装启动器抓取什么的位置上，演练标签与稳定标签无法区分。为了让预览产物送到测试者手中而打上 `v0.2.0-preview`，会在所有既有安装下次启动时把该预览推送给它们，因为更新器读取的是通道而不是版本：`pickAsset` 接受 `releases/latest` 所指的任何东西并安装它。

## Decision

发布标志跟随版本。`.github/workflows/bundle.yml` 用 shell `case` 从 `GITHUB_REF_NAME` 选择发布参数：名称中含 `-` 的标签是 semver 预发布，以 `--prerelease` 发布；其他所有标签以 `--latest` 发布。

因此预发布 release 照常携带其 bundle zip 与校验和 sidecar 作为普通资产，可从 Releases 页面按标签访问，并且对 `releases/latest` 不可见。安装预览是显式行为——按名称抓取该标签的资产——而不是更新路径的副作用。两种情况下 `--generate-notes` 都仍会列出与上一个 release 的差异。

`scripts/ci-workflow.spec.ts` 固定了该步骤：断言两个 `case` 分支、`"${release_args[@]}"` 展开，以及不存在会架空该分支的裸 `--generate-notes --latest`。

## Alternatives considered

- **不改动工作流，改为在预览 release 创建后手工标记**——该步骤有四个矩阵作业竞争，且由第一个创建 release，因此手工纠正只能发生在某次运行已经发布该通道之后；拒绝，因为那个窗口正是危害发生的时刻。
- **把预览 bundle 作为 workflow artifact 而非 Release 发布**——artifact 会过期、抓取需要仓库读权限，且 `bwhale` 没有通往它们的路径；拒绝，因为没有 GitHub 账号就无法安装的预览不算预览通道。
- **在发布步骤中拒绝预发布标签**——这会让演练变得不可能而非安全，而版本方案本就为此目的使用预发布（[npm 发布序列](2026-08-10-npm-release-sequences.zh.md)）；拒绝。
- **让 `bwhale` 自行过滤预发布**——该过滤器只能保护已经带有它的启动器，而发布步骤才是对所有曾安装过的启动器作出决定的地方；拒绝，改为选择所有读取方都一致的一侧。

## Consequences

预览 release 不再可能意外顶替稳定通道，而且该检查是机械的：带预发布段的标签无法创建 `latest` release，因此预发布路径在构造上就是安全的，而不是靠记得传某个标志。

代价是安装预览需要一次刻意的抓取，并且本笔记是记录该规则的唯一位置——该守卫固定的是工作流文本而非 GitHub release API 的行为，因此 `case` 分支必须持续匹配规格所断言的那些拼写。npm 发布路径不受影响：它已经从版本选择其 dist-tag（[npm 发布序列](2026-08-10-npm-release-sequences.zh.md)），这是同一决定在第二个通道上的应用。
