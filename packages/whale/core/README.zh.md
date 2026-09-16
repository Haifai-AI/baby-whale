# `@deepseek-ai/dsh-whale-core`

[English](README.md) | 中文

Whale 的持久化定时任务层。HQ 会话模型：每个任务都指名拥有它的会话；调度器滴答且任务到期时，任务提示词通过 `Agent.followup`（入队消息——会唤醒空闲的 agent）投递到该会话**实时**的 agent 中，记录随之推进。没有实时 agent 的会话会保留其到期任务，直到下一次滴答。

## 组件

- **持久化存储**（`ctx.whaleTasks`）：一张 storage-domain 表（`whale-tasks` 域，JSON 后端）保存全部任务记录——可跨重启存活、按工作区隔离、由该域做版本管理。
- **Cron 与 IANA 时区**：五字段 cron 表达式（`*`、列表、区间、步进——只支持数字），以及带 DST 处理的具名时区下次到达时间计算（`src/cron.ts`）。
- **HQ 调度器**：周期性滴答（配置 `intervalMs`，默认 60 秒），把到期任务投递给实时存在的属主 agent，并推进 once／cron 记录。
- **面向模型的工具**：`whale_task_create`（once／cron／manual）、`whale_task_list`、`whale_task_pause`、`whale_task_resume`、`whale_task_remove`、`whale_task_run`。
- **看板快照**：每次变更后，属主 HQ 会话的日志会收到一个 `whale/task-board` 事件，携带整个工作区的任务视图（与 `todo/write` 一样属于仅日志的 UI 状态）；Web 看板据此渲染。

## 组合

把 `@deepseek-ai/dsh-whale-core` 挂载在宿主面（在带 `json` 后端的 `storage-domain` 之后）；工具注册在全局，所以任何 preset 都能调用它们。

## 模型体验

### `whale:tasks` 系统提示词指引

#### 模型看到的内容

一段固定指引，以 `whale:tasks` 为名注册在顺序 108，告诉模型存在定时工作以及由哪些工具负责。

##### `whale:tasks` 段落原文

```markdown
Schedule recurring work with whale_task_create (cron expressions, IANA timezones, or one-shot times). List with whale_task_list, and manage with whale_task_pause/resume/remove. Scheduled tasks run in the owning session when it is open.
```

#### Token 影响

固定：只要本包处于挂载状态，每次组装请求都会带上一段很短的提示词，与工作区里有多少任务无关。

#### KV Cache 影响

前缀稳定：挂载后该段落的文本与顺序都不再变化，因此包含它的已加载前缀在插件卸载或重新划定 scope 之前一直可复用。

### Whale 任务工具

#### 模型看到的内容

`whale_task_create`、`whale_task_list`、`whale_task_pause`、`whale_task_resume`、`whale_task_remove`、`whale_task_run`，每个都有固定 schema。排程方式由 `whale_task_create` 的参数决定：`kind` 为 `once` 时需要 ISO-8601 的 `at`，为 `cron` 时需要五字段 `expr` 加可选的 IANA `tz`，为 `manual` 时表示只能由 `whale_task_run` 触发的任务；四个管理工具都只接受一个必填的 `task_id` 字符串。

#### Token 影响

定义可见时，每次请求都要支付固定的 schema 成本；此外还有随工作区规模增长的 `whale_task_list` 结果，其每行携带 `taskView`——id、名称、状态（`active`／`paused`／`done`）、类型、排程摘要、来源时区、`nextRunAt`、`lastRunAt` 与 `workspaceCwd`；`include_done` 默认为 false，因此已完成的一次性任务除非模型主动索取，否则不会出现在列表里。

#### KV Cache 影响

注册集合与可见性不变时前缀稳定。新出现的列表结果追加在可复用前缀之后，不会使已有 KV-cache 条目失效；任务变更不会改写此前的请求内容。

### 任务投递消息

#### 模型看到的内容

任务到期时，调度器向属主会话注入一条 user 角色消息：字面量 `[whale task] <name>`，随后一个空行，再后面是任务自身保存的指令文本，并带插件来源标记 `whale-tasks`。对属主会话没有实时 agent 的任务调用 `whale_task_run`，不会投递任何内容，而是返回字符串 `Task not found.`。

#### Token 影响

条件性，且规模不由本包限制：每次触发一条消息，长度取决于人或模型在创建时写入的指令。每次触发都会留在会话日志中，直到压缩（compaction）。

#### KV Cache 影响

仅追加：每次投递都追加到属主会话的历史之后，位于可复用请求前缀之后而不是重写它，因此被唤醒的空闲会话可复用其前缀，只为新消息付费。`whale/task-board` 快照属于仅日志的 UI 状态，绝不进入模型请求。

## 已知限制与暂缓事项

- 投递需要属主会话的 agent 处于实时状态；目前还没有唤醒冷会话的通道。
- cron 语法只支持数字字段（没有月份／星期名，也没有 `?`／`L`／`#`）。
- 看板快照只在属主会话实时存在时追加；冷会话会在下一次实时变更时补齐。
