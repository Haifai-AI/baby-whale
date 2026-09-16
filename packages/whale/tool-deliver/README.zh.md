# @deepseek-ai/dsh-tool-deliver

[English](README.md) | 中文

面向模型的 `deliver` 工具：把已完成的工作区文件认领为面向用户的交付物。只有认领语义——文件必须已经存在，`deliver` 绝不写入、移动或改动任何内容。

## 功能

一个工具 `deliver(paths)`，注册在 `ctx.tools` 上。每个路径都相对于调用会话的工作区（`exec.agent.session.header.cwd`）解析，经沙箱化 fs seam 确认其作为文件存在，并从同一次 stat 读取字节大小。成功结果携带 `{ delivered: [{ path, size }] }`。

每次调用限制在一到十个路径；零个或十一个路径会以 `deliver requires between 1 and 10 paths` 失败，第一个缺失或不是文件的路径会让整次调用以 `deliver: "<path>" does not exist in the workspace` 失败。不会产生部分认领，因此一个坏路径不会留下任何卡片。

呈现走渲染意图流水线：调用呈现一张 edit 形状的卡片，其 `locations` 就是被认领的路径，会话的轮次尾部会像其他任何变更工具一样把它汇总成轮次末尾的交付物 chips。卸载插件会连同 chips 一起移除该工具。

## post-execute 提醒

本包安装一个 `tools/post-execute` 监听器。当一次成功的 `bash` 结果的文本块匹配 `deliverables/`，且本轮还没有成功的 `deliver` 调用时，它会追加一条 `<system-reminder>` 上下文消息，提醒模型交付已完成文件。该提醒经 `additionalContexts` 携带插件来源标记 `tool-deliver` 发出，因此 transcript（文本记录）渲染为折叠的上下文行，而不是冒充人类的对话气泡。

该监听器刻意保持克制：每轮最多触发一次，绝不因失败的 bash 结果触发，绝不因非文本块触发，也绝不为其他工具触发。下游监听器的决定会被保留——被替换的结果会连同提醒一起保留其替换内容，非 accept 的决定原样透传。

## 导出形状

函数／命名空间插件：导出 `name`／`inject`／`apply`，没有默认导出，因此删掉 bundle 中的那一行不会留下任何其他东西。它加入 `post-execute` waterfall，并在每条不发出提醒的路径上调用 `next()`。

## 模型体验

### `tool:deliver` 系统提示词指引

#### 模型看到的内容

一段固定指引，以 `tool:deliver` 为名注册在顺序 107，告诉模型面向用户完成的文件应放在 `deliverables/` 下，并且必须用 `deliver` 认领。

##### `tool:deliver` 段落原文

```markdown
After finishing any user-facing file (spreadsheet, deck, document, PDF, code export…) under deliverables/, call deliver with its path so it appears as a received deliverable card. Deliver each finished file exactly once.
```

#### Token 影响

固定：只要插件处于挂载状态，每次组装请求都会带上一段提示词，与会话交付了多少文件无关。

#### KV Cache 影响

前缀稳定：挂载后该段落的文本与顺序都不再变化，因此包含它的可复用请求前缀能穿过每一次 deliver 调用；只有卸载插件或重新划定 scope 才会让该段落的复用失效。

### `deliver` 工具定义

#### 模型看到的内容

生成的 [`deliver` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-deliver)：一个必填的 `paths` 字符串数组，描述为已完成文件的工作区相对路径，一到十个条目。

#### Token 影响

定义可见时，每次请求都要支付固定的 schema 成本；模型自己提交的路径字符串也会随调用一起留在历史中。

#### KV Cache 影响

定义及其可见性不变时前缀稳定。插件生命周期或 scope 限制改变了注册的工具集合时，可能从该定义起使复用失效。

### Deliver 调用与结果

#### 模型看到的内容

成功时返回一个 `<delivered>` 块，为每个被认领的条目列出 `<file path="<path>" bytes="<size>"/>`。稳定的失败信息是 `deliver requires between 1 and 10 paths` 与 `deliver: "<path>" does not exist in the workspace`。用户看到的 chips 是依据调用 locations 派生的 UI 状态，不是第二条模型消息。

#### Token 影响

仅追加且随调用方规模增长：结果本身很小，但每个被认领的路径都会在参数与结果中各出现一次，并一直保留到压缩（compaction）。每轮提醒只在 bash 启发式命中时追加一条短消息，因此脚本化的一轮可能为一条它并未主动索取的消息付费。

#### KV Cache 影响

仅追加：调用、结果以及可能的提醒都位于可复用请求前缀之后，而不是重写它。监听器的每轮标志属于插件状态而非请求内容，因此触发提醒绝不会使已缓存的 prefix token 失效。

## 已知限制与暂缓事项

- **`deliver` 只认领文件，不生产文件**——它不做渲染、转换或移动，因此被认领的路径若在后续步骤中被覆盖，卡片就会陈旧，直到模型再次调用 `deliver`。
- **模型不调用，人类就看不到交付物**——任何不是成功 deliver 调用的工具写出的文件都不会出现在交付物 chips 中，这正是提醒存在的原因，也是删掉插件就删掉整个呈现面的原因。
- **提醒只是一个 `bash` 启发式**——成功的 `bash` 结果必须包含匹配 `deliverables/` 的文本块；`pwsh`、其他工具、失败的结果，以及出现在非文本块中的匹配都不会触发，而且每轮最多触发一次。
- **每次调用十个路径**——认领更多已完成文件需要第二次调用；没有 glob、目录或递归认领。
- **`deliver` 没有撤销入口，也没有 trash 备份**——它不改动任何内容，因此 whale trash 包装器绝不会为它做快照，认领错了只能靠认领正确的文件来纠正。
- **每个被认领的路径都会留在历史中**——反复交付大批文件的会话会为重复的参数与结果付费，直到压缩为止。
