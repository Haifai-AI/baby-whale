# Baby Whale

**Baby Whale（小鲸鱼）** 是一个本地优先的知识工作协作者。在聊天里交给它一项任务，
它会编写代码来生成成品文件——带实时公式的 Excel 工作簿、PowerPoint 演示文稿、
Word 文档、PDF——在应用内进行像素级精确的预览，并以交付卡片的形式交还给你。
你的文件、会话和工作区永远不会离开你的电脑；只有模型 API 调用会发出。

```sh
npm install -g @haifai/bwhale
bwhale
```

首次运行会将运行时（约 400 MB）一次性下载到 `~/.bwhale`，检查平台所需依赖，
并打开 `http://127.0.0.1:24680`。之后的启动即时完成，并会自动更新。

## 它能做什么

- **Office 交付物** —— `xlsx_create`（实时公式、数字格式、数据条、原生图表、
  主题横幅）、`pptx_create`（KPI 数据页、双栏排版、原生图表、演讲者备注）、
  `docx_create`（封面页、标注框、条纹表格）、PDF 生成。每份演示文稿都获得
  全新的设计——配色与字体按任务挑选，绝不复用。
- **读取你拖入的文件** —— 任意 .xlsx/.csv/.docx 会落入会话工作区，
  `xlsx_read` / `csv_read` / `docx_text` 负责分析。
- **像素级预览** —— 应用内工作室把工作簿渲染成表格、演示文稿渲染成幻灯片
  画廊、文档渲染成纸页。应用内提供的一次性 LibreOffice 运行时让预览精确无比。
- **知识工作技能** —— Coworker 预设自带一组技能，可在 设置 → Skills 中管理。
  一切皆插件——禁用插件，对应板块随之消失。
- **定时任务** —— 可重复任务配实时任务板；错过的运行会被如实呈现，不会被静默丢弃。
- **Standard 模式** —— 更轻的纯聊天预设，不带办公工具。

## 命令

| 命令 | 作用 |
|---|---|
| `bwhale` | 启动（首次运行安装运行时） |
| `bwhale --no-open` | 启动但不打开浏览器 |
| `bwhale doctor` | 报告机器上哪些依赖已就绪/缺失 |
| `bwhale update` | 下次启动时刷新到最新版本 |
| `bwhale stop` | 停止正在运行的服务（关掉浏览器并不会停止它） |
| `bwhale --version` | 显示已安装的运行时版本 |

支持平台：macOS（arm64 + x64）、Linux（x64 + arm64）、Windows x64。

## 连接模型（一次性）

创建 `~/.dsh/.credentials.yaml`：

```yaml
version: 1
refs:
  DEEPSEEK_API_KEY: sk-your-key-here
```

重启 `bwhale`。其余一切——文件、会话、交付物——都保存在这台电脑上。

## 隐私

零云端依赖：会话、工作区和生成的文件都存放在你的用户目录里。唯一的网络流量
是你配置的 LLM 提供商调用，以及你批准的一次性运行时下载。

## 渊源

Baby Whale 的引擎 fork 自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
（MIT 协议）——一个一切皆插件的开源 agent 框架，基于
[Cordis](https://github.com/cordiverse/cordis) 构建。鲸鱼协作者体验——办公技能、
交付物、预览、`bwhale` 启动器——由 [Haifai-AI](https://github.com/Haifai-AI)
在这一基础上构建。

## 开发

```sh
pnpm install
pnpm run build
pnpm dsh web
```

从 [开发指南](docs/development.md) 与 [架构文档](docs/architecture.md) 开始。
代理请遵循 [AGENTS.md](AGENTS.md)。

## 许可

[MIT](LICENSE)

第三方依赖及其许可证见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
