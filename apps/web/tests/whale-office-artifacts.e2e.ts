// Web e2e scenario: Whale office artifact preview cards. Cold-seeds one
// settled turn with real xlsx_create/pptx_create/docx_create calls + results
// (each carrying a bounded presentationMeta preview), then verifies the
// assembled conversation renders spreadsheet, slide-deck, and document cards.
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'
import type {} from '@deepseek-ai/dsh-whale-core/src/types.ts'

const MODE = webSnapshotMode()
const SEED_ID = 'whale-office-artifacts-web-e2e'
const DONE = 'WHALE_ARTIFACTS_DONE'
const SCREENSHOTS = resolve(fileURLToPath(new URL('../../..', import.meta.url)), '.artifacts/whale-screenshots')

// ---- Local preview builders ------------------------------------------------
// The generator tools were removed from tool-office (creation is code-first
// now), but old session logs still carry their presentationMeta. These local
// builders reproduce those bounded shapes so this cold-seed keeps proving the
// client renders legacy previews on replay.

const PREVIEW_MAX_ROWS = 100
const PREVIEW_MAX_COLS = 60

type LocalCell = { v: string }

interface LocalSheet { name: string; header: string[]; rows: LocalCell[][]; total_rows: number; total_cols: number }
interface LocalSlide { title: string; subtitle?: string; bullets?: string[] }
interface LocalBlock { type: 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'quote' | 'bullet' | 'number'; text: string }

function cap(value: string, max = 300): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

function xlsxPreview(filePath: string, sheets: Array<{ name?: string; header?: string[]; rows: (string | number)[][] }>): JsonValue {
  const capped = sheets.map(sheet => ({
    name: cap((sheet.name ?? '').trim() || 'Sheet', 60),
    header: (sheet.header ?? []).map(c => cap(c)),
    rows: sheet.rows.slice(0, PREVIEW_MAX_ROWS).map(r => r.slice(0, PREVIEW_MAX_COLS).map(c => ({ v: cap(String(c)) }))) as LocalCell[][],
    total_rows: sheet.rows.length,
    total_cols: Math.max((sheet.header ?? []).length, ...sheet.rows.map(r => r.length)),
  }))
  return { kind: 'xlsx', file_name: basename(filePath), sheets: capped satisfies LocalSheet[], truncated: false }
}

function pptxPreview(filePath: string, title: string, slides: Array<{ title: string; subtitle?: string; bullets?: string[] }>): JsonValue {
  return {
    kind: 'pptx',
    file_name: basename(filePath),
    title: cap(title),
    slides: slides.map(s => ({
      title: cap(s.title),
      ...(s.subtitle !== undefined ? { subtitle: cap(s.subtitle) } : {}),
      ...(s.bullets !== undefined ? { bullets: s.bullets.map(b => cap(b)) } : {}),
    })) satisfies LocalSlide[],
    truncated: false,
  }
}

function docxPreview(filePath: string, title: string | undefined, blocks: LocalBlock[]): JsonValue {
  return {
    kind: 'docx',
    file_name: basename(filePath),
    ...title !== undefined ? { title: cap(title) } : {},
    blocks: blocks.map(b => ({ type: b.type, text: cap(b.text) })),
    truncated: false,
  }
}

interface Call {
  name: string
  callId: CallId
  args: { file_path: string } & Record<string, unknown>
  preview: JsonValue
}

/** Build one settled turn whose three office calls carry bounded previews. */
function whaleFixture(): string {
  const calls: Call[] = [
    {
      name: 'xlsx_create',
      callId: CallId('office-xlsx'),
      args: { file_path: 'deliverables/sales-q1.xlsx' },
      preview: xlsxPreview('deliverables/sales-q1.xlsx', [
        { name: 'Revenue', header: ['Region', 'Revenue', 'Growth'], rows: [['North', 120000, 1.12], ['South', 98000, 0.97], ['West', 132000, 1.21], ['East', 88000, 0.89]] },
        { name: 'Summary', header: ['Metric', 'Value'], rows: [['Total revenue', 438000], ['Best region', 'West']] },
      ]),
    },
    {
      name: 'pptx_create',
      callId: CallId('office-pptx'),
      args: { file_path: 'deliverables/quarterly-review.pptx' },
      preview: pptxPreview('deliverables/quarterly-review.pptx', 'Q1 Review', [
        { title: 'Revenue highlights', bullets: ['North leads growth at +12%', 'Online channel up 2.1x', 'New markets: 3 regions'] },
        { title: 'Next quarter', subtitle: 'Focus areas', bullets: ['Onboard West retail partners', 'Launch mid-tier plan'] },
      ]),
    },
    {
      name: 'docx_create',
      callId: CallId('office-docx'),
      args: { file_path: 'deliverables/summary-report.docx' },
      preview: docxPreview('deliverables/summary-report.docx', 'Quarterly Summary', [
        { type: 'heading1', text: 'Overview' },
        { type: 'paragraph', text: 'Revenue grew across all regions this quarter. The online channel was the strongest driver of margin.' },
        { type: 'heading2', text: 'Key findings' },
        { type: 'bullet', text: 'North region delivered the fastest growth at 12%.' },
        { type: 'quote', text: 'Consistent pipeline hygiene remains the single largest lever.' },
        { type: 'number', text: 'Review channel attribution models.' },
      ]),
    },
  ]

  const session = Session.create(SessionId('whale-office-artifacts-source'))
  const serialized = calls.map(call => ({ call, json: JSON.stringify(call.args) }))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Build the quarterly pack: a revenue workbook, a review deck, and a summary report.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', { title: 'Whale Office Demo', messageSeqs: [1], source: { kind: 'fallback' } })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: serialized.map(({ call, json }) => ({
        type: 'tool-call' as const,
        id: call.callId,
        name: call.name,
        arguments: json,
      })),
      source: { provider: 'deepseek-official', model: 'deepseek-chat' },
    }),
  }, { surfaceOp: 'append' })
  for (const { call, json } of serialized) {
    const source = session.append('tool/call', {
      turn: 1, step: 1, callId: call.callId, name: call.name, arguments: json,
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: call.callId,
        content: [{ type: 'text', text: `path: ${call.args.file_path}\nsize: 24000` }],
        isError: false,
      }),
      meta: { preview: call.preview, size: 24000 },
    }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  }
  session.append('step/start', { turn: 1, step: 2 })
  session.append('whale/task-board', {
    tasks: [{
      id: 'task-daily-brief',
      name: 'Daily brief',
      status: 'active',
      scheduleKind: 'cron',
      scheduleSummary: 'cron "0 9 * * 1-5" in Asia/Shanghai',
      tz: 'Asia/Shanghai',
      nextRunAt: new Date(Date.now() + 86_400_000).toISOString(),
      lastRunAt: null,
      workspaceCwd: 'workspace',
    }],
  })
  session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      content: [{ type: 'text', text: `Done. The workbook, deck, and report are under \`deliverables/\` in your workspace.\n\n${DONE}` }],
      source: { provider: 'deepseek-official', model: 'deepseek-chat' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 0, cwd: '{{cwd}}',
    }),
    ...session.events.map(({ seq: _seq, time: _time, ...event }) => JSON.stringify(event)),
    '',
  ].join('\n')
}

describe('web e2e: whale office artifact preview cards', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, whaleFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('CONSOLE_ERR:', message.text().slice(0, 300))
    })
    page.on('pageerror', error => console.error('PAGEERROR:', String(error).slice(0, 300)))
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // Phase 2: the shipped roster includes the Whale coworker preset (the
    // composer hero chip stages it for the next blank session).
    const presetChip = page.getByRole('button', { name: 'Standard mode' })
    await presetChip.waitFor({ timeout: 15_000 })
    await presetChip.click()
    await page.getByRole('menuitem', { name: /Coworker mode|同事模式|whale/ }).waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('renders spreadsheet, slide-deck, and document preview cards', async () => {
    onTestFailed(async () => { void saveFailureShot(page, 'web-e2e-whale-office-artifacts'); const text = await page.locator('body').innerText(); console.error('PAGE_TEXT:', text.slice(0, 1500).replaceAll('\n', ' | ')) })
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    // Each office call renders its own artifact card with the shared header
    // (the meta line appends the byte size, so match the prefix).
    await expect.poll(() => page.getByText(/Generated by Whale/).count(), { timeout: 15_000 }).toBe(3)

    // Spreadsheet chrome: sheet tab + styled headers + data.
    expect(await page.getByRole('button', { name: 'Revenue', exact: true }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Summary', exact: true }).count()).toBe(1)
    expect(await page.getByText('Region', { exact: true }).count()).toBeGreaterThan(0)

    // Deck chrome: title slide + content slides with bullets.
    expect(await page.getByText('Revenue highlights', { exact: true }).count()).toBe(1)
    expect(await page.getByText('North leads growth at +12%', { exact: true }).count()).toBe(1)

    // Document chrome: page title + styled blocks.
    expect(await page.getByText('Quarterly Summary', { exact: true }).count()).toBe(1)
    expect(await page.getByText('Overview', { exact: true }).count()).toBe(1)
    expect(await page.getByText('Consistent pipeline hygiene remains the single largest lever.', { exact: true }).count()).toBe(1)

    // Produced-file chips surface the artifact path (deliverables integration).
    expect(await page.getByText('sales-q1.xlsx', { exact: false }).count()).toBeGreaterThan(0)

    // Phase 3: the whale task board renders from the seeded snapshot.
    expect(await page.getByText('Whale tasks', { exact: true }).count()).toBe(1)
    expect(await page.getByText('Daily brief', { exact: true }).count()).toBe(1)

    // Right-side studio: the card's Preview-details button opens the Details
    // panel with the Excel-style xlsx studio (column letters + tab strip).
    await page.locator('[data-whale-details-button]').first().click()
    await page.locator('[data-whale-artifact-details="xlsx"]').waitFor({ timeout: 15_000 })
    expect(await page.getByText('Revenue', { exact: true }).count()).toBeGreaterThan(0)
    expect(await page.getByText('A', { exact: true }).count()).toBeGreaterThan(0)

    // Local screenshot evidence, only when explicitly requested.
    if (process.env.WHALE_SCREENSHOTS === '1') {
      mkdirSync(SCREENSHOTS, { recursive: true })
      await page.locator('[data-whale-artifact-details="xlsx"]').screenshot({
        path: join(SCREENSHOTS, '04-details-xlsx-studio.png'),
      })
      await page.screenshot({ path: join(SCREENSHOTS, '05-details-panel.png') })
      await page.getByText(DONE, { exact: true }).scrollIntoViewIfNeeded()
      await page.evaluate(() => { window.scrollTo(0, 0) })
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(SCREENSHOTS, '01-conversation-artifacts.png'), fullPage: true })
      await page.getByText(/Generated by Whale/).first()
        .locator('xpath=ancestor::div[contains(@class,"card")][1]')
        .screenshot({ path: join(SCREENSHOTS, '02-spreadsheet-card.png') })
    }
  }, 60_000)
})
