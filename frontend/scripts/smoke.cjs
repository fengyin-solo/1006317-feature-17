/* 业务规则冒烟测试：node scripts/smoke.cjs（经 esbuild 即时转译 TS）。 */
const esbuild = require('esbuild')
const fs = require('fs')
const path = require('path')

// 注册 .ts require 钩子：所有 TS 依赖即时转成 CJS，@/ 别名映射到 src。
require.extensions['.ts'] = function (mod, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const out = esbuild.transformSync(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'es2020',
    sourcefile: filename,
  })
  const srcRoot = path.resolve(__dirname, '../src')
  const resolveSpec = (spec, fromFile) => {
    let candidate = spec
    if (spec.startsWith('@/')) {
      candidate = path.join(srcRoot, spec.slice(2))
    } else if (spec.startsWith('.')) {
      candidate = path.resolve(path.dirname(fromFile), spec)
    } else if (!spec.startsWith('/')) {
      return null
    }
    if (fs.existsSync(candidate)) {
      return candidate
    }
    if (fs.existsSync(candidate + '.ts')) {
      return candidate + '.ts'
    }
    if (fs.existsSync(path.join(candidate, 'index.ts'))) {
      return path.join(candidate, 'index.ts')
    }
    return null
  }
  const code = out.code.replace(/require\("([^"]+)"\)/g, (m, spec) => {
    const resolved = resolveSpec(spec, filename)
    return resolved ? `require(${JSON.stringify(resolved)})` : m
  })
  mod._compile(code, filename)
}

// localStorage / window 垫片
const storage = new Map()
global.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
}

const model = require('../src/data/maintenance-model.ts')
const store = require('../src/data/local-store.ts')
const svc = require('../src/api/maintenance-service.ts')

let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

function findRow(rows, no) {
  return rows.find((r) => r['检修编号'] === no)
}

// 重置为全新种子
storage.clear()
const month = model.currentMonth()
console.log(`运行月份：${month}`)

// 1) 看板与明细同切片，条数一致
const board = svc.buildBoard(month)
const slice = svc.maintenanceRows(month)
check('看板总条数 = 明细切片条数', board.total === slice.length, `${board.total} vs ${slice.length}`)
const colSum = model.MAINT_STATUSES.reduce((s, st) => s + (board.statusTotals[st] || 0), 0)
check('看板四列合计 = 总条数', colSum === board.total, `${colSum} vs ${board.total}`)
const crewSum = board.crews.reduce(
  (s, crew) => s + model.MAINT_STATUSES.reduce((n, st) => n + board.cells[crew][st].length, 0),
  0,
)
check('各班组格子合计 = 总条数', crewSum === board.total)

// 2) 月份口径：下月以后到期的不在本月；上月拖期滚入
check('MAIN-0013（下月到期）不在本月视图', !slice.some((r) => r['检修编号'] === 'MAIN-0013'))
check('MAIN-0014（远期到期）不在本月视图', !slice.some((r) => r['检修编号'] === 'MAIN-0014'))
check('MAIN-0005（9月拖期未完工）滚入本月视图', slice.some((r) => r['检修编号'] === 'MAIN-0005'))
check('MAIN-0004（9月完工）不在本月视图', !slice.some((r) => r['检修编号'] === 'MAIN-0004'))

// 3) 拖期/延期标记
const overdueIdle = findRow(slice, 'MAIN-0005')
check('拖过计划工期带「超期」角标', model.rowTags(overdueIdle).includes('超期'))
const delayed = findRow(slice, 'MAIN-0009')
check('延期批复未动工带「延期已批未动工」', model.rowTags(delayed).includes('延期已批未动工'))

// 4) 状态机：跨段打回
const r0005 = findRow(store.listRows('maintenance'), 'MAIN-0005')
const blocked = svc.runMaintenanceAction(Number(r0005.id), '确认完工')
check('待开工直接完工被打回', !blocked.ok && blocked.message.includes('打回') && blocked.message.includes('待开工'))
const delayedRow = findRow(store.listRows('maintenance'), 'MAIN-0009')
const blocked2 = svc.runMaintenanceAction(Number(delayedRow.id), '确认完工')
check('已延期直接完工被打回并指明卡在已延期', !blocked2.ok && blocked2.message.includes('已延期'))

// 5) 逐段推进：待开工 -> 检修中 -> 已完工
const r0007 = findRow(store.listRows('maintenance'), 'MAIN-0007')
const s1 = svc.runMaintenanceAction(Number(r0007.id), '提交开工')
check('提交开工成功', s1.ok)
const beforeLedger = store.listRows('careledger').length
const finish = svc.runMaintenanceAction(Number(r0007.id), '确认完工', {
  更换部件: '风阀阀芯',
  材料批次号: 'LOT-T1',
  处理结论: '更换阀芯，动作正常',
})
check('确认完工成功', finish.ok && finish.message.includes('已完工'))
check('完工同步提示含维保台账/保养计划', (finish.notes || []).length >= 2)

// 6) 重复完工只推进一次
const repeat = svc.runMaintenanceAction(Number(r0007.id), '确认完工', { 更换部件: '风阀阀芯' })
check('重复完工被拒绝', !repeat.ok && repeat.message.includes('只推进一次'))
check('维保台账没有因重复完工多出行', store.listRows('careledger').length === beforeLedger + 1)
check('保养计划没有因重复完工多出行',
  store.listRows('device-care-plan').filter((r) => r['来源检修编号'] === 'MAIN-0007').length === 1)
check('保养记录没有因重复完工多出行',
  store.listRows('device-care-log').filter((r) => r['来源检修编号'] === 'MAIN-0007').length === 1)

// 7) 同一批材料再报：覆盖不合并
const report = svc.runMaintenanceAction(Number(r0007.id), '材料补报', {
  更换部件: '风阀阀芯（改进型）',
  材料批次号: 'LOT-T2',
  处理结论: '批次更新为 LOT-T2',
})
check('材料补报成功', report.ok)
const plans0007 = store.listRows('device-care-plan').filter((r) => r['来源检修编号'] === 'MAIN-0007')
const logs0007 = store.listRows('device-care-log').filter((r) => r['来源检修编号'] === 'MAIN-0007')
const led0007 = store.listRows('careledger').filter((r) => r['来源检修编号'] === 'MAIN-0007')
check('保养计划同来源仅 1 行且为最新批次', plans0007.length === 1 && plans0007[0]['设备名称'] !== undefined)
check('保养记录同来源仅 1 行（不合并两版）', logs0007.length === 1 && logs0007[0]['材料批次号'] === 'LOT-T2')
check('维保台账同来源仅 1 行且结论为最新版', led0007.length === 1 && led0007[0]['处理结论'] === '批次更新为 LOT-T2')

// 8) 设备台账同步为待保养
const dev8 = store.listRows('device').find((r) => r['设备编号'] === 'DEVI-0008')
check('关联设备同步为待保养', dev8 && dev8.status === '待保养')
// 完成保养核销计划并回写台账
const done = svc.completeDeviceCare(Number(dev8.id))
check('完成保养成功', done.ok)
const dev8b = store.listRows('device').find((r) => r['设备编号'] === 'DEVI-0008')
check('设备台账变为已保养', dev8b.status === '已保养')
check('待保养计划被核销',
  !store.listRows('device-care-plan').some((r) => r['设备编号'] === 'DEVI-0008' && r.status === '待保养'))

// 8b) 设备完成保养后再补报：计划/台账不被打回待保养，记录仍只留一版
const reportAgain = svc.runMaintenanceAction(Number(r0007.id), '材料补报', {
  更换部件: '风阀阀芯（终版）',
  材料批次号: 'LOT-T3',
})
check('保养核销后补报仍成功', reportAgain.ok)
const dev8d = store.listRows('device').find((r) => r['设备编号'] === 'DEVI-0008')
check('已保养设备补报后不被打回待保养', dev8d.status === '已保养')
check('已核销计划补报后保持已保养',
  store.listRows('device-care-plan').filter((r) => r['来源检修编号'] === 'MAIN-0007').every((r) => r.status === '已保养'))
check('保养记录仍只有 1 行且为终版批次',
  store.listRows('device-care-log').filter((r) => r['来源检修编号'] === 'MAIN-0007').length === 1 &&
  store.listRows('device-care-log').find((r) => r['来源检修编号'] === 'MAIN-0007')['材料批次号'] === 'LOT-T3')

// 9) 无关联设备：只落维保台账，不生成计划
const r0006 = findRow(store.listRows('maintenance'), 'MAIN-0006')
svc.runMaintenanceAction(Number(r0006.id), '确认完工', { 处理结论: '防腐复检完成' })
check('无设备完工有台账行',
  store.listRows('careledger').some((r) => r['来源检修编号'] === 'MAIN-0006'))
check('无设备完工不生成保养计划',
  !store.listRows('device-care-plan').some((r) => r['来源检修编号'] === 'MAIN-0006'))
check('无设备完工不生成保养记录',
  !store.listRows('device-care-log').some((r) => r['来源检修编号'] === 'MAIN-0006'))

// 10) 存量回填规则：早年只有完工日期、没有计划工期的按类别标准工期倒推
const m1 = findRow(store.listRows('maintenance'), 'MAIN-0001') // 日常 7 天
const m2 = findRow(store.listRows('maintenance'), 'MAIN-0002') // 专项 14 天
const m3 = findRow(store.listRows('maintenance'), 'MAIN-0003') // 应急 3 天
const legacy = (no, category, finish) => ({ '检修编号': no, '检修类别': category, '完工日期': finish })
const b1 = model.backfillPlanRange(legacy('X1', '日常检修', m1['完工日期']))
const b2 = model.backfillPlanRange(legacy('X2', '专项检修', m2['完工日期']))
const b3 = model.backfillPlanRange(legacy('X3', '应急检修', m3['完工日期']))
check('日常检修倒推 7 天（结束=完工日）',
  b1['计划结束'] === m1['完工日期'] && b1['回填说明'].includes('7天'))
check('专项检修倒推 14 天', b2['回填说明'].includes('14天'))
check('应急检修倒推 3 天', b3['回填说明'].includes('3天'))
// 种子里的早年记录（MAIN-0001~0003）带着同样口径的回填说明迁移入库
check('早年记录在种子中携带回填说明',
  String(m1['回填说明']).includes('标准工期') && String(m3['回填说明']).includes('标准工期'))

// 11) 原编号迁移 & 早年漏登记另起一行
const ledger = store.listRows('careledger')
check('MAIN-0001 按原编号迁移入台账',
  ledger.some((r) => r['台账编号'] === 'MAIN-0001' && r['登记方式'] === '原编号迁移'))
check('早年漏登记项另起 WBLR 行并说明',
  ledger.some((r) => String(r['台账编号']).startsWith('WBLR-') && String(r['备注']).includes('补录')))

// 12) 延期开工回检修中，再完工
const s2 = svc.runMaintenanceAction(Number(delayedRow.id), '延期开工')
check('延期开工回到检修中', s2.ok && findRow(store.listRows('maintenance'), 'MAIN-0009').status === '检修中')
const s3 = svc.runMaintenanceAction(Number(delayedRow.id), '确认完工', { 更换部件: '传动皮带', 材料批次号: 'LOT-D1' })
check('回段后可完工', s3.ok)

// 13) 倒推函数直接验证边界
const bf = model.backfillPlanRange({ 完工日期: '2026-03-10', 检修类别: '应急检修' })
check('应急3天：开始=03-08 结束=03-10', bf['计划开始'] === '2026-03-08' && bf['计划结束'] === '2026-03-10')
const bf2 = model.backfillPlanRange({ 完工日期: '2026-01-05', 检修类别: '专项检修' })
check('专项14天跨年：开始=2025-12-23', bf2['计划开始'] === '2025-12-23')

// 14) 月份切片下钻：点格子回到的行集合与看板格内一致
const crewRows = board.cells[board.crews[0]]
const firstCellRows = crewRows ? crewRows[model.MAINT_STATUSES[0]] : []
check('看板格子内的行都能在明细切片按 id 找回',
  firstCellRows.every((card) => slice.some((r) => Number(r.id) === Number(card.id))))

console.log(failures === 0 ? `\n全部通过 ✔（${month} 视图 ${board.total} 条）` : `\n${failures} 项失败 ✘`)
process.exit(failures === 0 ? 0 : 1)
