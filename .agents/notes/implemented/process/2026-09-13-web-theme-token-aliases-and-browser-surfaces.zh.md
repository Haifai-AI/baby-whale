# Agent Note: Web 主题声明功能 CSS 消费的 token 别名，并为浏览器绘制的表面配色

Status: implemented

[English](2026-09-13-web-theme-token-aliases-and-browser-surfaces.md) | 中文

## Problem

将每一处 `var(--dsw-*)` 引用与每一处声明逐一比对后发现，`design-platform.css` 从未声明十个语义别名，而功能样式表已经在消费它们：`--dsw-alias-fill-l2`、`--dsw-alias-fill-secondary`、`--dsw-alias-fill-tsp-secondary`、`--dsw-alias-label-quaternary`、`--dsw-alias-label-error`、`--dsw-alias-line-secondary`、`--dsw-alias-separator-primary`、`--dsw-alias-border-secondary`，另有五个无归属的一次性名称散落在 `--dsw-text-*`、`--dsw-surface-*`、`--dsw-danger`、`--dsw-warning*`、`--dsw-accent`、`--dsw-font-mono` 各family中。未被声明的自定义属性不是错误：该声明计算为 guaranteed-invalid 值，读取它的属性回退到 `inherit` 或其初始值。后果是静默的——统计行的分隔符使用了该行自身的文字色而非更浅的一档，agent preset 的 chip 没有背景，表单字段的无效边框与静止边框无从区分，禁用控件保留全对比墨色，artifact 横幅下方没有接缝。每一处都细微到没有任何单个界面看起来是坏的，这正是它们累积下来的原因。

同一层里还有两个相关缺口。没有任何规则为浏览器（而非组件）绘制的表面配色——`::selection`、`caret-color`、`accent-color` 与键盘焦点环保留着 UA 的默认蓝，那是产品中唯一没有任何主题 token 触及的色板。层级阶梯的每一档只有一个模糊阴影，没有偏移与模糊的配对，也完全没有深色色板覆盖，因此深色模式的菜单在深灰底色上承载着浅色色板 alpha 的黑色阴影，读起来毫无层级。

## Decision

`design-platform.css` 为功能 CSS 已经在消费的每个别名补上声明，各自绑定到既有的静态色阶档位；`base.css` 增加 `--dsw-font-mono`，作为 `--ds-font-family-code` 按角色命名的别名。引用了无归属一次性名称的功能样式表，改取该角色对应的语义别名。

新增样式表 `ui-theme/src/styles/surfaces.css`，负责浏览器绘制的表面：

- `::selection` 采用 `--dsw-specific-bubble-highlight` 配主墨色，使选中文字在两种色板下都保持对比度，而 UA 默认在深色上会把字形冲淡。
- `caret-color` 取 `--dsw-alias-state-business-primary`：这是 composer 的透明 textarea 唯一自行绘制的字形。
- `accent-color` 让 UA 绘制的表单控件取同一个蓝。
- `:focus-visible` 用 `--dsh-focus-ring-{width,offset,color}` 绘制默认焦点环，这三个值就声明在规则旁的 `body` 上。文本字段改为内嵌环；自行绘制焦点环的组件仍然胜出。

它的规则落在 `body` 上——`--dsw-alias-*` 层由 `body` 承载——且该表在 `design-platform.css` 之后加载：自定义属性是相对于读取它的规则所在的层叠位置完成替换的。

`--dsw-shadow-lv1/2/3` 改为接触阴影加环境阴影的配对（一个紧凑小偏移的阴影垫在一个大模糊的宽阴影之下），并增加深色色板块，加深 alpha 并为 `lv3` 补上一道发丝描边。

三个消费方修复一并落地，因为扫描把它们识别为同一类缺陷：`ProducedFiles` 的 studio、`DetailsArtifact` 的 gallery、`OfficeArtifactCard` 的文档页都在某个表面上滚动，却没有重新绑定该表面的层级，因此它们的深色色板滑块取的是基础表面的颜色。

## Alternatives considered

- **在调用点把每处未声明的引用换成既有 token**：每个文件的改动最小，但同一个名称仍会被多个样式表引用而无声明，下一位读者无法判断哪个值是权威，第十个消费方还会重犯同一个错误；故拒绝，改为每个名称一处声明。
- **为浏览器表面单独建插件包**：样式规则规定全局样式表归 `ui-theme/src/styles/`，而这些规则消费的正是该包在 `body` 上的别名层；独立包不拥有任何 token，且只能靠声明排在本包之后；故拒绝。
- **把默认焦点环挂在 `:focus` 伪类上**：每次鼠标点击都会画出焦点环，平台观感不允许；故拒绝，改用 `:focus-visible`。
- **保留一次性名称并把它们也声明为别名**：`--dsw-text-muted`、`--dsw-accent`、`--dsw-warning` 命名的角色在语义层已经存在，声明它们等于为一个角色认可第二套词汇；故拒绝，改为迁移那六处调用点。

## Consequences

`packages/client` 与 `apps/web` 中每一处 `var(--dsw-*)` 引用现在都能解析到声明；重跑同一扫描只会报出两个由运行时注入的几何变量（`--dsh-composer-height` 来自座位观察器，`--dsh-boot-arc` 来自启动页自身的循环）。焦点环与选中色在每种主题下都是同一个可供性，层级阶梯在两种色板下都读得出高度。

代价是：`surfaces.css` 成为第六张必须保持在 `design-platform.css` 之后加载的样式表；焦点环的三个值是一套功能 CSS 可以采用、但目前没有任何机制强制的新共享写法；重调层级会改变所有消费该阶梯的表面——没有任何测试固定这一点，因此它由截图而非断言来验证。
