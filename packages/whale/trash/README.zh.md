# `@deepseek-ai/dsh-whale-trash`

[English](README.md) | 中文

Whale 的撤销层。一个 `tools/execute` 包装器会在分发**之前**，把受护变更（`write`、`edit`、`xlsx_create`、`pptx_create`、`docx_create`）的每个已存在目标备份到 `<workspace>/.whale-trash/`，并由两个面向模型的工具暴露该层：

- `whale_trash_list`——当前工作区的备份（备份路径、原文件名、大小）。
- `whale_trash_restore { backup }`——把一个备份写回它原来的路径。

备份是通过 fs seam 完成的原始字节拷贝，因此 trash 能跨重启存活，沙箱策略也作用于恢复操作。trash 本身不触碰模型的上下文；指引段落只是把模型指向这两个工具。

备份名为 `<iso-stamp>__<encoded-path>`，其中原始的工作区相对路径经过百分号编码，因此嵌套目标能精确往返。0.1.5 之前的 `<iso-stamp>-<basename>` 条目仍可列出并恢复（按写入时的形式恢复到工作区根目录）。备份包装器是尽力而为的：备份失败绝不会阻塞它正在做快照的那次变更。

绕过工具层的写入——经由 `bash`／`pwsh` 的 shell 重定向与脚本——既不会被询问，也不会被备份。沙箱仍把它们限制在工作区内。

## 组合

把 `@deepseek-ai/dsh-whale-trash` 挂载在宿主面（在 `ctx.fs` 之后）；它的工具注册在全局。配置：`directory`（默认 `.whale-trash`）、`maxBackupBytes`（默认 50 MiB）。

## 模型体验

### `whale:trash` 系统提示词指引

#### 模型看到的内容

一段固定指引，以 `whale:trash` 为名注册在顺序 109，告诉模型备份在哪里，以及由哪两个工具读取并恢复它们。

##### `whale:trash` 段落原文

```markdown
Overwritten files are backed up under .whale-trash/ in the workspace. Use whale_trash_list to inspect backups and whale_trash_restore to put a prior version back.
```

#### Token 影响

固定：只要插件处于挂载状态，每次组装请求都会带上一段提示词，与工作区累积了多少备份无关。

#### KV Cache 影响

前缀稳定：挂载后该段落的文本与顺序都不再变化，因此包含它的可复用请求前缀能穿过每一次被备份的变更。

### Trash 列表与恢复结果

#### 模型看到的内容

`whale_trash_list` 不接受参数，每个备份渲染为一行 `<original> → <backup> (<size> bytes)`，最新的排在最前；目录不存在或为空时渲染字面量 `No backups in .whale-trash.`。`whale_trash_restore { backup }` 成功时渲染 `Restored <original>.`，指定的条目不是文件时渲染 `No backup found at "<backup>".`；`backup` 参数包含 `..` 时会被拒绝，返回 `whale trash refuses a backup path outside the workspace`。

#### Token 影响

条件性，且随调用方规模增长：列表输出随备份数量增长，每个条目都带完整路径与字节大小，因此备份很多的工作区每次列举都要为全部条目付费。每一次分发出去的受护变更也会在历史中留下一次工具调用与结果，无论它是否真的产生了备份。

#### KV Cache 影响

仅追加：列表与恢复结果都位于可复用请求前缀之后，而不是重写它；备份包装器本身不向模型请求注入任何内容——被备份的变更自身那次工具调用是它唯一新增的历史。

## 已知限制与暂缓事项

- 备份是按工作区存放的文件，而不是会话日志条目：目前还没有浏览器撤销入口（恢复由模型驱动）。
- 超过 `maxBackupBytes` 的文件会被静默跳过。
- 还没有保留上限：fs seam 没有删除操作，因此备份会一直累积，直到工作区所有者自行清理。等 seam 具备删除能力后再跟进 `maxBackups` 清理。
