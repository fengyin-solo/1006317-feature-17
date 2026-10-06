import { SEED_ROWS } from './seed'
import {
  backfillPlanRange,
  CARE_LEDGER_KEY,
  CARE_LOG_KEY,
  CARE_PLAN_KEY,
  DEVICE_KEY,
  hasValidPlanRange,
  MAINTENANCE_KEY,
} from './maintenance-model'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'
const VERSION_KEY = 'urban-utility-tunnel:version'
const CURRENT_VERSION = 2

// 版本升级后需要整表换新种子的模块：v1 里检修/设备是「样例N」占位行，
// 没有真实班组、工期，无法进入新看板，按新版种子重建。
const RESEEDED_KEYS = [
  MAINTENANCE_KEY,
  DEVICE_KEY,
  CARE_LEDGER_KEY,
  CARE_LOG_KEY,
  CARE_PLAN_KEY,
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 存量回填：早年只有完工日期、没有计划工期的检修记录，
// 按检修类别标准工期倒推（见 maintenance-model.backfillPlanRange）。
function backfillMaintenance(rows: EntryRow[]): EntryRow[] {
  return rows.map((row) => {
    if (hasValidPlanRange(row)) {
      return row
    }
    const range = backfillPlanRange(row)
    if (!range) {
      return row
    }
    return {
      ...row,
      计划开始: range.计划开始,
      计划结束: range.计划结束,
      计划工期: `${range.计划开始} ~ ${range.计划结束}`,
      回填说明: range.回填说明,
    }
  })
}

function migrate(stored: Record<string, EntryRow[]>, version: number): Record<string, EntryRow[]> {
  const fresh = clone(SEED_ROWS)
  if (version < 2) {
    // v1 占位数据整表替换；维保台账/保养记录/保养计划是 v2 新增，直接播种。
    for (const key of RESEEDED_KEYS) {
      stored[key] = fresh[key] ?? []
    }
  }
  // 无论从哪个版本来，凡是缺计划工期的存量记录都统一倒推一遍。
  stored[MAINTENANCE_KEY] = backfillMaintenance(stored[MAINTENANCE_KEY] ?? fresh[MAINTENANCE_KEY])
  return { ...fresh, ...stored }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const version = Number(window.localStorage.getItem(VERSION_KEY) ?? '1')
    const next = Number.isFinite(version) && version < CURRENT_VERSION ? migrate(parsed, version) : { ...fallback, ...parsed }
    writeAll(next)
    window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
    return next
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
    return fallback
  }
}

function writeAll(rows: Record<string, EntryRow[]>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    writeAll(next)
  }
}

// 一次动作可能同时改写检修记录、设备台账、维保台账等多张表。
export function saveMany(patch: Record<string, EntryRow[]>): void {
  const next = { ...allRows(), ...patch }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    writeAll(next)
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
