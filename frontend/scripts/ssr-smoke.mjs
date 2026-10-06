// 渲染冒烟：用 Vite 的 SSR 模块加载器直接渲染检修/设备/概览页面，
// 验证模板在真实数据层下能渲染出看板、分组、统计等关键节点。
// 运行：node scripts/ssr-smoke.mjs
import { createServer } from 'vite'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
  },
}
globalThis.prompt = () => null

const server = await createServer({
  server: { middlewareMode: true },
  logLevel: 'silent',
})

const [{ default: Maintenance }, { default: Device }, { default: Dashboard }] = await Promise.all([
  server.ssrLoadModule('/src/views/maintenance/index.vue'),
  server.ssrLoadModule('/src/views/device/index.vue'),
  server.ssrLoadModule('/src/views/Dashboard.vue'),
])

async function render(comp) {
  const app = createSSRApp(comp)
  const html = await renderToString(app)
  return html
}

const checks = []
function check(name, cond) {
  checks.push([name, cond])
}

// 看板视图：onMounted 不在 SSR 触发，故先用服务层把数据备好，再断言模板关键骨架；
// 数据正确性已由 verify-maintenance 覆盖，这里专注模板不抛错、节点齐全。
const m = await render(Maintenance)
check('检修页渲染看板容器', m.includes('kanban'))
check('检修页渲染四个状态列', ['待开工', '检修中', '已延期', '已完工'].every((s) => m.includes(s)))
check('检修页渲染月份口径', m.includes('月'))
check('检修页渲染明细页签', m.includes('检修明细'))

const d = await render(Device)
check('设备页三页签', d.includes('保养记录') && d.includes('保养计划'))
check('设备页渲染设备主台账列', d.includes('设备编号'))

const dash = await render(Dashboard)
check('概览页含检修进度块', dash.includes('设施检修进度'))

await server.close()

let failed = 0
for (const [name, cond] of checks) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
  if (!cond) failed++
}
if (failed) process.exit(1)
console.log('RENDER_OK', checks.length, 'checks')
