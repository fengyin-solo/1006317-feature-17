import {
  CARE_LOG_KEY,
  CARE_PLAN_KEY,
  CURRENT_SCHEMA,
  listCareLogs,
  listCarePlans,
  listRows,
  markSchema,
  resetMaintenanceFamily,
  saveCareLogs,
  saveCarePlans,
  saveRows,
  schemaVersion,
} from '@/data/local-store'
import { addDays, formatDate, monthKeyOf, parseDate, periodDays, sameMonth, today } from '@/data/date'
import type { ActionResult, CareLog, CarePlan, EntryRow } from '@/data/types'

// 检修状态机：环节只能一段一段往下推进，列在这里的才放行，其余一律打回。
// 待开工 →（提交开工）→ 检修中 →（确认完工）→ 已完工
//           └（申请延期）→ 已延期；已延期 →（提交开工）→ 检修中
const FLOW: Record<string, Record<string, string>> = {
  待开工: { 提交开工: '检修中', 申请延期: '已延期' },
  检修中: { 确认完工: '已完工' },
  已延期: { 提交开工: '检修中' },
  已完工: {},
}

const STATUS_ORDER = ['待开工', '检修中', '已延期', '已完工']

// 早年纸质工单只登记了完工日期：统一按完工日往前倒推 7 个自然日作为计划工期。
// 理由：检修计划工期一般为一周，倒推到「计划当周」不会把旧账算进本月，且规则对所有旧记录一致、可复核。
const BACKFILL_DAYS = 7

// ---- 存量数据回填（幂等，按 schema 版本只跑一次）--------------------------------

export function ensureMigrated(): void {
  if (schemaVersion() >= CURRENT_SCHEMA) {
    return
  }
  const rows = listRows('maintenance').map((row) => ({ ...row }))
  for (const row of rows) {
    const finished = parseDate(row['完工日期'])
    if (!row['工期来源']) {
      row['工期来源'] = '登记'
    }
    // 已完工但计划工期缺失/不是合法日期：按完工日前 7 个自然日倒推。
    if (row.status === '已完工' && finished && !parseDate(row['计划工期'])) {
      row['计划工期'] = formatDate(addDays(finished, -BACKFILL_DAYS))
      row['工期来源'] = `倒推（完工前${BACKFILL_DAYS}自然日）`
    }
  }
  saveRows('maintenance', rows)

  // 重建设备保养台账：以检修完工记录为准全量重建，天然幂等、不并版。
  const devices = listRows('device')
  const logs: CareLog[] = []
  const plans: CarePlan[] = []
  let logId = 0
  let planId = 0
  const latestOpenPlanByDevice = new Map<string, CarePlan>()
  for (const row of rows.filter((item) => item.status === '已完工')) {
    const finished = parseDate(row['完工日期'])
    if (!finished) {
      continue
    }
    const matched = matchDevice(String(row['检修对象'] ?? ''), devices)
    const { device, created } = ensureDevice(matched, devices, row, finished)
    logs.push({
      id: ++logId,
      设备编号: String(device['设备编号']),
      设备名称: String(device['设备名称']),
      保养日期: formatDate(finished),
      更换部件: String(row['更换部件'] ?? ''),
      处理结论: String(row['处理结论'] ?? ''),
      来源检修编号: String(row['检修编号']),
      检修班组: String(row['检修班组']),
    })
    const days = periodDays(device['保养周期']) ?? 30
    const plan: CarePlan = {
      id: ++planId,
      设备编号: String(device['设备编号']),
      设备名称: String(device['设备名称']),
      计划保养日: formatDate(addDays(finished, days)),
      计划状态: '待保养',
      来源检修编号: String(row['检修编号']),
      登记说明: created ? '随检修完工补登的设备台账' : '随检修完工排入保养计划',
    }
    // 同一设备多条完工记录：只留最新一次完工派生的待保养计划，旧版不并在一起。
    latestOpenPlanByDevice.delete(plan.设备编号)
    latestOpenPlanByDevice.set(plan.设备编号, plan)
  }
  plans.push(...latestOpenPlanByDevice.values())

  // 设备主台账：用最新一条保养记录回写上次保养日；有待保养计划的设备置「待保养」。
  const latestLogByDevice = new Map<string, CareLog>()
  for (const log of logs) {
    const prev = latestLogByDevice.get(log.设备编号)
    if (!prev || log.保养日期 > prev.保养日期) {
      latestLogByDevice.set(log.设备编号, log)
    }
  }
  for (const device of devices) {
    const code = String(device['设备编号'])
    const latest = latestLogByDevice.get(code)
    if (latest) {
      device['上次保养日'] = latest.保养日期
    }
    device.status = latestOpenPlanByDevice.has(code) ? '待保养' : '运行中'
    device.pending = device.status === '待保养'
  }
  saveRows('device', devices)
  saveCareLogs(logs)
  saveCarePlans(plans)
  markSchema(CURRENT_SCHEMA)
}

// 检修对象里允许带设备编号或名称（「DEVI-0001 1号送风机组」「西舱入口防火卷帘门」）。
function matchDevice(target: string, devices: EntryRow[]): EntryRow | null {
  const code = /(DEVI-\d+)/i.exec(target)
  if (code) {
    const byCode = devices.find((d) => String(d['设备编号']).toUpperCase() === code[1].toUpperCase())
    if (byCode) {
      return byCode
    }
  }
  return devices.find((d) => target.includes(String(d['设备名称']))) ?? null
}

// 既有台账照原编号搬过来；早年没登记的项另起一行，编号续号并写明补登说明（覆盖派生物、不覆盖既有主账）。
function ensureDevice(
  matched: EntryRow | null,
  devices: EntryRow[],
  row: EntryRow,
  finished: Date,
): { device: EntryRow; created: boolean } {
  if (matched) {
    return { device: matched, created: false }
  }
  const maxId = devices.reduce((max, d) => Math.max(max, Number(d.id) || 0), 0)
  const seq = maxId + 1
  const name = String(row['检修对象'] ?? '未命名设备').replace(/DEVI-\d+\s*/i, '').trim() || '未命名设备'
  const device: EntryRow = {
    id: seq,
    status: '待保养',
    pending: true,
    abnormal: false,
    设备编号: `DEVI-${String(seq).padStart(4, '0')}`,
    设备名称: name,
    设备型号: '待补登',
    所属舱室: '待补登',
    投运日期: formatDate(finished),
    保养周期: '3个月',
    上次保养日: formatDate(finished),
    登记说明: `早年未登记，随检修单 ${row['检修编号']} 完工补登另起一行`,
  }
  devices.push(device)
  return { device, created: true }
}

// ---- 动作流转（严格分段 + 完工联动，幂等）-----------------------------------------

export function maintenanceAction(id: number, action: string): ActionResult {
  ensureMigrated()
  const rows = listRows('maintenance')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的检修记录` }
  }
  const current = String(rows[index].status)
  const target = FLOW[current]?.[action]
  if (!target) {
    // 写清卡在哪一段、当前能做什么。
    const allowed = Object.keys(FLOW[current] ?? {})
    const hint = allowed.length ? `，当前环节只允许：${allowed.join('、')}` : '，该记录已是终态'
    return { ok: false, message: `环节不能跳过：${rowLabel(rows[index])} 现在停在「${current}」，不能直接${action}${hint}` }
  }

  const updated: EntryRow = { ...rows[index], status: target, abnormal: false }
  const now = today()
  if (action === '提交开工') {
    updated['开工日期'] = updated['开工日期'] || formatDate(now)
    updated.pending = target !== '已完工'
  }
  if (action === '申请延期') {
    // 延期必须有批文；批了还没动的记录靠「已延期 + 未开工」识别。
    if (!String(updated['延期批文'] ?? '').trim()) {
      return { ok: false, message: `卡在「${current}」段：申请延期必须先登记延期批文` }
    }
    updated.pending = true
  }
  let sideEffect: { deviceCode: string; created: boolean } | null = null
  if (action === '确认完工') {
    updated['完工日期'] = updated['完工日期'] || formatDate(now)
    if (!String(updated['处理结论'] ?? '').trim()) {
      return { ok: false, message: `卡在「${current}」段：确认完工必须填写处理结论` }
    }
    updated.pending = false
    // 联动只在状态真正跨入「已完工」时执行一次；重复提交完工 FLOW 已完工→{} 会直接打回。
    sideEffect = syncOnComplete(updated)
  }

  const next = [...rows]
  next[index] = updated
  saveRows('maintenance', next)

  let message = `检修记录已${action}，当前状态「${target}」`
  if (sideEffect) {
    message += sideEffect.created
      ? `；设备台账早年无此项，已另起一行 ${sideEffect.deviceCode} 补登，并写入保养记录、排入待保养`
      : `；保养记录已同步到设备 ${sideEffect.deviceCode}，并新增一条待保养计划`
  }
  return { ok: true, message }
}

export function rowLabel(row: EntryRow): string {
  return String(row['检修编号'] ?? `#${row.id}`)
}

// 页面侧补登延期批文 / 处理结论：写回台账后再走动作，服务端状态机依旧兜底校验。
export function patchMaintenance(id: number, patch: Record<string, string>): ActionResult {
  ensureMigrated()
  const rows = listRows('maintenance')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的检修记录` }
  }
  const next = [...rows]
  next[index] = { ...rows[index], ...patch }
  saveRows('maintenance', next)
  return { ok: true, message: '已保存' }
}

// 完工联动：保养记录按来源检修编号覆盖（同批材料再报只留最新版），保养计划同设备只留最新待保养。
function syncOnComplete(row: EntryRow): { deviceCode: string; created: boolean } {
  const finished = parseDate(row['完工日期']) ?? today()
  const devices = listRows('device')
  const matched = matchDevice(String(row['检修对象'] ?? ''), devices)
  const { device, created } = ensureDevice(matched, devices, row, finished)

  const logs = listCareLogs()
  const sourceNo = String(row['检修编号'])
  const logId = logs.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const nextLog: CareLog = {
    id: logId,
    设备编号: String(device['设备编号']),
    设备名称: String(device['设备名称']),
    保养日期: formatDate(finished),
    更换部件: String(row['更换部件'] ?? ''),
    处理结论: String(row['处理结论'] ?? ''),
    来源检修编号: sourceNo,
    检修班组: String(row['检修班组']),
  }
  // 覆盖式 upsert：同一检修编号再报一遍，只把最新那版留下，不把两版并在一起。
  const logIndex = logs.findIndex((item) => item.来源检修编号 === sourceNo)
  if (logIndex >= 0) {
    nextLog.id = logs[logIndex].id
    logs.splice(logIndex, 1, nextLog)
  } else {
    logs.push(nextLog)
  }
  saveCareLogs(logs)

  const plans = listCarePlans()
  const days = periodDays(device['保养周期']) ?? 30
  const planId = plans.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const nextPlan: CarePlan = {
    id: planId,
    设备编号: String(device['设备编号']),
    设备名称: String(device['设备名称']),
    计划保养日: formatDate(addDays(finished, days)),
    计划状态: '待保养',
    来源检修编号: sourceNo,
    登记说明: created ? '随检修完工补登的设备台账' : '随检修完工排入保养计划',
  }
  // 同设备已有待保养计划：覆盖成最新这版，不并出两条。
  const openIndex = plans.findIndex(
    (item) => item.设备编号 === nextPlan.设备编号 && item.计划状态 === '待保养',
  )
  if (openIndex >= 0) {
    nextPlan.id = plans[openIndex].id
    plans.splice(openIndex, 1, nextPlan)
  } else {
    plans.push(nextPlan)
  }
  saveCarePlans(plans)

  device['上次保养日'] = formatDate(finished)
  device.status = '待保养'
  device.pending = true
  saveRows('device', devices)

  return { deviceCode: String(device['设备编号']), created }
}

// 设备台账「完成保养」：只作用于待保养设备，并把对应待保养计划置为已保养。
export function completeDeviceCare(id: number): ActionResult {
  ensureMigrated()
  const devices = listRows('device')
  const index = devices.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的设备` }
  }
  if (devices[index].status !== '待保养') {
    return {
      ok: false,
      message: `环节不能跳过：设备 ${devices[index]['设备编号']} 当前是「${devices[index].status}」，没有待保养计划可确认`,
    }
  }
  const now = formatDate(today())
  const device: EntryRow = { ...devices[index], status: '已保养', pending: false, 上次保养日: now }
  const nextDevices = [...devices]
  nextDevices[index] = device
  saveRows('device', nextDevices)

  const plans = listCarePlans()
  for (const plan of plans) {
    if (plan.设备编号 === device['设备编号'] && plan.计划状态 === '待保养') {
      plan.计划状态 = '已保养'
      plan.保养日期 = now
    }
  }
  saveCarePlans(plans)
  return { ok: true, message: `设备 ${device['设备编号']} 已完成保养，保养计划同步核销` }
}

// ---- 进度视图口径（看板与明细共用，保证条数一致）-----------------------------------

export type BoardScope = {
  year: number
  monthIndex: number // 0-11
  includeOverdueOpen: boolean
}

export function currentScope(): BoardScope {
  const now = today()
  return { year: now.getFullYear(), monthIndex: now.getMonth(), includeOverdueOpen: true }
}

// 当月进度口径（看板与明细共用同一份筛选，条数天然一致）：
// 1) 计划工期落在选定月份的未完工记录（该开工 / 检修中 / 批了延期还没动都在列）；
// 2) 更早到期、到选定月仍未完工的逾期记录（拖过计划工期就要在后续月份持续挂账）；
// 3) 选定月份内完工的记录（本月完工同样进本月进度）。
export function inScope(row: EntryRow, scope: BoardScope, now: Date = today()): boolean {
  const due = parseDate(row['计划工期'])
  const finished = parseDate(row['完工日期'])
  const monthStart = new Date(scope.year, scope.monthIndex, 1)
  if (row.status !== '已完工') {
    if (sameMonth(due, scope.year, scope.monthIndex)) {
      return true
    }
    // 逾期挂账：计划工期早于所选月、且到今天还没完工。
    if (scope.includeOverdueOpen && due && due.getTime() < monthStart.getTime() && due.getTime() < now.getTime()) {
      return true
    }
    return false
  }
  return sameMonth(finished, scope.year, scope.monthIndex)
}

export type BoardCard = EntryRow & { overdue: boolean; delayedNotStarted: boolean }

export function boardRows(scope: BoardScope): BoardCard[] {
  ensureMigrated()
  const now = today()
  return listRows('maintenance')
    .filter((row) => inScope(row, scope, now))
    .map((row) => ({
      ...row,
      overdue: row.status !== '已完工' && !!parseDate(row['计划工期']) && parseDate(row['计划工期'])!.getTime() < now.getTime(),
      delayedNotStarted: row.status === '已延期' && !parseDate(row['开工日期']),
    }))
    .sort((a: BoardCard, b: BoardCard) => teamOrder(a['检修班组']) - teamOrder(b['检修班组'])
      || String(a['计划工期']).localeCompare(String(b['计划工期'])))
}

export type BoardColumn = {
  status: string
  cards: BoardCard[]
  groups: { team: string; cards: BoardCard[] }[]
}

// 班组排序按名字里的「一/二/三…」序号，不依赖运行环境的中文分词表。
const TEAM_ORDER: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
function teamOrder(team: unknown): number {
  const key = String(team ?? '')
  const hit = /([一二三四五六七八九十])班/.exec(key)
  return hit ? TEAM_ORDER[hit[1]] ?? 99 : 99
}

export function boardColumns(scope: BoardScope): BoardColumn[] {
  const cards = boardRows(scope)
  return STATUS_ORDER.map((status) => {
    const inColumn = cards.filter((card) => card.status === status)
    const teams = [...new Set(inColumn.map((card) => String(card['检修班组'] || '未分班')))]
    const groups = teams.map((team) => ({
      team,
      cards: inColumn.filter((card) => String(card['检修班组'] || '未分班') === team),
    }))
    return { status, cards: inColumn, groups }
  })
}

export type MaintenanceStats = {
  待开工: number
  检修中: number
  已逾期: number
  已延期未动: number
  本月到期: number
  本月完工: number
  看板合计: number
}

export function maintenanceStats(scope: BoardScope): MaintenanceStats {
  const cards = boardRows(scope)
  return {
    待开工: cards.filter((c) => c.status === '待开工').length,
    检修中: cards.filter((c) => c.status === '检修中').length,
    已逾期: cards.filter((c) => c.overdue).length,
    已延期未动: cards.filter((c) => c.delayedNotStarted).length,
    本月到期: cards.filter((c) => c.status !== '已完工').length,
    本月完工: cards.filter((c) => c.status === '已完工').length,
    看板合计: cards.length,
  }
}

export function scopeLabel(scope: BoardScope): string {
  return `${scope.year}年${scope.monthIndex + 1}月（${monthKeyOf(new Date(scope.year, scope.monthIndex, 1))}）`
}

export function resetMaintenanceData(): void {
  resetMaintenanceFamily()
  ensureMigrated()
}

// 供普通模块动作以外的页面读取保养台账。
export { CARE_LOG_KEY, CARE_PLAN_KEY }
