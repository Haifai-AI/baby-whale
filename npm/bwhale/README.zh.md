# bwhale — Baby Whale in one command

[English](README.md) | 中文

本地优先的知识工作协作者：交给它一项任务，拿回成品 Excel 工作簿、PowerPoint 演示文稿、Word 文档和 PDF——由代码构建、像素级精确预览，且从不离开你的电脑。

```bash
npm install -g bwhale
bwhale
```

首次运行会从本项目的 GitHub Releases 一次性下载运行时（约 400 MB）到 `~/.bwhale`，检查平台所需依赖，并打开 `http://127.0.0.1:24680`。之后的启动即时完成。

## 命令

| 命令 | 作用 |
|---|---|
| `bwhale` | 启动（首次运行安装运行时） |
| `bwhale --no-open` | 启动但不打开浏览器 |
| `bwhale doctor` | 报告机器上哪些依赖已就绪／缺失 |
| `bwhale update` | 下次启动时刷新到最新版本 |
| `bwhale stop` | 停止正在运行的服务（关掉浏览器不会停止它，`--stop` 同样可用） |
| `bwhale --version` | 显示已安装的运行时版本 |

支持平台：macOS（arm64 + x64）、Linux（x64 + arm64）和 Windows（x64——shell 工具由 PowerShell 驱动；启动器会通过 `bwhale doctor` 明确告诉你缺什么）。

## 它会检查和安装什么

应用自带 Node——你只需要平台基础依赖，`bwhale doctor` 会明确告诉你缺什么以及对应的平台原生安装命令：

- **macOS** —— 无需其他依赖；办公库会在首次启动时自行安装
- **Linux** —— 需要 `git`；创建办公文件需要 `python3`；`libreoffice` 可选（像素级精确预览，之后也可在应用内安装）

连接模型（一次性）：创建 `~/.dsh/.credentials.yaml`：

```yaml
version: 1
refs:
  DEEPSEEK_API_KEY: sk-your-key-here
```

然后执行 `chmod 600 ~/.dsh/.credentials.yaml`。

## 隐私

文件、会话、历史和工件都完全保存在你的电脑上。唯一的网络调用是你配置的模型提供商、一次性运行时下载和更新检查。

MIT——一个构建在 DeepSeek Harness 之上的知识工作产品。
