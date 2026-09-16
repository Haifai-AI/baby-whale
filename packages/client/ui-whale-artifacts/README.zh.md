# `@deepseek-ai/dsh-client-ui-whale-artifacts`

[English](README.md) | 中文

**产物**视图标签页（`id: whale-artifacts`，`order: 11`），与 Chat、Trajectory 并列：以纯元数据形式列出会话工作区 `deliverables/` 与 `uploads/` 下的文件，配右侧预览面板与应用内打开，由 gateway 的 `artifacts` 域提供数据。

## 列表

`artifacts.list` 每次挂载只做一次按会话寻址的读取；除「刷新」按钮外没有其他触发，因为协议上没有产物变更通知。条目按最新优先到达，受宿主扫描上限约束为 200 条；扫描只对两个目录的顶层做 stat，跳过隐藏名称与嵌套目录。

每行绘制类型徽章、以完整路径作为 title 的文件名、来源（`from.deliverable`／`from.upload`）、字节大小，以及本地化的修改时间（无法解析时回退为「时间未知」）。只有浏览器或详情面板能渲染的类型才显示「预览」；`other` 只提供「打开」。打开操作——无论来自列表行还是面板标题栏——都会把工作区相对路径按会话 cwd 解析后交给 `host.openPath`；未上报 cwd 的部署则直接打开裸相对路径。

## 预览面板

选中一个文件就触发一次解析，且每次选择都会认领一个 generation，因此较慢的早期响应无法覆盖更新的选择。带浏览器原生渲染器的类型——图片、视频、音频——完全跳过解析调用，直接把面板指向带 token 的 `artifacts.raw` URL；视频与音频使用原生播放器，经支持 Range 的信道流式读取。

解析得到的预览按类型分流：`markdown` 走 `MarkdownFilePreview`，`text` 走 `CodeFilePreview`（两者都会在解析被截断时给出提示），`pdf` 经仅限宿主访问的转换后 PDF 信道以 iframe 呈现，Office 各类型则走 `ArtifactStudioBody`，复用 [`ui-whale-artifact`](../ui-whale-artifact/README.zh.md) 公开的详情面板。工作簿还有自己的标签页：`Data`（原生网格详情面板）、`Charts (n)`（把工作簿内嵌图表重新渲染为主题化 SVG）、`Original`（LibreOffice 对真实文件的 PDF 渲染）——任一来源缺失时对应标签页会独立消失。解析结果报告 `soffice-missing` 时，正文之前会先给出一条提示，说明当前展示的是文本提取版。

## 组合方式

本包声明 `dsh.client`（platform 为 `web`，并以 `@deepseek-ai/dsh-client-ui-whale-artifact/client` 与 `@deepseek-ai/dsh-client-connection/client` 作为已声明的模块请求），注册一个 `conversation.view` 条目——其注册注入 connection 句柄与所寻址的会话——以及 `whale-artifacts` 字典命名空间。其 Node 侧不贡献任何宿主行为。

## 模型体验

### 产物列表与预览面板

#### 模型看到的内容

没有任何内容：该标签页在浏览器侧渲染列表，数据来自 `artifacts.list` 与 `artifacts.preview` 两个 gateway 读取以及 `artifacts.raw`／`artifacts.file` 字节信道，它们都不触及请求。本包不注册提示词段落、工具定义或工具结果。

#### Token 影响

直接开销为零：列出、刷新与预览产物都不会给任何请求增加 token，带 token 的原始字节 URL 也只服务于浏览器。

#### KV Cache 影响

相互独立：本包既不组装也不发送提供方请求，因此预览操作不会使可复用的前缀失效。

## 已知限制与暂缓事项

- **列表每次挂载只读取一次**：协议不广播产物变更，因此标签页挂载之后写入的文件要等到刷新或切换会话才会出现。
- **扫描范围是两个扁平目录，上限 200 条**：只列出 `deliverables/` 与 `uploads/` 的直接子文件，跳过隐藏名称，并按修改时间保留最新的 200 条。
- **Office 预览需要 LibreOffice**：`Original` 标签页与像素级精确的 Office 渲染都依赖宿主的 `soffice` 运行时；缺少它时详情面板只显示带提示的文本提取版，而 `Charts (n)` 也仍然只包含解析能提取到的图表。
- **`Charts` 标签页是重绘，而非工作簿自身的渲染**：内嵌图表由提取出的系列（分组柱状、条形、折线、面积、饼图、圆环与散点）重新渲染为主题化 SVG，因此样式与 Excel 并不一致。
- **预览 URL 携带实例 token**：面板的 iframe 与媒体播放器都使用 `withApiTokenQuery` URL，宿主也会拒绝两个被扫描目录之外的任何路径。
- **陈旧解析会被丢弃，陈旧列表不会**：按选择划分的 generation 防护会丢弃迟到的预览响应，而列表行保留的是上一次读取时捕获的元数据。
