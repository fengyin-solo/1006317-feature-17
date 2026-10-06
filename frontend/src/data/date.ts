// 日期与口径工具：看板、列表、概览都走这里，保证条数对得上。

export function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const text = String(value).trim()
  // 只接受 yyyy-mm-dd / yyyy/mm/dd，避免「样例1」这类脏数据被当成日期。
  const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text)
  if (!matched) {
    return null
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function today(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

// 加自然日；保养周期一律按自然日处理（1月=30天）。
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

// 保养周期字段形如「每月 / 3个月 / 半年 / 1年 / 90天」，统一折算成天数。
export function periodDays(text: unknown): number | null {
  const matched = /(\d+(?:\.\d+)?)/.exec(String(text ?? ''))
  const value = matched ? Number(matched[1]) : 1
  const raw = String(text ?? '')
  if (raw.includes('年')) {
    return Math.round(value * 365)
  }
  if (raw.includes('半年')) {
    return Math.round(value * 182)
  }
  if (raw.includes('月')) {
    return Math.round(value * 30)
  }
  if (raw.includes('周')) {
    return Math.round(value * 7)
  }
  // 只有数字时按「天」算。
  return matched ? Math.round(value) : null
}

export function isOverdue(due: unknown, now: Date = today()): boolean {
  const dueDate = parseDate(due)
  return dueDate !== null && dueDate.getTime() < now.getTime()
}

export function sameMonth(date: Date | null, year: number, monthIndex: number): boolean {
  return date !== null && date.getFullYear() === year && date.getMonth() === monthIndex
}
