import { backfillPlanRange, CARE_LEDGER_KEY, CARE_LOG_KEY, CARE_PLAN_KEY, DEVICE_KEY, MAINTENANCE_KEY } from './maintenance-model'
import type { EntryRow } from './types'

// 检修、设备台账、维保台账的示例数据。
// 日期以「当前运行日」为锚点生成，任何月份打开都能看到当月到期、
// 已拖过计划工期、延期批复后未动工、本月已完工等完整看板形态。

type MaintenanceInput = {
  no: string
  target: string
  device: string
  category: string
  crew: string
  start?: number
  end: number
  begin?: number
  finish?: number
  status: string
  part?: string
  batch?: string
  delay?: number
  conclusion?: string
  legacy?: boolean
}

type DeviceInput = {
  no: string
  name: string
  model: string
  cabin: string
  commission: string
  period: string
  lastCare: string
}

const TEAM_A = '机电一班'
const TEAM_B = '机电二班'
const TEAM_C = '土建班组'
const TEAM_D = '弱电班组'

const DEVICE_INPUTS: DeviceInput[] = [
  { no: 'DEVI-0001', name: '1号送风机组', model: 'SF-22', cabin: '电力舱A段', commission: '2024-03-12', period: '90天', lastCare: '2026-07-01' },
  { no: 'DEVI-0002', name: '2号排水泵', model: 'WQ-15', cabin: '综合舱B段', commission: '2024-05-20', period: '6个月', lastCare: '2026-08-10' },
  { no: 'DEVI-0003', name: '消防稳压泵', model: 'XBD-7', cabin: '电力舱C段', commission: '2023-11-08', period: '180天', lastCare: '2026-04-18' },
  { no: 'DEVI-0004', name: '应急照明配电柜', model: 'PD-380', cabin: '综合舱A段', commission: '2025-01-15', period: '1年', lastCare: '2026-01-20' },
  { no: 'DEVI-0005', name: '环境监测主机', model: 'ENV-9', cabin: '燃气舱B段', commission: '2025-06-01', period: '6个月', lastCare: '2026-09-05' },
  { no: 'DEVI-0006', name: '排水泵坑液位计', model: 'LT-200', cabin: '综合舱C段', commission: '2024-09-09', period: '90天', lastCare: '2026-06-22' },
  { no: 'DEVI-0007', name: '防火卷帘电机', model: 'JM-12', cabin: '电力舱B段', commission: '2024-02-28', period: '1年', lastCare: '2025-12-10' },
  { no: 'DEVI-0008', name: '进风风阀执行器', model: 'FV-05', cabin: '燃气舱A段', commission: '2025-03-30', period: '90天', lastCare: '2026-08-28' },
]

function dayOffset(base: Date, delta: number): string {
  const date = new Date(base.getTime())
  date.setDate(date.getDate() + delta)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function rangeText(start?: string, end?: string): string {
  if (start && end) {
    return `${start} ~ ${end}`
  }
  return end ? `待排定 ~ ${end}` : '待排定'
}

function buildMaintenanceRows(): EntryRow[] {
  const today = new Date()
  // 前三条是「早年台账」：没有登记计划工期，后两条连处理结论都缺，
  // 交给迁移/回填逻辑倒推，用来演示存量规则。
  const inputs: MaintenanceInput[] = [
    { no: 'MAIN-0001', target: '1号送风机组例行检修', device: 'DEVI-0001', category: '日常检修', crew: TEAM_A, end: -400, finish: -400, status: '已完工', part: '轴承组件', batch: 'LOT-2025-0811', conclusion: '更换轴承组件，试运行正常', legacy: true },
    { no: 'MAIN-0002', target: '消防稳压泵专项检修', device: 'DEVI-0003', category: '专项检修', crew: TEAM_A, end: -260, finish: -260, status: '已完工', part: '密封件总成', batch: 'LOT-2026-0120', conclusion: '更换密封件总成，保压试验合格', legacy: true },
    { no: 'MAIN-0003', target: '防火卷帘电机应急检修', device: 'DEVI-0007', category: '应急检修', crew: TEAM_B, end: -150, finish: -150, status: '已完工', part: '限位开关', legacy: true },
    { no: 'MAIN-0004', target: '2号排水泵更换叶轮', device: 'DEVI-0002', category: '日常检修', crew: TEAM_B, start: -22, end: -15, begin: -22, finish: -14, status: '已完工', part: '叶轮组件', batch: 'LOT-2026-0908', conclusion: '叶轮气蚀更换，排水恢复正常' },
    { no: 'MAIN-0005', target: '排水泵坑液位计校准', device: 'DEVI-0006', category: '专项检修', crew: TEAM_C, start: -24, end: -9, status: '待开工' },
    { no: 'MAIN-0006', target: '综合舱B段支架防腐', device: '', category: '日常检修', crew: TEAM_C, start: -20, end: -12, begin: -12, finish: -11, status: '已完工', conclusion: '防腐处理完成，未更换部件' },
    { no: 'MAIN-0007', target: '进风风阀执行器检查', device: 'DEVI-0008', category: '日常检修', crew: TEAM_D, start: -9, end: -2, status: '待开工' },
    { no: 'MAIN-0008', target: '环境监测主机校准', device: 'DEVI-0005', category: '专项检修', crew: TEAM_D, start: -8, end: 2, begin: -4, status: '检修中' },
    { no: 'MAIN-0009', target: '1号送风机组皮带更换', device: 'DEVI-0001', category: '日常检修', crew: TEAM_A, start: -6, end: -1, status: '已延期', delay: -3 },
    { no: 'MAIN-0010', target: '消防稳压泵季度保养', device: 'DEVI-0003', category: '专项检修', crew: TEAM_A, start: -2, end: 5, status: '待开工' },
    { no: 'MAIN-0011', target: '应急照明配电柜检修', device: 'DEVI-0004', category: '应急检修', crew: TEAM_B, start: -3, end: 1, begin: -3, finish: -1, status: '已完工', part: '断路器', batch: 'LOT-2026-1002', conclusion: '更换故障断路器，回路恢复供电' },
    { no: 'MAIN-0012', target: '防火卷帘电机调试', device: 'DEVI-0007', category: '日常检修', crew: TEAM_B, start: -1, end: 8, begin: 0, status: '检修中' },
    { no: 'MAIN-0013', target: '燃气舱管线支架紧固', device: '', category: '日常检修', crew: TEAM_C, start: 25, end: 32, status: '待开工' },
    { no: 'MAIN-0014', target: '综合舱通风管路专项检修', device: '', category: '专项检修', crew: TEAM_D, start: 45, end: 58, status: '待开工' },
  ]

  return inputs.map((item, index) => {
    const end = dayOffset(today, item.end)
    // 早年记录没有登记计划工期：按类别标准工期从完工日倒推，与迁移逻辑同口径。
    const backfilled = item.legacy ? backfillPlanRange({ 完工日期: end, 检修类别: item.category }) : null
    const start = item.legacy
      ? backfilled?.计划开始 ?? ''
      : item.start !== undefined
        ? dayOffset(today, item.start)
        : ''
    const row: EntryRow = {
      id: index + 1,
      status: item.status,
      pending: item.status !== '已完工',
      abnormal: item.status === '已延期',
      检修编号: item.no,
      检修对象: item.target,
      关联设备: item.device,
      检修类别: item.category,
      检修班组: item.crew,
      计划开始: start,
      计划结束: item.legacy ? backfilled?.计划结束 ?? end : end,
      计划工期: rangeText(start, item.legacy ? backfilled?.计划结束 ?? end : end),
      实际开工日: item.begin !== undefined ? dayOffset(today, item.begin) : '',
      完工日期: item.finish !== undefined ? dayOffset(today, item.finish) : '',
      更换部件: item.part ?? '',
      材料批次号: item.batch ?? '',
      延期批复日: item.delay !== undefined ? dayOffset(today, item.delay) : '',
      处理结论: item.conclusion ?? '',
      回填说明: item.legacy ? backfilled?.回填说明 ?? '' : '按计划登记',
    }
    return row
  })
}

function buildDeviceRows(): EntryRow[] {
  return DEVICE_INPUTS.map((item, index) => {
    const last = new Date(`${item.lastCare}T00:00:00`)
    const periodDays = item.period.includes('年')
      ? Number(item.period) * 365
      : item.period.includes('月')
        ? Number(item.period) * 30
        : Number(item.period.match(/\d+/)?.[0] ?? 90)
    const due = new Date(last.getTime())
    due.setDate(due.getDate() + periodDays)
    const overdue = due.getTime() <= new Date().setHours(0, 0, 0, 0)
    return {
      id: index + 1,
      status: overdue ? '待保养' : '运行中',
      pending: overdue,
      abnormal: false,
      设备编号: item.no,
      设备名称: item.name,
      设备型号: item.model,
      所属舱室: item.cabin,
      投运日期: item.commission,
      保养周期: item.period,
      上次保养日: item.lastCare,
      设备状态: overdue ? '待保养' : '运行中',
    }
  })
}

// 早年纸质台账里有、电子检修记录里缺的完工项：没有原编号可挂，
// 按裁决另起一行补录，编号用 WBLR- 前缀并在备注写清来路。
const CARE_SUPPLEMENT = [
  {
    no: 'WBLR-0001',
    target: '2号排水泵',
    crew: TEAM_B,
    category: '应急检修',
    finish: '2025-11-06',
    part: '机械密封',
    batch: 'LOT-2025-1106',
    conclusion: '更换机械密封，渗漏消除（早期纸质单补录）',
    remark: '早年纸质工单未登记电子检修记录，按补录规则另立台账行',
  },
]

function buildCareLedgerRows(maintRows: EntryRow[]): EntryRow[] {
  const finished = maintRows.filter((row) => String(row.status) === '已完工')
  const migrated = finished.map((row, index) => ({
    id: index + 1,
    status: '已归档',
    pending: false,
    abnormal: false,
    台账编号: String(row.检修编号),
    来源检修编号: row.检修编号,
    检修对象: row.检修对象,
    检修班组: row.检修班组,
    检修类别: row.检修类别,
    完工日期: row.完工日期,
    更换部件: row.更换部件,
    材料批次号: row.材料批次号,
    处理结论: row.处理结论 || (row.更换部件 ? `更换${row.更换部件}（结论待补录）` : '检修完工（结论待补录）'),
    登记方式: '原编号迁移',
    备注: row.回填说明 && row.回填说明 !== '按计划登记' ? row.回填说明 : '',
  }))
  const supplements = CARE_SUPPLEMENT.map((item, index) => ({
    id: migrated.length + index + 1,
    status: '补录',
    pending: false,
    abnormal: false,
    台账编号: item.no,
    来源检修编号: '',
    检修对象: item.target,
    检修班组: item.crew,
    检修类别: item.category,
    完工日期: item.finish,
    更换部件: item.part,
    材料批次号: item.batch,
    处理结论: item.conclusion,
    登记方式: '早年漏登记补录',
    备注: item.remark,
  }))
  return [...migrated, ...supplements]
}

// 设备保养记录：检修完工且更换了部件才生成一条；来源检修编号是唯一键，
// 重复上报（材料补报/重复完工）只覆盖同一行，不会出现两版并列。
function buildCareLogRows(maintRows: EntryRow[]): EntryRow[] {
  return maintRows
    .filter((row) => String(row.status) === '已完工' && String(row.更换部件 ?? '') !== '')
    .map((row, index) => ({
      id: index + 1,
      status: '已保养',
      pending: false,
      abnormal: false,
      保养记录编号: `BYJL-${String(index + 1).padStart(4, '0')}`,
      设备编号: row.关联设备,
      设备名称: DEVICE_INPUTS.find((device) => device.no === row.关联设备)?.name ?? '',
      来源检修编号: row.检修编号,
      保养日期: row.完工日期,
      保养内容: `检修更换：${row.更换部件}`,
      更换部件: row.更换部件,
      材料批次号: row.材料批次号,
      检修班组: row.检修班组,
    }))
}

// 设备保养计划：只要检修完工就给对应设备添一条「待保养」（即使本次没换件）。
function buildCarePlanRows(maintRows: EntryRow[]): EntryRow[] {
  return maintRows
    .filter((row) => String(row.status) === '已完工' && String(row.关联设备 ?? '') !== '')
    .map((row, index) => ({
      id: index + 1,
      status: '待保养',
      pending: true,
      abnormal: false,
      保养计划编号: `BYJH-${String(index + 1).padStart(4, '0')}`,
      设备编号: row.关联设备,
      设备名称: DEVICE_INPUTS.find((device) => device.no === row.关联设备)?.name ?? '',
      来源检修编号: row.检修编号,
      计划保养日: row.完工日期,
      保养周期: DEVICE_INPUTS.find((device) => device.no === row.关联设备)?.period ?? '90天',
      计划内容: `${row.检修对象}完工后例行保养`,
      计划状态: '待保养',
    }))
}

export function buildMaintenanceSeeds(): Record<string, EntryRow[]> {
  const maintenance = buildMaintenanceRows()
  return {
    [MAINTENANCE_KEY]: maintenance,
    [DEVICE_KEY]: buildDeviceRows(),
    [CARE_LEDGER_KEY]: buildCareLedgerRows(maintenance),
    [CARE_LOG_KEY]: buildCareLogRows(maintenance),
    [CARE_PLAN_KEY]: buildCarePlanRows(maintenance),
  }
}
