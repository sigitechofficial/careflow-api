export type TimeSensitiveKind = 'MEDICINE' | 'TASK'

export type TimeSensitiveStatus = 'due' | 'early' | 'delayed' | 'missed'

export type TimeSensitiveItem = {
  kind: TimeSensitiveKind
  name: string
  dueTime: string | null
  givenTime: string | null
  toleranceMinutes: number
  status: TimeSensitiveStatus
}

export type TimeSensitiveChip = {
  kind: TimeSensitiveKind
  status: Exclude<TimeSensitiveStatus, 'due'>
  label: string
}

export type TimeSensitiveVisitFlag = {
  hasAny: boolean
  clock: TimeSensitiveStatus
  items: TimeSensitiveItem[]
  chips: TimeSensitiveChip[]
}

export const EMPTY_TIME_SENSITIVE_FLAG: TimeSensitiveVisitFlag = {
  hasAny: false,
  clock: 'due',
  items: [],
  chips: [],
}

const VISIT_ENDED = new Set([
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'MISSED',
  'CANCELLED',
  'CALLED_OFF',
])

const VISIT_STARTED = new Set([
  'STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'MISSED',
])

export function isEndedVisitStatus(status: string | null | undefined): boolean {
  return VISIT_ENDED.has(String(status ?? '').toUpperCase())
}

export function isStartedVisitStatus(status: string | null | undefined): boolean {
  return VISIT_STARTED.has(String(status ?? '').toUpperCase())
}

export function classifyTimeSensitiveTiming(input: {
  due: Date
  given: Date | null
  toleranceMinutes: number
  now: Date
  visitEnded: boolean
  /** Clock-in / in-progress / finished. Planned visits stay `due` until then. */
  visitStarted?: boolean
}): TimeSensitiveStatus {
  const tolMs = Math.max(0, input.toleranceMinutes) * 60_000
  if (input.given && Number.isFinite(input.given.getTime())) {
    const delta = input.given.getTime() - input.due.getTime()
    if (delta < -tolMs) return 'early'
    if (delta > tolMs) return 'delayed'
    return 'due'
  }
  if (input.visitEnded) return 'missed'
  if (input.visitStarted === false) return 'due'
  if (input.now.getTime() > input.due.getTime() + tolMs) return 'delayed'
  return 'due'
}

export function worstTimeSensitiveStatus(statuses: TimeSensitiveStatus[]): TimeSensitiveStatus {
  if (statuses.includes('missed')) return 'missed'
  if (statuses.includes('delayed')) return 'delayed'
  if (statuses.includes('early')) return 'early'
  return 'due'
}

export function timeSensitiveChipLabel(
  kind: TimeSensitiveKind,
  status: Exclude<TimeSensitiveStatus, 'due'>,
): string {
  const noun = kind === 'MEDICINE' ? 'Medicine' : 'Task'
  if (status === 'early') return `${noun} early`
  if (status === 'delayed') return `${noun} delayed`
  return `${noun} missed`
}

export function timeSensitiveHoverLine(item: TimeSensitiveItem): string {
  const noun = item.kind === 'MEDICINE' ? 'medicine' : 'task'
  const verb =
    item.status === 'early'
      ? 'early'
      : item.status === 'delayed'
        ? 'delayed'
        : item.status === 'missed'
          ? 'missed'
          : 'due'
  const parts = [`Time-sensitive ${noun} ${verb}`]
  if (item.name.trim()) parts.push(item.name.trim())
  if (item.dueTime) parts.push(`due ${item.dueTime}`)
  if (item.givenTime) parts.push(`given ${item.givenTime}`)
  return parts.join(' · ')
}

export function timeSensitiveHoverTitle(flag: TimeSensitiveVisitFlag): string {
  if (!flag.hasAny) return ''
  const notable = flag.items.filter((item) => item.status !== 'due')
  const list = notable.length > 0 ? notable : flag.items
  if (!list.length) return 'Time-sensitive visit'
  return list.map(timeSensitiveHoverLine).join(' · ')
}

export function buildTimeSensitiveFlag(items: TimeSensitiveItem[]): TimeSensitiveVisitFlag {
  if (items.length === 0) return EMPTY_TIME_SENSITIVE_FLAG
  const chips: TimeSensitiveChip[] = []
  for (const item of items) {
    if (item.status === 'due') continue
    if (chips.some((chip) => chip.kind === item.kind && chip.status === item.status)) continue
    chips.push({
      kind: item.kind,
      status: item.status,
      label: timeSensitiveChipLabel(item.kind, item.status),
    })
  }
  return {
    hasAny: true,
    clock: worstTimeSensitiveStatus(items.map((item) => item.status)),
    items,
    chips,
  }
}

export function packAdminRulesTimeCritical(adminRules: unknown): boolean {
  return Boolean(
    adminRules &&
      typeof adminRules === 'object' &&
      !Array.isArray(adminRules) &&
      (adminRules as { timeCritical?: unknown }).timeCritical,
  )
}

export function packAdminRulesToleranceMinutes(adminRules: unknown): number | null {
  if (!adminRules || typeof adminRules !== 'object' || Array.isArray(adminRules)) return null
  const raw = (adminRules as { timeToleranceMinutes?: unknown }).timeToleranceMinutes
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(240, Math.floor(n))
}

export function medicineIsTimeSensitive(input: {
  timeCritical?: boolean | null
  adminRules?: unknown
}): boolean {
  return Boolean(input.timeCritical) || packAdminRulesTimeCritical(input.adminRules)
}

export function medicineToleranceMinutes(input: {
  timeCritical?: boolean | null
  timeToleranceMinutes?: number | null
  adminRules?: unknown
}): number {
  if (input.timeCritical && typeof input.timeToleranceMinutes === 'number') {
    return Math.max(0, Math.min(240, Math.floor(input.timeToleranceMinutes)))
  }
  return packAdminRulesToleranceMinutes(input.adminRules) ?? 30
}
