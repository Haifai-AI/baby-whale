/**
 * Minimal cron support for Whale task schedules: a five-field expression
 * parser (minute hour day-of-month month day-of-week) and a timezone-aware
 * next-arrival computation. Only the semantics the ship needs are
 * implemented; the grammar accepts `*`, lists, ranges, steps, and named
 * month/day-of-week names are not supported (numbers only).
 * @module @deepseek-ai/dsh-whale-core/src/cron
 */

export interface CronExpr {
  minute: number[]
  hour: number[]
  dom: number[]
  month: number[]
  dow: number[]
}

const FIELD_RANGES = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dom: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dow: { min: 0, max: 7 },
} as const

type FieldName = keyof typeof FIELD_RANGES

/** Parse one field token: wildcard, single value, range, step, or comma list. */
function parseField(name: FieldName, token: string): number[] {
  const { min, max } = FIELD_RANGES[name]
  const values = new Set<number>()
  for (const part of token.split(',')) {
    const stepMatch = /^(.*)\/(\d+)$/.exec(part)
    const step = stepMatch === null ? 1 : Number(stepMatch[2])
    const range = stepMatch === null ? part : (stepMatch[1] ?? '')
    if (!Number.isInteger(step) || step < 1) throw new Error(`cron: invalid step in "${token}"`)
    const expand = (from: number, to: number): void => {
      if (from < min || to > max) throw new Error(`cron: range ${from}-${to} outside ${min}-${max} for ${name}`)
      for (let value = from; value <= to; value += step) values.add(value)
    }
    if (range === '*') expand(min, max)
    else if (range.includes('-')) {
      const [fromRaw, toRaw] = range.split('-')
      if (fromRaw === undefined || toRaw === undefined) throw new Error(`cron: invalid range "${range}"`)
      const from = Number(fromRaw)
      const to = Number(toRaw)
      if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error(`cron: invalid range "${range}"`)
      expand(from, to)
    } else {
      const value = Number(range)
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`cron: value ${range} outside ${min}-${max} for ${name}`)
      }
      values.add(value)
    }
  }
  // Sunday may be written 7; normalize to 0 (the ISO weekday of Date.getUTCDay).
  return [...values].map(value => (name === 'dow' && value === 7 ? 0 : value)).sort((a, b) => a - b)
}

/**
 * Parse a five-field cron expression.
 * @param expr - whitespace-separated minutes hours dom month dow.
 * @returns the normalized expression.
 */
export function parseCron(expr: string): CronExpr {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`cron: expected 5 fields, got ${parts.length}`)
  return {
    minute: parseField('minute', parts[0] ?? ''),
    hour: parseField('hour', parts[1] ?? ''),
    dom: parseField('dom', parts[2] ?? ''),
    month: parseField('month', parts[3] ?? ''),
    dow: parseField('dow', parts[4] ?? ''),
  }
}

/** Validate a cron expression, throwing on malformed input. */
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr)
    return true
  } catch {
    return false
  }
}

/** Local wall-clock parts of a UTC instant in one timezone. */
interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

function localParts(timeZone: string, date: Date): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    weekday: 'short',
  })
  const parts = formatter.formatToParts(date)
  const get = (type: string): number => {
    const part = parts.find(item => item.type === type)
    if (part === undefined) throw new Error(`cron: Intl returned no ${type} part`)
    return Number(part.value)
  }
  const weekday = parts.find(item => item.type === 'weekday')?.value ?? ''
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    weekday: weekdayIndex,
  }
}

/** The UTC instant of one local wall-clock time, converging across DST offsets. */
function zonedTimeToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  const target: LocalParts = { year, month, day, hour, minute, weekday: 0 }
  let guess = naive
  for (let pass = 0; pass < 3; pass += 1) {
    const date = new Date(guess)
    const local = localParts(timeZone, date)
    if (
      local.year === target.year
      && local.month === target.month
      && local.day === target.day
      && local.hour === target.hour
      && local.minute === target.minute
    ) {
      return date
    }
    const localNaive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
    guess = naive + (naive - localNaive)
  }
  // A DST gap or overlap made the wall time nonexistent or ambiguous; the last
  // estimate is the closest representable instant.
  return new Date(guess)
}

/** Validate an IANA timezone, throwing on an unknown zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Compute the next arrival of a cron expression strictly after `from`, in one
 * IANA timezone. Day-stepping wins over minute-stepping: it stays bounded
 * (370 days) and unambiguous across DST transitions.
 * @param expr - normalized cron expression.
 * @param timeZone - IANA zone, e.g. 'Asia/Shanghai'.
 * @param from - exclusive lower bound.
 * @returns the next matching instant, or undefined when no match exists within the horizon.
 */
export function nextRun(expr: CronExpr, timeZone: string, from: Date): Date | undefined {
  if (!isValidTimeZone(timeZone)) throw new Error(`cron: unknown timezone "${timeZone}"`)
  // Start at the local midnight of `from`'s day (UTC instant of that midnight).
  const startParts = localParts(timeZone, from)
  let cursor = zonedTimeToUtc(timeZone, startParts.year, startParts.month, startParts.day, 0, 0)
  for (let day = 0; day < 370; day += 1) {
    const parts = localParts(timeZone, cursor)
    if (
      expr.month.includes(parts.month)
      && expr.dow.includes(parts.weekday)
      && expr.dom.includes(parts.day)
    ) {
      for (const hour of expr.hour) {
        for (const minute of expr.minute) {
          const candidate = zonedTimeToUtc(timeZone, parts.year, parts.month, parts.day, hour, minute)
          if (candidate.getTime() > from.getTime()) return candidate
        }
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  }
  return undefined
}
