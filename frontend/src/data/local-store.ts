import { SEED_ROWS } from './seed'
import type { CareLog, CarePlan, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'

// 检修完工联动出的设备保养记录 / 保养计划，单独存放，不混进模块总表的计数口径。
export const CARE_LOG_KEY = 'care-logs'
export const CARE_PLAN_KEY = 'care-plans'
const SCHEMA_KEY = 'schema-version'
export const CURRENT_SCHEMA = 2

export type StoredShape = {
  [key: string]: unknown
  [CARE_LOG_KEY]?: CareLog[]
  [CARE_PLAN_KEY]?: CarePlan[]
  [SCHEMA_KEY]?: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): StoredShape {
  const fallback: StoredShape = { ...clone(SEED_ROWS), [CARE_LOG_KEY]: [], [CARE_PLAN_KEY]: [] }
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as StoredShape
    // 以种子模块为底，再叠加本机改动；新模块与保养台账缺了就补空集。
    return {
      ...fallback,
      ...parsed,
      [CARE_LOG_KEY]: parsed[CARE_LOG_KEY] ?? [],
      [CARE_PLAN_KEY]: parsed[CARE_PLAN_KEY] ?? [],
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: StoredShape | null = null

export function allRows(): StoredShape {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return (allRows()[key] as EntryRow[] | undefined) ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist(next)
}

export function schemaVersion(): number {
  return Number(allRows()[SCHEMA_KEY] ?? 0)
}

export function markSchema(version: number = CURRENT_SCHEMA): void {
  const next = { ...allRows(), [SCHEMA_KEY]: version }
  cache = next
  persist(next)
}

export function listCareLogs(): CareLog[] {
  return allRows()[CARE_LOG_KEY] ?? []
}

export function saveCareLogs(rows: CareLog[]): void {
  const next = { ...allRows(), [CARE_LOG_KEY]: rows }
  cache = next
  persist(next)
}

export function listCarePlans(): CarePlan[] {
  return allRows()[CARE_PLAN_KEY] ?? []
}

export function saveCarePlans(rows: CarePlan[]): void {
  const next = { ...allRows(), [CARE_PLAN_KEY]: rows }
  cache = next
  persist(next)
}

function persist(data: StoredShape): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 检修 / 设备台账 / 由它们派生出的保养台账是一套账：重置任何一边都整套回到示例。
export function resetMaintenanceFamily(): void {
  const next: StoredShape = {
    ...allRows(),
    maintenance: clone(SEED_ROWS.maintenance ?? []),
    device: clone(SEED_ROWS.device ?? []),
    [CARE_LOG_KEY]: [],
    [CARE_PLAN_KEY]: [],
    [SCHEMA_KEY]: 0,
  }
  cache = next
  persist(next)
}

export function storageKey(): string {
  return STORAGE_KEY
}
