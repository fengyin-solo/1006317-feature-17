import type { EntryRow } from './types'

// 设施检修的纯业务模型：状态机、工期倒推、月份口径都收敛在这里，
// 看板、明细列表、详情面板、数据迁移共用同一份规则，取值自然一致。

export const MAINTENANCE_KEY = 'maintenance'
export const DEVICE_KEY = 'device'
export const CARE_LEDGER_KEY = 'careledger'
export const CARE_LOG_KEY = 'device-care-log'
export const CARE_PLAN_KEY = 'device-care-plan'

export const MAINT_STATUSES = ['待开工', '检修中', '已延期', '已完工'] as const
export type MaintStatus = (typeof MAINT_STATUSES)[number]

// 一段一段往下走：每个状态只开放明确登记过的动作，跨段动作一律打回。
export const TRANSITIONS: Record<MaintStatus, { action: string; next: MaintStatus }[]> = {
  待开工: [
    { action: '提交开工', next: '检修中' },
    { action: '申请延期', next: '已延期' },
  ],
  检修中: [
    { action: '确认完工', next: '已完工' },
    { action: '申请延期', next: '已延期' },
  ],
  已延期: [{ action: '延期开工', next: '检修中' }],
  已完工: [],
}

export function allowedActions(status: string): string[] {
  return (TRANSITIONS[status as MaintStatus] ?? []).map((item) => item.action)
}

export function nextStatusOf(status: string, action: string): MaintStatus | null {
  const hit = (TRANSITIONS[status as MaintStatus] ?? []).find((item) => item.action === action)
  return hit ? hit.next : null
}

// 各类检修的标准工期（自然日）。早年只有完工日期的记录按这个倒推计划工期。
export const CATEGORY_DURATION: Record<string, number> = {
  日常检修: 7,
  专项检修: 14,
  应急检修: 3,
}
export const DEFAULT_DURATION = 7

export function standardDays(category: unknown): number {
  return CATEGORY_DURATION[String(category ?? '')] ?? DEFAULT_DURATION
}

export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

export function toDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function shiftDays(base: Date, delta: number): Date {
  const date = new Date(base.getTime())
  date.setDate(date.getDate() + delta)
  return date
}

// 存量回填裁决：有完工日期没有计划工期的，计划结束取完工日，
// 计划开始按检修类别标准工期倒推，并在回填说明里写清来路。
export function backfillPlanRange(
  row: Record<string, unknown>,
): { 计划开始: string; 计划结束: string; 回填说明: string } | null {
  const finishedAt = parseDate(row.完工日期)
  if (!finishedAt) {
    return null
  }
  const category = String(row.检修类别 ?? '日常检修')
  const days = standardDays(category)
  return {
    计划开始: toDateString(shiftDays(finishedAt, -(days - 1))),
    计划结束: toDateString(finishedAt),
    回填说明: `按完工日期倒推（${category}标准工期${days}天），早年台账未登记计划工期`,
  }
}

export function hasValidPlanRange(row: Partial<EntryRow>): boolean {
  return parseDate(row.计划开始) !== null && parseDate(row.计划结束) !== null
}

// 月份口径（看板与明细列表共用，保证条数对得上）：
//  - 未完工：计划到期日 <= 所选月月底 都算（当月到期 + 以往拖期未完工滚入，下月以后的不算）
//  - 已完工：完工日期或计划到期日落入所选月
export function monthBounds(month: string): { start: Date; end: Date } {
  const [year, m] = month.split('-').map(Number)
  return { start: new Date(year, m - 1, 1), end: new Date(year, m, 0) }
}

export function isInMonthScope(row: EntryRow, month: string): boolean {
  const { start, end } = monthBounds(month)
  const within = (value: unknown) => {
    const date = parseDate(value)
    return !!date && date >= start && date <= end
  }
  if (String(row.status) === '已完工') {
    return within(row.完工日期) || within(row.计划结束)
  }
  const planEnd = parseDate(row.计划结束)
  return !!planEnd && planEnd <= end
}

export function isOverdue(row: EntryRow, today = new Date()): boolean {
  if (String(row.status) === '已完工') {
    return false
  }
  const planEnd = parseDate(row.计划结束)
  return !!planEnd && planEnd < stripTime(today)
}

export function stripTime(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

// 看板卡片上的角标：拖过计划工期 / 延期批复后还没动工。
export function rowTags(row: EntryRow, today = new Date()): string[] {
  const tags: string[] = []
  if (isOverdue(row, today)) {
    tags.push('超期')
  }
  if (String(row.status) === '已延期') {
    tags.push('延期已批未动工')
  }
  return tags
}

export function currentMonth(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

// 设备台账里的保养周期写作「90天 / 6个月 / 1年」，统一折算成天数。
export function cycleDays(period: unknown): number {
  const text = String(period ?? '')
  const value = Number(text.match(/\d+/)?.[0] ?? '')
  if (!Number.isFinite(value) || value <= 0) {
    return 90
  }
  if (text.includes('年')) {
    return value * 365
  }
  if (text.includes('月')) {
    return value * 30
  }
  return value
}
