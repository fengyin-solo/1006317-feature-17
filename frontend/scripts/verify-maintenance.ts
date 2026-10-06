import {
  boardColumns,
  boardRows,
  currentScope,
  maintenanceStats,
  inScope,
  maintenanceAction,
  ensureMigrated,
  patchMaintenance,
} from '@/api/maintenance-service'
import { careLogs, carePlans, listEntries, runAction, resetModule } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'

let pass = 0
let fail = 0
const lines: string[] = []
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++
    lines.push('PASS ' + name)
  } else {
    fail++
    lines.push('FAIL ' + name + ' ' + extra)
  }
}

ensureMigrated()
const maint = listRows('maintenance')
const old = maint.find((r) => r['检修编号'] === 'MAIN-202508-027')
check('早年无计划工期按完工前7自然日倒推', old?.['计划工期'] === '2025-08-15', String(old?.['计划工期']))
check('倒推记录标注工期来源', String(old?.['工期来源']).includes('倒推'))

const scope = currentScope()
const cards = boardRows(scope)
const cols = boardColumns(scope)
const stats = maintenanceStats(scope)
lines.push('看板统计 ' + JSON.stringify(stats))
check('本月看板共6条（10月到期/在做/完工：1,2,3,4,5,6）', cards.length === 6, String(cards.length))
check('待开工列3条（1,2,6）', cols.find((c) => c.status === '待开工')!.cards.length === 3)
check('检修中列1条（3）', cols.find((c) => c.status === '检修中')!.cards.length === 1)
check('已延期列1条（4）', cols.find((c) => c.status === '已延期')!.cards.length === 1)
check('已完工列1条（5）', cols.find((c) => c.status === '已完工')!.cards.length === 1)
check('逾期数2（id3、id4）', stats.已逾期 === 2, String(stats.已逾期))
check('延期已批未动1（id4）', stats.已延期未动 === 1)
const teams = cols.find((c) => c.status === '待开工')!.groups.map((g) => g.team).join(',')
check('列内按班组分组排序', teams === '机电一班,机电二班,机电三班', teams)

const listInScope = listEntries('maintenance').items.filter((r) => inScope(r, scope))
check('看板条数与明细列表对得上', listInScope.length === cards.length, listInScope.length + ' vs ' + cards.length)

// 分段状态机
const r1 = maint.find((r) => r['检修编号'] === 'MAIN-202610-001')!
let res = runAction('maintenance', Number(r1.id), '确认完工')
check('待开工直接完工被打回', !res.ok && res.message.includes('环节不能跳过'), res.message)
res = runAction('maintenance', Number(r1.id), '申请延期')
check('无批文延期被打回', !res.ok && res.message.includes('延期批文'), res.message)
res = runAction('maintenance', Number(r1.id), '提交开工')
check('待开工提交开工进入检修中', res.ok && res.message.includes('检修中'), res.message)
const r1b = listRows('maintenance').find((r) => r.id === r1.id)!
check('开工自动登记开工日期', !!r1b['开工日期'])
res = runAction('maintenance', Number(r1.id), '申请延期')
check('检修中不能再申请延期', !res.ok)
res = runAction('maintenance', Number(r1.id), '提交开工')
check('重复提交开工打回', !res.ok)

// 完工联动
res = runAction('maintenance', Number(r1.id), '确认完工')
check('无处理结论完工打回', !res.ok && res.message.includes('处理结论'), res.message)
patchMaintenance(Number(r1.id), { 处理结论: '试运行正常', 更换部件: '过滤网' })
res = runAction('maintenance', Number(r1.id), '确认完工')
check('有结论后完工成功并联动设备台账', res.ok && res.message.includes('保养'), res.message)
const res2 = runAction('maintenance', Number(r1.id), '确认完工')
check('重复提交完工打回且不重复联动', !res2.ok, res2.message)

const logs = careLogs().filter((l) => l.来源检修编号 === 'MAIN-202610-001')
check('保养记录写入1条且部件同步', logs.length === 1 && logs[0]['更换部件'] === '过滤网', String(logs.length))
const dev1 = listRows('device').find((d) => d['设备编号'] === 'DEVI-0001')!
check('设备置待保养、上次保养日=完工日', dev1.status === '待保养' && dev1['上次保养日'] === '2026-10-06', dev1.status + ' ' + dev1['上次保养日'])
const plans1 = carePlans().filter((p) => p['设备编号'] === 'DEVI-0001' && p.计划状态 === '待保养')
check('待保养计划+90天（3个月）', plans1.length === 1 && plans1[0].计划保养日 === '2027-01-04', JSON.stringify(plans1))

// 同批材料再报：覆盖不并版
patchMaintenance(Number(r1.id), { 更换部件: '过滤网V2', 处理结论: '更换为V2' })
const rows = listRows('maintenance')
const idx = rows.findIndex((r) => r.id === r1.id)
rows[idx].status = '检修中'
saveRows('maintenance', rows)
const res3 = runAction('maintenance', Number(r1.id), '确认完工')
check('退回检修中后可再次完工', res3.ok, res3.message)
const logs2 = careLogs().filter((l) => l.来源检修编号 === 'MAIN-202610-001')
check('同编号保养记录只留最新一版', logs2.length === 1 && logs2[0]['更换部件'] === '过滤网V2', String(logs2.length))
const plans2 = carePlans().filter((p) => p['设备编号'] === 'DEVI-0001' && p.计划状态 === '待保养')
check('待保养计划仍只1条', plans2.length === 1)

// 完成保养核销
res = runAction('device', Number(dev1.id), '完成保养')
check('设备完成保养成功', res.ok, res.message)
const dev1b = listRows('device').find((d) => d['设备编号'] === 'DEVI-0001')!
check('设备状态变已保养', dev1b.status === '已保养')
check('待保养计划同步核销', carePlans().filter((p) => p['设备编号'] === 'DEVI-0001' && p.计划状态 === '待保养').length === 0)
res = runAction('device', Number(dev1.id), '完成保养')
check('重复完成保养打回', !res.ok)

// 早年未登记设备另起一行
const devNew = listRows('device').find((d) => d['设备名称'] === '西舱入口防火卷帘门')
check('早年未登记项另起一行并说明', !!devNew && String(devNew['登记说明']).includes('补登另起一行'), String(devNew?.['登记说明']))
check('补登设备编号续号 DEVI-0008', devNew?.['设备编号'] === 'DEVI-0008', String(devNew?.['设备编号']))
const logNew = careLogs().find((l) => l.来源检修编号 === 'MAIN-202508-027')
check('旧完工记录同样落维保台账', !!logNew && logNew['更换部件'] === '卷帘门控制模块')

// 已延期 → 提交开工 唯一通路
const r4 = maint.find((r) => r['检修编号'] === 'MAIN-202610-004')!
res = runAction('maintenance', Number(r4.id), '确认完工')
check('已延期不能直接完工（必须先开工）', !res.ok && res.message.includes('提交开工'), res.message)
res = runAction('maintenance', Number(r4.id), '提交开工')
check('已延期提交开工进入检修中', res.ok, res.message)

// 迁移幂等
resetModule('maintenance')
ensureMigrated()
check('重置+再迁移后保养记录数稳定为3（完工5,7,8）', careLogs().length === 3, String(careLogs().length))
const openPlans = carePlans().filter((p) => p.计划状态 === '待保养')
check('待保养计划每设备至多1条', openPlans.length === new Set(openPlans.map((p) => p.设备编号)).size, String(openPlans.length))
check('重置后设备同步为待保养（有未完工计划）', listRows('device').filter((d) => d.status === '待保养').length === openPlans.length)

// 维护动作服务直调冒烟
const smoke = maintenanceAction(999999, '提交开工')
check('不存在的记录打回', !smoke.ok)

lines.push('RESULT ' + pass + ' passed, ' + fail + ' failed')
console.log(lines.join('\n'))
if (fail > 0) {
  process.exit(1)
}
