# @deepseek-ai/dsh-client-ui-theme

[English](README.md) | 中文

主题插件：基于 --dsw-* token 基础样式表（静态尺度 + 别名语义层）的 ThemeRuntime。该服务拥有实时主题偏好（`light`／`dark`／`system`），将 `system` 通过 `prefers-color-scheme` 解析为实际主题，并发布不可变的 `ThemeSnapshot`，通过 `theme/change` 事件通知变化；它绝不接触 DOM：ui-layout 的呈现器会应用解析后的快照（`html { color-scheme }`、`body[data-ds-dark-theme]`，以及主题的别名 token 内联变量）。来自回环地址的浏览器会先以 `system` 立即提供该服务，随后在后台加载 `ui-theme.preference`，并将每次内置主题选择通过 Host settings API 写入；其本地提供方默认将设置存入 `$DSH_HOME/settings.yaml`。收到推送的 settings 变更时或重连后，浏览器都会重新拉取该设置；连续快速选择会按操作顺序携带 namespace revision 串行写入，最新写入被拒时则重新加载持久化值。远程浏览器无法访问特权 settings API，因此它的选择仅保留在进程内。已注册的第三方主题 id 仍是进程内扩展，不会跨越内置 settings schema；移除其中任意一个都绝不会覆盖最后一个持久化的内置偏好。该持久化边界由[Host settings 支撑的偏好决策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.zh.md)拥有。

当主机组合包含 HTTP 服务器时，主机侧紧接 `<body>` 起始标签注入同步引导代码。每份 index 响应会嵌入已注册的 Host 设置 `ui-theme.preference`，没有 settings provider 时则嵌入 `system`；浏览器按操作系统配色解析 `system`，随后在外壳加载页面渲染前设置 `color-scheme` 和 `body[data-ds-dark-theme]`。不含 HTTP 服务器的组合不受影响，插件树激活后，ThemeRuntime 与 ui-layout 仍分别是客户端状态和后续 DOM 更新的权威来源。

`src/styles/` 下有六张样式表，由 ui-theme 的动态客户端 entry 依次导入：`base.css`、`design-platform.css`、`scrollbar.css`、`surfaces.css`、`gradient-shadow-text.css` 与 `shiki.css`。客户端 bundle 将其编译并注入为插件持有的全局样式，因此卸载与 HMR 会随 ui-theme 一同移除这些样式，而不会把主题 CSS 留在静态 Web 外壳中。`scrollbar.css` 是 `--dsw-alias-scrollbar-*` token 的唯一消费方，必须排在声明这些 token 的 `design-platform.css` 之后。

`design-platform.css` 是分层的，而分层本身就是约定。最底层是原始色板（`--dsw-static-*`，导出自上游 Figma 变量集）；其上是一套封闭的中性色阶（`--dsw-gray-00` … `--dsw-gray-95`，按色板分别声明）以及强调色与状态墨色（`--dsw-accent*`、`--dsw-state-*`）；最上层是功能 CSS 消费的语义别名。功能样式表只读取别名——功能样式表中出现 `--dsw-static-*` 或 `--dsw-gray-*` 引用，说明该表面尚未迁移。浅色与深色是两个独立色板而非互为反色：深色把外壳置于画布之上，并针对深色底重新选取标签色阶。

`base.css` 声明别名层与功能 CSS 共享的固定尺度：字体栈、六级圆角尺度（`--dsw-radius-xs` … `-full`）以及动效 token（`--ds-ease-out`、`--ds-ease-in-out` 与三档时长）。这里刻意不提供回弹或弹性曲线。`gradient-shadow-text.css` 拥有高度阶梯（`--dsw-shadow-lv1/2/3`，每一级都是发丝线加接触阴影与环境阴影，且三级都有深色覆盖）、两种材质填充，以及排版角色。

有两条规则约束强调色的使用方式，两者都靠评审而非门禁来保证。静止状态下每列最多出现一次强调色——侧栏只显示一个选中行，设置面板只有一个选中的导航项和一个主按钮，绝不同时出现。选中项以强调色作为*填充*并反转墨色，同时设置 `color: var(--dsw-alias-label-primary-foreground)`，使以 `currentColor` 绘制的后代随之反转。

`surfaces.css` 负责的是浏览器而非组件绘制的表面：`::selection`、`caret-color`、UA 绘制的表单控件所用的 `accent-color`，以及 `:focus-visible` 的默认键盘焦点环。它们全部从别名层解析，因此该表同样必须排在 `design-platform.css` 之后——自定义属性是相对于读取它的规则所在的层叠位置完成替换的，仅靠样式表顺序并不足够。焦点环的三个值（`--dsh-focus-ring-width`、`--dsh-focus-ring-offset`、`--dsh-focus-ring-color`）就声明在 `body` 上、紧邻焦点环规则，也是自行绘制焦点环的功能 CSS 所采用的共享写法。

滚动条重新绑定约定：`scrollbar.css` 在 `body` 上把 `--dsh-scrollbar-thumb` 与 `--dsh-scrollbar-thumb-hover` 绑定到 l1（基础表面）token，两条渲染路径都读取这一组变量。高层级表面（菜单、浮层、对话框）在自己的容器上设置 `--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2)` 与 `--dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2)`；一次重新绑定即可为引擎实际走的那条路径换色。这组变量的另一个合法目标是 `transparent`，即完全不绘制滑块——[ui-sidebar](../ui-sidebar/README.zh.md) 在指针不在栏内时就这样重新绑定自己的列。绑回 l1 那组不算重新绑定，它只是重述基础表面的默认值。`--dsh-scrollbar-width` 镜像 WebKit 滚动条的布局宽度，供需要与占布局宽度的滚动条对齐的表面使用——[ui-conversation](../ui-conversation/README.zh.md) 用它作为覆盖 composer 座位 `right` 偏移——scrollbar-styles 规格把它与镜像规则及消费者配对检查。

两条路径在构造上互斥。`scrollbar-width`／`scrollbar-color` 写在 `@supports not selector(::-webkit-scrollbar)` 之内，因为这两个属性中的任一个只要取非 `auto` 值，Chromium 与 Safari 就会丢弃该元素上的全部 `::-webkit-scrollbar*` 规则，`::-webkit-scrollbar-thumb:hover` 也在其中——若无条件地同时声明，`--dsh-scrollbar-thumb-hover` 在任何引擎上都不会被渲染。因此 Firefox 走标准属性，WebKit 系引擎走伪元素，hover token 只经由伪元素这条路径渲染。相关原理与实测计算值见[滚动条 Agent Note](../../../.agents/notes/implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.zh.md)。

## 模型体验

无。主题服务管理浏览器偏好；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **第三方主题是表层，不是产品**：注册主题意味着覆盖同名别名变量；目前不会验证一组覆盖是否完整。
- **token 样式表是颜色值的唯一权威来源**：功能样式表需要的颜色须在同一变更中作为色阶层级加语义别名加入此处，绝不在调用处写成字面值。这些样式表最初导出的设计稿已不再是权威来源；色阶才是。
- **浅色调色板无法再容纳位于 AA 之上的第三档标签**：在侧栏自身的填充上，中性色必须位于约 112 或更深才能通过 4.5:1，因此 `--dsw-alias-label-caption` 与 `-tertiary` 在浅色下解析为同一取值，在深色下分开。`-quaternary`、`-dimmed` 与 `--dsw-alias-separator-primary` 属于装饰，绝不可作为某个含义的唯一载体。原先依赖 caption 与 tertiary 取值不同的组件，须改用尺寸或字重区分。
- **`backdrop-filter` 既是视觉决策也是布局决策**：它会为 `position: fixed` 后代建立包含块，而 ui-primitives 的 `Menu` 传送门模式依据锚点的视口矩形定位。因此模糊只保留在不承载传送门菜单的叶子层（对话框遮罩、toast）；包含选择器的列或卡片不得使用。
- **`--dsw-static-*` 在功能 CSS 中已无消费者，但原始色板仍然保留声明**：`ansi.ts` 读取其中的原始蓝色阶用于终端配色，Office 预览读取由它派生的文件类型与文档表面别名。删除原始层会让任何遗留引用变成静默无效值，而不是报错。
