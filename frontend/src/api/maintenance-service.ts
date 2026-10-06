import { listRows, saveMany } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import {
  CARE_LEDGER_KEY,
  CARE_LOG_KEY,
  CARE_PLAN_KEY,
  DEVICE_KEY,
  MAINTENANCE_KEY,
  MAINT_STATUSES,
  allowedActions,
  cycleDays,
  isInMonthScope,
  isOverdue,
  nextStatusOf,
  parseDate,
  rowTags,
  toDateString,
} from '@/data/maintenance-model'

// 设施检修的写操作与进度看板统计。看板/明细/详情面板都从同一份
// monthRows 取数，条数天然对得上；跨模块联动统一在这里落库。

export type MaintActionPayload = {
  更换部件?: string
  材料批次号?: string
  处理结论?: string
}

export type MaintenanceBoard = {
  month: string
  rows: EntryRow[]
  total: number
  crews: string[]
  cells: Record<string, Record<string, EntryRow[]>>
  statusTotals: Record<string, number>
  stats: { label: string; value: number }[]
}

function keywordMatch(row: EntryRow, keyword: string): boolean {
  if (!keyword.trim()) {
    return true
  }
  const word = keyword.trim()
  return ['检修编号', '检修对象', '检修班组', '关联设备', '检修类别'].some((field) =>
    String(row[field] ?? '').includes(word),
  )
}

// 看板与明细列表共用的唯一切片口径。
export function maintenanceRows(month: string, keyword = ''): EntryRow[] {
  return listRows(MAINTENANCE_KEY)
    .filter((row) => isInMonthScope(row, month))
    .filter((row) => keywordMatch(row, keyword))
}

export function buildBoard(month: string, keyword = ''): MaintenanceBoard {
  const rows = maintenanceRows(month, keyword)
  const crews = [...new Set(listRows(MAINTENANCE_KEY).map((row) => String(row.检修班组 ?? '未分班组')))]
    .filter((crew) => rows.some((row) => String(row.检修班组 ?? '未分班组') === crew))
    .sort()
  const cells: Record<string, Record<string, EntryRow[]>> = {}
  const statusTotals: Record<string, number> = {}
  for (const status of MAINT_STATUSES) {
    statusTotals[status] = 0
  }
  for (const crew of crews) {
    cells[crew] = {}
    for (const status of MAINT_STATUSES) {
      cells[crew][status] = rows.filter(
        (row) => String(row.检修班组 ?? '未分班组') === crew && String(row.status) === status,
      )
      statusTotals[status] += cells[crew][status].length
    }
  }
  const today = new Date()
  const overdueCount = rows.filter((row) => isOverdue(row, today)).length
  const delayedIdle = rows.filter((row) => String(row.status) === '已延期').length
  const stats = [
    { label: `${month} 到期/在办`, value: rows.length },
    { label: '待开工', value: statusTotals['待开工'] ?? 0 },
    { label: '检修中', value: statusTotals['检修中'] ?? 0 },
    { label: '已延期（批而未动）', value: delayedIdle },
    { label: '已完工', value: statusTotals['已完工'] ?? 0 },
    { label: '拖过计划工期', value: overdueCount },
  ]
  return { month, rows, total: rows.length, crews, cells, statusTotals, stats }
}

export function getMaintenance(id: number): EntryRow | undefined {
  return listRows(MAINTENANCE_KEY).find((row) => Number(row.id) === id)
}

export function maintenanceTags(row: EntryRow): string[] {
  return rowTags(row)
}

export function maintenanceAllowedActions(row: EntryRow): string[] {
  const actions = allowedActions(String(row.status))
  if (String(row.status) === '已完工') {
    actions.push('材料补报')
  }
  return actions
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 以「来源检修编号」为唯一键写入：已有就整行覆盖（只留最新一版），没有才新增。
// 早年漏登记的事项没有来源键，在种子里以 WBLR- 补录编号另起一行，不在这里处理。
function upsertBySource(
  rows: EntryRow[],
  make: (id: number) => EntryRow,
): { rows: EntryRow[]; inserted: boolean } {
  const sourceValue = String(make(0)['来源检修编号'])
  const index = rows.findIndex((row) => String(row['来源检修编号'] ?? '') === sourceValue)
  if (index >= 0) {
    const next = [...rows]
    next[index] = { ...make(Number(next[index].id)) }
    return { rows: next, inserted: false }
  }
  return { rows: [...rows, make(nextId(rows))], inserted: true }
}

function concludeMaintenance(row: EntryRow): string {
  const part = String(row.更换部件 ?? '')
  const given = String(row.处理结论 ?? '').trim()
  if (given) {
    return given
  }
  return part ? `更换${part}，检修完工` : '检修完工，未更换部件'
}

// 完工/材料补报后的跨台账同步。返回提示语，便于页面说明是否找到设备台账。
function syncAfterFinish(maint: EntryRow[]): string[] {
  const notes: string[] = []
  const ledgerRows = [...listRows(CARE_LEDGER_KEY)]
  const logRows = [...listRows(CARE_LOG_KEY)]
  const planRows = [...listRows(CARE_PLAN_KEY)]
  const deviceRows = [...listRows(DEVICE_KEY)]
  let ledgerInserted = 0
  let planInserted = 0
  let logInserted = 0
  let deviceTouched = 0

  for (const row of maint) {
    const source = String(row.检修编号)
    const part = String(row.更换部件 ?? '').trim()
    const conclusion = concludeMaintenance(row)

    // 1) 处理结论落到维保台账：同一检修编号覆盖，两版不会并排存在。
    const ledger = upsertBySource(ledgerRows, (id) => ({
      id,
      status: '已归档',
      pending: false,
      abnormal: false,
      台账编号: source,
      来源检修编号: source,
      检修对象: row.检修对象,
      检修班组: row.检修班组,
      检修类别: row.检修类别,
      完工日期: row.完工日期,
      更换部件: part,
      材料批次号: row.材料批次号 ?? '',
      处理结论: conclusion,
      登记方式: '检修完工同步',
      备注: '',
    }))
    ledgerRows.splice(0, ledgerRows.length, ...ledger.rows)
    if (ledger.inserted) {
      ledgerInserted += 1
    }

    const deviceNo = String(row.关联设备 ?? '').trim()
    const device = deviceRows.find((item) => String(item.设备编号) === deviceNo)
    if (!device) {
      notes.push(`「${source}」未关联设备台账，仅登记维保台账，未生成保养计划`)
      continue
    }

    // 2) 更换部件同步到设备台账的保养记录；没换件就不留保养记录。
    const logIndex = logRows.findIndex((item) => String(item['来源检修编号']) === source)
    if (part) {
      const base: EntryRow = {
        id: 0,
        status: '已保养',
        pending: false,
        abnormal: false,
        保养记录编号: '',
        设备编号: deviceNo,
        设备名称: device.设备名称 ?? '',
        来源检修编号: source,
        保养日期: row.完工日期,
        保养内容: `检修更换：${part}`,
        更换部件: part,
        材料批次号: row.材料批次号 ?? '',
        检修班组: row.检修班组,
      }
      if (logIndex >= 0) {
        logRows[logIndex] = { ...base, id: logRows[logIndex].id, 保养记录编号: logRows[logIndex]['保养记录编号'] }
      } else {
        const newId = nextId(logRows)
        logRows.push({
          ...base,
          id: newId,
          保养记录编号: `BYJL-${String(newId).padStart(4, '0')}`,
        })
        logInserted += 1
      }
    } else if (logIndex >= 0) {
      logRows.splice(logIndex, 1)
    }

    // 3) 给设备台账的保养计划添一条「待保养」，同一检修只保留最新一版；
    //    若该计划已被核销（设备完成保养），补报只刷新内容，不把状态改回去。
    const existingPlan = planRows.find((item) => String(item['来源检修编号']) === source)
    const planPending = !existingPlan || existingPlan.status === '待保养'
    const plan = upsertBySource(planRows, (id) => ({
      id,
      status: planPending ? '待保养' : existingPlan.status,
      pending: planPending,
      abnormal: existingPlan?.abnormal ?? false,
      保养计划编号: existingPlan ? existingPlan.保养计划编号 : `BYJH-${String(id).padStart(4, '0')}`,
      设备编号: deviceNo,
      设备名称: device.设备名称 ?? '',
      来源检修编号: source,
      计划保养日: row.完工日期,
      保养周期: device.保养周期 ?? '90天',
      计划内容: `${row.检修对象}完工后例行保养`,
      计划状态: planPending ? '待保养' : existingPlan.计划状态,
    }))
    planRows.splice(0, planRows.length, ...plan.rows)
    if (plan.inserted) {
      planInserted += 1
    }

    // 4) 设备台账本体同步成待保养；已经完成保养/报废的设备不被补报打回。
    const deviceIndex = deviceRows.findIndex((item) => String(item.设备编号) === deviceNo)
    if (deviceIndex >= 0 && deviceRows[deviceIndex].status !== '已保养' && deviceRows[deviceIndex].status !== '已报废') {
      deviceRows[deviceIndex] = {
        ...deviceRows[deviceIndex],
        status: '待保养',
        pending: true,
        设备状态: '待保养',
      }
      deviceTouched += 1
    }
  }

  saveMany({
    [CARE_LEDGER_KEY]: ledgerRows,
    [CARE_LOG_KEY]: logRows,
    [CARE_PLAN_KEY]: planRows,
    [DEVICE_KEY]: deviceRows,
  })
  if (maint.length === 1) {
    if (ledgerInserted) {
      notes.unshift(`处理结论已落入维保台账（${maint[0].检修编号}）`)
    }
    if (deviceTouched) {
      notes.push(
        planInserted
          ? `已添加保养计划「待保养」1 条，设备台账同步为待保养`
          : `保养计划已更新为最新版本（不另存第二版），设备台账同步为待保养`,
      )
    }
  }
  return notes
}

export function runMaintenanceAction(
  id: number,
  action: string,
  payload: MaintActionPayload = {},
): ActionResult & { notes?: string[] } {
  const rows = listRows(MAINTENANCE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的检修记录` }
  }
  const row = rows[index]
  const current = String(row.status)
  const today = toDateString(new Date())

  // 材料补报：只对已完工记录开放，且只覆盖同一来源的旧版本。
  if (action === '材料补报') {
    if (current !== '已完工') {
      return { ok: false, message: '材料补报只针对已完工记录，请先按环节推进到完工' }
    }
    if (!String(payload.更换部件 ?? '').trim() && !String(payload.材料批次号 ?? '').trim()) {
      return { ok: false, message: '请填写本次补报的更换部件或材料批次号' }
    }
    const updated: EntryRow = {
      ...row,
      更换部件: String(payload.更换部件 ?? row.更换部件 ?? '').trim(),
      材料批次号: String(payload.材料批次号 ?? row.材料批次号 ?? '').trim(),
      处理结论: String(payload.处理结论 ?? row.处理结论 ?? '').trim(),
    }
    const nextRows = [...rows]
    nextRows[index] = updated
    saveMany({ [MAINTENANCE_KEY]: nextRows })
    const notes = syncAfterFinish([updated])
    return { ok: true, message: '材料补报已覆盖旧版本，维保台账与保养记录均只保留最新一版', notes }
  }

  // 状态机：只能一段一段往下走，跨段直接打回并写清卡在哪一段。
  const target = nextStatusOf(current, action)
  if (!target) {
    const allow = allowedActions(current)
    const stageHint =
      current === '已完工'
        ? '该记录已完工，同一检修记录重复提交完工只推进一次'
        : `当前停在「${current}」段，允许的动作只有：${allow.join('、') || '无'}`
    return {
      ok: false,
      message: `已打回：不能从「${current}」直接执行「${action}」。${stageHint}`,
    }
  }

  let updated: EntryRow = { ...row }
  if (action === '提交开工') {
    updated = { ...updated, 实际开工日: String(row.实际开工日 ?? '') || today }
  }
  if (action === '申请延期') {
    updated = { ...updated, 延期批复日: today, abnormal: true }
  }
  if (action === '延期开工') {
    updated = { ...updated, 实际开工日: String(row.实际开工日 ?? '') || today, abnormal: false }
  }
  if (action === '确认完工') {
    // 双保险：即便按钮被重复点到，已经是完工态就不会再落一次副作用。
    if (current === '已完工') {
      return { ok: false, message: '该检修记录已完工，重复提交完工只推进一次' }
    }
    updated = {
      ...updated,
      status: '已完工',
      pending: false,
      abnormal: false,
      完工日期: today,
      更换部件: String(payload.更换部件 ?? row.更换部件 ?? '').trim(),
      材料批次号: String(payload.材料批次号 ?? row.材料批次号 ?? '').trim(),
      处理结论: String(payload.处理结论 ?? '').trim(),
    }
  } else {
    updated = { ...updated, status: target, pending: target !== '已完工' }
  }

  const nextRows = [...rows]
  nextRows[index] = updated
  saveMany({ [MAINTENANCE_KEY]: nextRows })

  if (action === '确认完工') {
    const notes = syncAfterFinish([updated])
    return { ok: true, message: `「${updated.检修编号}」已确认完工，当前状态「已完工」`, notes }
  }
  return { ok: true, message: `「${updated.检修编号}」已${action}，当前状态「${target}」` }
}

// 设备台账页「完成保养」：核销该设备最新的待保养计划，并回写台账。
export function completeDeviceCare(id: number): ActionResult {
  const deviceRows = listRows(DEVICE_KEY)
  const index = deviceRows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管廊设备` }
  }
  const device = deviceRows[index]
  if (String(device.status) !== '待保养') {
    return { ok: false, message: `设备当前为「${device.status}」，没有待保养计划可核销` }
  }
  const today = toDateString(new Date())
  const deviceNo = String(device.设备编号)
  const planRows = listRows(CARE_PLAN_KEY).map((row) =>
    String(row.设备编号) === deviceNo && String(row.status) === '待保养'
      ? { ...row, status: '已保养', pending: false, 计划状态: '已保养' }
      : row,
  )
  const nextDevices = [...deviceRows]
  nextDevices[index] = {
    ...device,
    status: '已保养',
    pending: false,
    上次保养日: today,
    设备状态: '已保养',
  }
  saveMany({ [DEVICE_KEY]: nextDevices, [CARE_PLAN_KEY]: planRows })
  return { ok: true, message: `「${deviceNo}」保养完成，待保养计划已核销，台账上次保养日更新为 ${today}` }
}

export function planIsOverdue(row: EntryRow, today = new Date()): boolean {
  if (String(row.status) !== '待保养') {
    return false
  }
  const planned = parseDate(row.计划保养日)
  return !!planned && planned < new Date(today.getFullYear(), today.getMonth(), today.getDate())
}

export { cycleDays }
