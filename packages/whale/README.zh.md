# whale/

[English](README.md) | 中文

Whale：dsh 的知识工作协作者层——定时任务存储、协作者护栏、MCP 管理器、撤销层和 `deliver` 工具。

## 包

| 包 | 负责 | `ctx` 键 |
|---|---|---|
| [`core/`](core/README.zh.md) | 基于 storage domain 的持久工作区任务存储、IANA 时区 cron 调度、HQ 会话投递，以及面向模型的 `whale_task_*` 工具 | `ctx.whaleTasks` |
| [`guardrails/`](guardrails/README.zh.md) | 审批优先的覆盖围栏、工作区逃逸拒绝、不可信内容指引 | — |
| [`mcp/`](mcp/README.zh.md) | 把 `mcp` 设置命名空间挂载成实时 MCP 服务器，并提供每台服务器的状态与重挂载 | `ctx.mcpStatus` |
| [`tool-deliver/`](tool-deliver/README.zh.md) | 面向模型的 `deliver` 工具：把已完成的工件文件声明为面向用户的交付物 | — |
| [`trash/`](trash/README.zh.md) | 把每个被覆盖的文件备份到 `<workspace>/.whale-trash`，并提供面向模型的列出与恢复工具 | — |
