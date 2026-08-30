/**
 * Whale play-demo seeder (dev tool, not a test): materializes a demo home with
 * one settled session whose log holds real xlsx_create/pptx_create/docx_create
 * calls (with preview metadata + a task-board snapshot), and writes the actual
 * artifact files into the demo workspace. Run from the repo root:
 *   pnpm exec tsx apps/web/tests/whale-play-seed.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { buildDocxBytes } from '../../../packages/office/tool-office/src/docx.ts'
import { buildPptxBytes } from '../../../packages/office/tool-office/src/pptx.ts'
import { buildXlsxBytes } from '../../../packages/office/tool-office/src/xlsx.ts'
import { buildDocxPreview, buildPptxPreview, buildXlsxPreview } from '../../../packages/office/tool-office/src/preview.ts'
import type {} from '@deepseek-ai/dsh-whale-core/src/types.ts'

const ROOT = resolve(import.meta.dirname, '../../../..')
const HOME = join(ROOT, '.dsh-whale-play-home')
const WORKSPACE = join(ROOT, 'whale-play-workspace')
const SESSION_ID = SessionId('whale-play-demo')

const SHEETS = [
  {
    name: 'Revenue',
    header: ['Region', 'Revenue', 'Growth', 'Markup'],
    rows: [
      ['North', 120000, 1.12, 0.42],
      ['South', 98000, 0.97, 0.38],
      ['West', 132000, 1.21, 0.45],
      ['East', 88000, 0.89, 0.35],
      ['Online', 210000, 1.65, 0.52],
      ['Nordics', 45000, 1.02, 0.41],
    ],
  },
  { name: 'Summary', header: ['Metric', 'Value'], rows: [['Total revenue', 693000], ['Best region', 'Online'], ['Avg growth', 1.14]] },
]
const SLIDES = [
  { title: 'Revenue highlights', bullets: ['Online leads growth at +65%', 'North strongest region at 120k', 'Markup stable across regions'] },
  { title: 'Next quarter', subtitle: 'Focus areas', bullets: ['Onboard West retail partners', 'Launch mid-tier plan', 'Hire 2 account managers'] },
  { title: 'Risks', bullets: ['Currency headwinds in Nordics', 'Channel concentration'] },
]
const BLOCKS = [
  { type: 'heading1' as const, text: 'Overview' },
  { type: 'paragraph', text: 'Revenue grew across all regions this quarter. The online channel was the strongest driver of margin, and markup held steady.' },
  { type: 'heading2', text: 'Key findings' },
  { type: 'bullet', text: 'North delivered the fastest baseline growth.' },
  { type: 'bullet', text: 'Online contributed 30% of total revenue.' },
  { type: 'quote', text: 'Consistent pipeline hygiene remains the single largest lever.' },
  { type: 'number', text: 'Review channel attribution models.' },
  { type: 'number', text: 'Re-baseline quotas next week.' },
]

async function main(): Promise<void> {
  rmSync(HOME, { recursive: true, force: true })
  rmSync(WORKSPACE, { recursive: true, force: true })
  mkdirSync(join(HOME, 'sessions'), { recursive: true })
  mkdirSync(join(WORKSPACE, 'deliverables'), { recursive: true })
  writeFileSync(join(HOME, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: "2026-08-13.1"\n')

  const xlsxBytes = await buildXlsxBytes({ file_path: 'deliverables/sales-q1.xlsx', sheets: SHEETS })
  const pptxBytes = await buildPptxBytes({ file_path: 'deliverables/quarterly-review.pptx', title: 'Q1 Review', subtitle: 'Regional performance and outlook', slides: SLIDES })
  const docxBytes = await buildDocxBytes({ file_path: 'deliverables/summary-report.docx', title: 'Quarterly Summary', blocks: BLOCKS })
  writeFileSync(join(WORKSPACE, 'deliverables/sales-q1.xlsx'), xlsxBytes)
  writeFileSync(join(WORKSPACE, 'deliverables/quarterly-review.pptx'), pptxBytes)
  writeFileSync(join(WORKSPACE, 'deliverables/summary-report.docx'), docxBytes)

  const calls = [
    { name: 'xlsx_create', callId: CallId('play-xlsx'), preview: buildXlsxPreview('deliverables/sales-q1.xlsx', SHEETS), path: 'deliverables/sales-q1.xlsx', size: xlsxBytes.byteLength },
    { name: 'pptx_create', callId: CallId('play-pptx'), preview: buildPptxPreview('deliverables/quarterly-review.pptx', 'Q1 Review', SLIDES), path: 'deliverables/quarterly-review.pptx', size: pptxBytes.byteLength },
    { name: 'docx_create', callId: CallId('play-docx'), preview: buildDocxPreview('deliverables/summary-report.docx', 'Quarterly Summary', BLOCKS), path: 'deliverables/summary-report.docx', size: docxBytes.byteLength },
  ]

  const session = Session.create(SESSION_ID)
  const t0 = Date.now() - 60_000
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Build the quarterly pack: a revenue workbook, a review deck, and a summary report.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', { title: 'Whale Demo — Quarterly Pack', messageSeqs: [1], source: { kind: 'fallback' } })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1, step: 1,
    message: createAssistantMessage({
      content: calls.map(call => ({ type: 'tool-call' as const, id: call.callId, name: call.name, arguments: JSON.stringify({ file_path: call.path }) })),
      source: { provider: 'deepseek-official', model: 'deepseek-chat' },
    }),
  }, { surfaceOp: 'append' })
  for (const call of calls) {
    const source = session.append('tool/call', { turn: 1, step: 1, callId: call.callId, name: call.name, arguments: JSON.stringify({ file_path: call.path }) })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId: call.callId, content: [{ type: 'text', text: `path: ${call.path}\nsize: ${call.size}` }], isError: false }),
      meta: { preview: call.preview, size: call.size },
    }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  }
  session.append('step/start', { turn: 1, step: 2 })
  session.append('whale/task-board', {
    tasks: [{
      id: 'task-daily-brief', name: 'Daily brief', status: 'active', scheduleKind: 'cron',
      scheduleSummary: 'cron "0 9 * * 1-5" in Asia/Shanghai', tz: 'Asia/Shanghai',
      nextRunAt: new Date(Date.now() + 86_400_000).toISOString(), lastRunAt: null, workspaceCwd: WORKSPACE,
    }],
  })
  session.append('assistant/message', {
    turn: 1, step: 2,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'Done. The workbook, deck, and report are under `deliverables/` in your workspace.' }],
      source: { provider: 'deepseek-official', model: 'deepseek-chat' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  const seeder = new Context()
  try {
    await seeder.plugin(SessionStore)
    await seeder.plugin(JsonlSessionPersistence, { root: join(HOME, 'sessions') })
    await seeder.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id: SESSION_ID,
      createdAt: t0,
      cwd: WORKSPACE,
      delegationDepth: 0,
    })
    await seeder.sessionPersistence.append(SESSION_ID, session.events.map((event, index) => ({ ...event, time: t0 + index * 1000 })))
  } finally {
    await seeder.fiber.dispose()
  }
  console.log('SEED_OK home=' + HOME + ' workspace=' + WORKSPACE)
}

void main().catch((error) => { console.error('SEED_FAILED', error); process.exitCode = 1 })
