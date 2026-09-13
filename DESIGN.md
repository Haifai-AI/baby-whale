---
name: Baby Whale
description: A macOS window rendered in the browser for a local-first document coworker.
colors:
  accent: "rgb(0, 113, 227)"
  accent-hover: "rgb(0, 119, 237)"
  accent-press: "rgb(0, 104, 209)"
  state-error: "rgb(215, 0, 21)"
  state-success: "rgb(36, 138, 61)"
  state-warn: "rgb(201, 52, 0)"
  canvas: "rgb(255, 255, 255)"
  chrome: "rgb(245, 245, 247)"
  card: "rgb(255, 255, 255)"
  elevated: "rgb(235, 235, 237)"
  label-primary: "rgb(29, 29, 31)"
  label-secondary: "rgb(88, 88, 93)"
  label-tertiary: "rgb(110, 110, 115)"
  label-quaternary: "rgb(174, 174, 178)"
  selection-wash: "rgb(204, 226, 255)"
  scrim: "rgba(0, 0, 0, 0.24)"
  inverse-plate: "rgba(28, 28, 30, 0.82)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: "32px"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "22px"
    letterSpacing: "-0.015em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "25px"
    letterSpacing: "normal"
  control:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
    letterSpacing: "normal"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "14px"
    letterSpacing: "0.02em"
  code:
    fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "19px"
  heading-1:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "30px"
  heading-2:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: "26px"
  heading-3:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: "24px"
  heading-4:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
  section-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
  big-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
  doc-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: "22px"
  doc-subtitle:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  doc-body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "24px"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "30px"
    typography: "{typography.control}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-press}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.label-primary}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "30px"
    typography: "{typography.control}"
  button-secondary-hover:
    backgroundColor: "{colors.chrome}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.label-primary}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "30px"
    typography: "{typography.control}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.label-primary}"
    rounded: "{rounded.lg}"
    padding: "0 14px"
  composer:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.label-primary}"
    rounded: "{rounded.xl}"
    padding: "10px 12px 6px"
  sidebar-row:
    backgroundColor: "transparent"
    textColor: "{colors.label-primary}"
    rounded: "{rounded.sm}"
    height: "28px"
    padding: "0 6px"
  sidebar-row-selected:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    height: "28px"
    padding: "0 6px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.label-primary}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 8px"
    typography: "{typography.control}"
  popup-button:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.label-primary}"
    rounded: "{rounded.sm}"
    height: "26px"
    padding: "0 8px 0 10px"
    typography: "{typography.control}"
  group-label:
    textColor: "{colors.label-secondary}"
    typography: "{typography.caption}"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.label-tertiary}"
    typography: "{typography.control}"
  tab-active:
    textColor: "{colors.label-primary}"
---

# Design System: Baby Whale

## Overview

**Creative North Star: "The Quiet Window"**

Baby Whale looks like a native macOS window that happens to run in a browser. The user is not visiting a product; they are working in a tool they opened this morning and will still have open this afternoon. Everything follows from that: the interface has one canvas, a small number of materials, and a strict rule about where the accent colour is allowed to appear.

The system is built on a closed neutral ramp rather than on a palette of greys. Every surface role — canvas, chrome, card, elevated control — is assigned a named step of that ramp, and a component that needs a tone picks a role instead of mixing a new value. There is exactly one accent, and it means "you can press this" or "this is where you are". It never marks decoration, and it never marks two things in the same column at the same time.

Density is set for the sixth hour of use rather than the first screenshot. Controls are 13px, prose is 15px, and rows are 28px tall, because a source list that fits eight sessions without scrolling is worth more than a list that looks airy in a marketing still. Depth comes from a three-step elevation ladder where each step is a hairline plus a contact and an ambient shadow, never from a single blurred smudge.

**Key Characteristics:**
- One accent, spent only on things that can be pressed and on the current selection.
- A closed neutral ramp; components consume roles, never raw greys.
- macOS control geometry: 13px labels, 26–30px controls, 4/6/8/12/16px corners assigned by the size of the thing rounded.
- Depth as a hairline plus a two-part shadow; translucency only where something real is behind the surface.
- The deliverable outranks the process: tool rows report, they do not perform.

## Colors

A near-monochrome interface in the tradition of macOS system apps, with one blue that always means the same thing.

### Primary
- **System Blue** (`rgb(0, 113, 227)`): the only accent. It fills the primary button, the send control, the selected sidebar row, the selected settings nav cell, and the keyboard focus ring. It also carries the browser's text selection wash (as a 20% tint, `rgb(204, 226, 255)`). In the dark palette it becomes `rgb(10, 132, 255)`, because the light value does not carry white text on a dark ground.
- **System Blue, pressed** (`rgb(0, 104, 209)`): the press state. A macOS control answers a press by darkening, not by moving.

### Neutral
- **Canvas** (`rgb(255, 255, 255)`): the conversation column, the composer card, and every pop-up button face. The content the user came for sits on white.
- **Chrome** (`rgb(245, 245, 247)`): the sidebar column and any grouped settings surface. This is the only large grey field in the product.
- **Card** (`rgb(255, 255, 255)`): a settings inset group, sitting on the panel's grey so it reads as a card rather than as another fill.
- **Elevated** (`rgb(235, 235, 237)`): a raised control face inside a grey region — a segmented control's track, a selected segment's neighbours.
- **Label Primary** (`rgb(29, 29, 31)`): all body and control text.
- **Label Secondary** (`rgb(88, 88, 93)`): descriptive text under a label, timestamps, metadata.
- **Label Tertiary** (`rgb(110, 110, 115)`): group labels and the least important text that still has to be read.
- **Label Quaternary** (`rgb(174, 174, 178)`): decoration only — a link's underline, a chevron, a separator glyph. Never text that carries meaning alone.

### Named Rules
**The One Blue Rule.** The accent appears at most once per column at rest. A sidebar shows one selected row; a settings panel shows one selected nav cell and one primary button, never both at once. Two accent objects in one column means the hierarchy has failed, and the fix is to remove one, not to add a third.

**The Selection Inverts Rule.** A selected item takes the accent as its *fill* with inverted ink, never as a coloured edge or a tinted label. Every descendant that draws in `currentColor` — a state dot, a chevron, an icon — inverts with it, so a selected row reads as one object instead of a blue box with coloured confetti on it.

**The Contrast Floor Rule.** No text uses a step below `tertiary`, and in the light palette `tertiary` and `caption` are the same value. This is a floor, not a preference: on the sidebar's own fill, a neutral must sit at or under ~112 to clear 4.5:1, so the light ramp has room for exactly two steps below primary. `quaternary` exists for decoration and must never be the only thing carrying a meaning.

## Typography

**Display Font:** the system UI stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, with `PingFang SC` / `Hiragino Sans GB` / `Microsoft YaHei` for Chinese)
**Body Font:** the same stack
**Label/Mono Font:** `SF Mono` with `JetBrains Mono`, `Fira Code`, and `Consolas` behind it

**Character:** One family, many sizes. The system face is the correct choice for a tool that runs beside Excel and Keynote all day — it is the face the user's operating system already speaks, and it renders Chinese correctly without a fallback. Character comes from weight and tracking rather than from a second family: large text is semibold and negatively tracked, small text is regular and quiet.

### Hierarchy
- **Display** (600, 26px/32px, -0.02em): the empty-state title, and nothing else. It is the only place the product behaves like a title.
- **Title** (600, 17px/22px, -0.015em): the settings panel heading and the product wordmark.
- **Prose** (400, 15px/25px): assistant answers and user messages. Reading text is one step larger than control text, because an answer is read and a control is scanned.
- **Control** (400–500, 13px/18px): every button, row, tab, menu item, and field. The workhorse size.
- **Caption** (400, 11px/14px, +0.02em): group labels above a list, settings descriptions, the session stats line.
- **Code** (400, 12px/19px): code blocks, terminal output, and diff lines.
- **Markdown Headings** (600, 22/19/17/15px at h1–h4): a rendered answer's own hierarchy. Prose in an answer is 15px, so its headings start only 2px above it and gain their weight from the 600 step — an answer is a document, and its headings scale with the document, not with the app's titles.

### Document Preview Scale (a bounded exception)

The Office preview studio renders a real document, not a UI. Text **inside a painted page** — a slide title, a spreadsheet cell, a paragraph of a report — is sized to the document it is showing (9–20px depending on the source) and deliberately does not sit on the control ramp, because a preview that re-set the user's 20pt slide title to 13px would be lying about the file.

The exception stops at the page's own edge. Everything the preview draws *around* the page — its header, its kind chip, its filename, its toolbar — is chrome and takes the control scale. A value that is neither inside a painted page nor on the ramp is a bug, not an exception.

### Named Rules
**The Step-Apart Rule.** Adjacent steps in the scale differ by at least 2px of size or one weight step. A 13px label and a 13px description in the same row are separated by ink, not by size, and a description never appears below its own title without one of the two.

## Layout

The app is a three-column grid at 100% viewport height: a 260px sidebar, a flexible conversation column, and an optional details panel. Both inner borders are draggable, and collapse animates the grid tracks rather than the content, so nothing reflows mid-slide.

Inside the conversation column, content is centred on a shared width axis of 720px. The transcript, the docked cards, and the sticky composer all derive from that one value, so the composer card stays exactly 32px wider than the transcript at every viewport. Below roughly 900px the sidebar collapses to a 52px rail; the rail keeps every control at 32×32 with an 8px vertical rhythm.

Spacing has one rhythm: 4px inside a control, 8px between controls, 12px between groups, 16–20px between sections. Row heights follow the source-list convention — 28px for a session, 30px for a workspace, 26px for a control.

## Elevation & Depth

A hybrid system: tonal layering establishes most of the hierarchy, and shadows describe the few objects that genuinely float. The canvas is white, the sidebar is grey, and a settings card is white on grey — that alone is enough to place most of the interface without a single shadow.

Where an object floats (a menu, a dialog, a popover, the composer card), it takes one of three shadow steps. Each step pairs a hairline ring with *two* shadows: a tight contact shadow that seats the object on the surface, and a wide ambient shadow that gives it height. A single blurred shadow reads as a smudge; the pair reads as an object sitting at a height.

Backdrop blur is treated as a layout decision, not only a visual one, and is therefore used sparingly: only on the dialog scrim and the toast. `backdrop-filter` establishes a containing block for `position: fixed` descendants, and this client positions its menus by computing viewport coordinates from an anchor's rect — so a blurred ancestor silently moves every menu anchored inside it. Blur never goes on a column or a card that contains a picker.

### Shadow Vocabulary
- **resting** (`0 0 0 0.5px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04)`): a button sitting on a surface, a segmented control's lifted segment.
- **floating** (`0 0 0 0.5px rgba(0,0,0,0.05), 0 2px 8px rgba(0,0,0,0.07), 0 10px 24px rgba(0,0,0,0.07)`): the composer card, a tooltip, a back-to-bottom control.
- **overlay** (`0 0 0 0.5px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.1), 0 28px 64px rgba(0,0,0,0.14)`): menus and dialogs. The dark palette swaps the hairline for a light one and deepens the cast, because the alphas that read on white read as nothing on a dark ground.

## Shapes

Corners are assigned by the size of the thing being rounded, from a closed six-step scale: 4px (`xs`) for an inline token, 6px (`sm`) for a control or a row, 8px (`md`) for a button or a field, 12px (`lg`) for a card or a menu, 16px (`xl`) for the composer and a dialog, and fully round for a circular control.

The 6px row corner is the signature detail: session rows, settings nav cells, and pop-up buttons all take it, and its smallness is what makes a dense list look native rather than like a stack of cards. The composer card at 16px is the single softest shape in the product, which is deliberate — it is the one object the user addresses directly.

Borders are hairlines in three weights: 1px at 6% opacity for a card edge, 10% for a control edge, and 14–20% for a field that has to look editable. Nothing uses a 2px border except a focus ring.

## Components

### Buttons
- **Shape:** rounded rect, 8px radius (`--dsw-radius-md`), 30px tall (24px compact).
- **Primary:** the accent fill with white text. One per view.
- **Secondary:** a white face, a hairline edge, and the resting shadow. This is the default AppKit button, and the shadow is what separates it from a bordered div.
- **Ghost:** transparent, hover fills with a 5% neutral wash, press darkens to 8%.
- **Hover / Focus:** hover raises the fill one step; press darkens. Focus is a 2px accent ring at 2px offset, drawn by the theme's default `:focus-visible` rule so every control gets it without opting in.

### Chips
- **Style:** 20px tall, 6px radius, an 11px medium label on the secondary fill.
- **State:** selected takes the next fill step up plus a hairline ring — position, not colour.

### Cards / Containers
- **Corner Style:** 12px for a card or menu (`--dsw-radius-lg`).
- **Background:** white on the grey chrome, or the chrome grey on white.
- **Border:** a 1px hairline at 6% opacity. A card inside a dialog owns its border; a card on the canvas may rely on the shadow alone.
- **Internal Padding:** 10–14px horizontally, 10px vertically per row.
- **Separators:** a settings row draws its own separator as a pseudo-element that stops short of the card's leading edge, so the card reads as one object with items in it rather than as a stack of boxes.

### Inputs / Fields
- **Style:** a white face, a 14% hairline edge, 8px radius, 30px tall.
- **Focus:** the accent ring plus a 10% accent glow. The previous system swapped the border colour, which is easy to miss on a dense form.
- **Placeholder:** `label-quaternary` — the one text case allowed below the contrast floor, because a placeholder is never the only source of a field's meaning.

### Navigation
- **Sidebar:** a 260px grey column with a 30px title bar, one 30px New Session button, a labelled session tree, and Settings pinned to the foot. Rows are 28px with a 6px corner and a 20px indent step. The selected row takes the accent fill with inverted ink and medium weight.
- **Tabs:** a 13px medium label strip with a 1.5px rule under the selected tab. The selected tab is the darkest ink in the strip plus the rule — position carried by weight and a mark, not by a second colour.

### Composer
- **Character:** the one object the user addresses directly, and the softest shape in the product.
- **Shape:** a 16px-radius card with the floating shadow, holding a 15px auto-growing textarea above a control row: attach and mode chips on the left, model pop-up and a single accent send button on the right.
- **States:** the send button is the only accent object in the composer; the attach control and the model trigger are chrome-free until hover, so the trailing controls are the quietest thing in the row.

### Tool Run (the folded transcript)

- **Character:** the process recedes so the answer can be read.
- **Shape:** a settled, clean run of three or more tool calls collapses to one 22px line — a 16px leading mark, a 13px muted label (`12 tool calls · 34s`), and a chevron that flips on open. Rows return on click, and a reader's expansion survives the run settling.
- **What never folds:** a run that is still working (live calls stay watchable), a run containing a failure or an interruption, and anything carrying prose — the answer's own text always ends a run.
- **Why it reads as one object:** the summary's leading mark repeats the row's 16px leading slot, and a negative inline start pulls its label back onto the transcript's text axis, so a folded run sits in the same column as the prose around it rather than one indent step to the right.

### Tool Row
- **Character:** a report, not a performance. Rows appear inside their run; the fold above decides when they show at rest.
- **Shape:** a 22px single-line row — a 16px leading glyph, a 13px title, a 3px separator dot, and a truncating 13px summary.
- **Running state:** a 1px accent rule travelling along the row's bottom edge. The previous treatment swept a 300px glare band across the row's own glyphs, dimming the text it was meant to annotate.

## Do's and Don'ts

### Do:
- **Do** assign a surface a role from the closed ramp (`--dsw-gray-*` via an alias) rather than writing a new grey.
- **Do** keep the accent to one object per column at rest, and prefer removing one over adding a third.
- **Do** give a selected item the accent fill with inverted ink, and set `color: var(--dsw-alias-label-primary-foreground)` on it so its descendants invert with it.
- **Do** pair a font size with a line height from the scale, and keep a settings row's separator inset from the card edge.
- **Do** check any new text colour against `4.5:1` on its real backdrop — the translucent fills composite, so a token that passes on white may fail on the sidebar.
- **Do** keep `backdrop-filter` off any element that contains a portaled menu.

### Don't:
- **Don't** use `--dsw-alias-label-quaternary`, `--dsw-alias-label-dimmed`, or `--dsw-alias-separator-primary` for text that carries meaning; they are decoration and fall below the contrast floor.
- **Don't** put a theme selector (`[data-ds-dark-theme]`) in a feature stylesheet; light/dark overrides belong to `ui-theme`.
- **Don't** write a literal colour in a feature stylesheet, or reach for the raw `--dsw-static-*` palette; each one that remains is a surface that has not migrated yet. The single documented exception is the framework-free boot page (`packages/client/web/src/boot-page.module.css`), which paints before any theme CSS can load and therefore mirrors the palette's values as literals — those must move in the same change that moves the ramp.
- **Don't** animate `width`, `height`, `padding`, or `margin`; animate `transform`, `opacity`, `background`, or grid tracks.
- **Don't** use an overshoot or elastic easing curve. A macOS control answers a press by darkening, not by moving.
- **Don't** reach for a capsule (`border-radius: 999px`) on a rectangular control; the capsule is the iOS button and reads as a marketing CTA, not as a window control.
