# `@deepseek-ai/dsh-tool-office`

[English](README.md) | 中文

面向模型的 office 读取工具，构建在[文件系统 seam](../../fs/fs/README.zh.md)之上：`xlsx_read`、`csv_read`、`docx_text`。

每个工具都把工作区相对路径按调用会话的 cwd 解析，经 `ctx.fs.readBytes` 最多读取 25 MB，并返回有界的 JSON 安全提取结果而不是原始文件。读取就是本包的全部职责：office 的**创建**以代码为先，通过 bash 工具运行 Python（`openpyxl` / `python-pptx` / `python-docx` / `reportlab`），再用 `deliver` 呈现结果。

## 工具

| 工具 | 输入 | 关键行为 |
|---|---|---|
| `xlsx_read` | `.xlsx` | 每张表的表头、抽样行、按列类型提示、A1 形式的合并区域，公式保留为 `{ formula: "=…" }` |
| `csv_read` | 分隔文本 | 在 `,`、`;`、制表符与 `|` 之间嗅探分隔符，RFC-4180 引号处理，数字强制转换，有界抽样 |
| `docx_text` | `.docx` | 标题、1-3 级标题、段落、项目符号、编号条目，以及以类 markdown 行呈现的表格行 |

存在两套界限，而且它们并不相同：工具参数 `max_rows` 最多接受 400（`xlsx_read` 默认 100，`csv_read` 默认 200），而提取本身每张表最多抽样 200 行、64 列，并报告 `truncated`。`docx_text` 没有行参数；它在 24000 个字符处停止。抽样值都经过塑形，绝不是原始值：日期变成 `YYYY-MM-DD`，布尔值变成 `TRUE`／`FALSE`，富文本被拼接，错误单元格渲染为 `{error:…}`。我们自己的写入器产出的横幅式工作簿——第 1 行是跨列合并标题、第 2 行才是表头——会被识别出来，并以 `title` 加取自第 2 行的表头上报，因此数据抽样不会从横幅开始。

## 预览数据

提取载荷在构造上就是 JSON 安全且可回放的，这也是这些工具呈现携带 `locations` 的通用读取卡片、而不是专门预览渲染器的原因。宿主预览服务与本包共用两个辅助函数——`loadWorkbookResilient` 与 `decodeEntities`——因此两个 xlsx 读取器不会在能打开哪些工作簿或如何解码 OOXML 文本上出现分歧。

## 模型体验

### `tool:office` 与 `tool:office-reads` 系统提示词指引

#### 模型看到的内容

两段固定指引，都在顺序 105：`tool:office` 把创建路由到 Python 与 `deliver`，`tool:office-reads` 点名三个读取工具及其界限。

##### `tool:office` 段落原文

```markdown
Reading user files: use xlsx_read/csv_read/docx_text on uploaded spreadsheets and documents before analyzing them. Creating office files is done by WRITING AND RUNNING PYTHON CODE (openpyxl / python-pptx / python-docx / reportlab) through the bash tool using $DSH_OFFICE_PYTHON, then surfacing finished outputs with the deliver tool.
```

##### `tool:office-reads` 段落原文

```markdown
Reading user files: use xlsx_read on uploaded .xlsx workbooks (per-sheet header, sampled rows, column-type hints, merged ranges, formulas), csv_read on delimited text, and docx_text on .docx documents before analyzing or transforming them. Extraction is bounded; request follow-up slices only when genuinely needed. Analysis outputs still go through the create tools.
```

#### Token 影响

固定：只要本包处于挂载状态，两段都会出现在每次组装请求中，且都不随会话读取了多少文件变化。

#### KV Cache 影响

前缀稳定：两段在挂载期间都保持文本与顺序不变，因此包含它们的已加载前缀可跨轮次复用。

### Office 读取工具定义

#### 模型看到的内容

生成的 [`xlsx_read`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-office)、[`csv_read`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-office)、[`docx_text`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-office) schema：每个都有必填的 `file_path`，两个表格类工具另有可选的 `max_rows`，其描述写明了默认值与硬上限。

#### Token 影响

工具可见时，每次请求都要支付固定的 schema 成本；抽样策略就写在描述里，因此模型不必靠试错去发现上限。

#### KV Cache 影响

注册集合与可见性不变时前缀稳定；插件生命周期或 scope 限制改变工具集合时，可能从第一处变化的定义起使复用失效。

### 提取出的读取结果

#### 模型看到的内容

每个结果渲染为 `<path>…</path>`、`<type>xlsx|csv|docx</type>`，以及一个 `<content>` 块，内含 JSON 载荷；`docx_text` 则放类 markdown 文本。表载荷携带 `name`、`total_rows`、`total_cols`、可选的 `header` 与横幅 `title`、抽样 `rows`、`column_types`，以及最多 32 条 `merged_ranges`；两个表格类工具都会设置 `truncated`。稳定的失败信息是 `unreadable workbook (exceljs failed, stripped-drawing retry also failed)` 与 `not a docx package (missing word/document.xml)`；过大的文件会在 seam 的 25 MB 读取界限处失败。

#### Token 影响

条件性且取决于文件：一次提取最多是 400 抽样行或 24000 个字符，后续切片还会继续追加。很宽的工作簿每行最多按 64 列计费，因此模型主要通过两个行参数控制成本。

#### KV Cache 影响

仅追加：提取结果位于可复用请求前缀之后，而不是重写它，因此读取大文件不会使已缓存的 prefix token 失效。只有注册的工具集合或指引段落发生变化才会影响复用。

## 已知限制与暂缓事项

- 没有 office 文件的**预览**工具：除了 `read_bytes` 式的访问，模型无法查看已有的 xlsx／pptx／docx。
- 不提供 LibreOffice／完整保真度保证：格式是工具内置的默认设计，不是模板引擎。
- 读取有界且按位置抽样：有意思的数据落在行上限之后的稀疏表格需要显式追加切片，而且只有表格类工具会上报 `truncated`——`docx_text` 只在段落入队路径上设置它，因此在块循环处被截断的文档可能返回不完整的 `text` 却不带该标志。
- `tool:office-reads` 指引告诉模型「Analysis outputs still go through the create tools」，但本包没有注册任何创建工具——创建是经 `bash` 运行 Python 再用 `deliver`，因此这句话指向了模型必须去别处寻找的能力。
