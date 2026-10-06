// 逻辑自检：用 esbuild 把 TS 测试入口连同 @ 别名打成单文件，在 Node + localStorage 垫片下运行。
// 运行：node scripts/run-verify.mjs
import { build } from '../node_modules/esbuild/lib/main.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
  },
}

const outfile = join(mkdtempSync(join(tmpdir(), 'verify-')), 'out.mjs')
await build({
  entryPoints: ['scripts/verify-maintenance.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  absWorkingDir: '/workspace/frontend',
  alias: { '@': join(process.cwd(), 'src') },
  logLevel: 'silent',
})

await import(outfile)
