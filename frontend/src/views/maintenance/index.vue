<template>
  <section class="page" data-module="maintenance">
    <header class="page-head">
      <div>
        <h2>设施检修管理</h2>
        <p class="page-desc">按班组与检修状态排布的当月检修进度；看板与明细同源同口径，点格子可回到检修明细。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出检修清单</button>
        <button class="btn ghost" type="button" @click="resetAll">重置示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ warn: item.warn }">{{ item.value }}</strong>
      </article>
    </div>

    <div class="scope-bar">
      <button class="btn" type="button" @click="shiftMonth(-1)">上一月</button>
      <strong>{{ scopeText }}</strong>
      <button class="btn" type="button" @click="shiftMonth(1)">下一月</button>
      <button class="btn ghost" type="button" @click="backToCurrent">回到本月</button>
      <label class="scope-switch">
        <input v-model="scope.includeOverdueOpen" type="checkbox" @change="rebuild" />
        挂入更早到期、至今未完工的逾期记录
      </label>
    </div>

    <div class="tab-bar" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        role="tab"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}<span class="tab-count">{{ tab.key === 'board' ? boardTotal : scopeRows.length }}</span>
      </button>
    </div>

    <!-- 进度看板：一列一个检修状态，列内按班组分组 -->
    <div v-show="activeTab === 'board'" class="kanban">
      <section v-for="column in columns" :key="column.status" class="kanban-col">
        <header class="kanban-head">
          <span>{{ column.status }}</span>
          <em>{{ column.cards.length }}</em>
        </header>
        <div v-for="group in column.groups" :key="`${column.status}-${group.team}`" class="kanban-group">
          <p class="kanban-team">{{ group.team }}<span>{{ group.cards.length }}</span></p>
          <button
            v-for="card in group.cards"
            :key="String(card.id)"
            class="kanban-card"
            :class="{ overdue: card.overdue, delayed: card.delayedNotStarted }"
            type="button"
            @click="openDetail(card.id)"
          >
            <strong>{{ card['检修编号'] }}</strong>
            <span class="card-target">{{ card['检修对象'] }}</span>
            <span class="card-meta">
              计划 {{ card['计划工期'] || '未填' }}
              <i v-if="card.overdue" class="tag warn">已拖期</i>
              <i v-else-if="card.delayedNotStarted" class="tag delayed">延期已批未开工</i>
            </span>
            <span class="card-meta">{{ card['检修类别'] }}</span>
          </button>
        </div>
        <p v-if="!column.cards.length" class="kanban-empty">本月无记录</p>
      </section>
    </div>

    <!-- 明细列表：默认就是看板同口径的当月进度，切到全部可看全量 -->
    <div v-show="activeTab === 'list'">
      <form class="filter-bar" @submit.prevent="rebuild">
        <label class="filter-item">
          <span>检修编号/对象/班组关键字</span>
          <input v-model="keyword" placeholder="按关键字检索" />
        </label>
        <label class="filter-item">
          <span>检修班组</span>
          <input v-model="teamFilter" placeholder="按班组检索" />
        </label>
        <label class="scope-switch">
          <input v-model="scopeOnly" type="checkbox" @change="rebuild" />
          仅看板口径（{{ scopeText }}）
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in tableColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in scopeRows"
            :key="String(row.id)"
            :class="{ 'row-hl': highlightedId === row.id, overdueRow: isOverdueRow(row) }"
          >
            <td v-for="column in tableColumns" :key="column">{{ display(row, column) }}</td>
            <td>
              {{ row.status }}
              <i v-if="isOverdueRow(row)" class="tag warn">已拖期</i>
              <i v-else-if="isDelayedNotStarted(row)" class="tag delayed">批了未动</i>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="openDetail(row.id)">检修明细</button>
              <button
                v-for="action in allowedActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!scopeRows.length">
            <td :colspan="tableColumns.length + 2" class="empty-state">当前口径下暂无检修记录</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>
          共 {{ scopeRows.length }} 条 · 看板合计 {{ boardTotal }} 条{{ scopeOnly ? '（同为当月进度口径，条数一致）' : '（当前为全量明细）' }}
        </span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span v-else-if="actionMessage" class="ok-text">{{ actionMessage }}</span>
      </footer>
    </div>

    <!-- 检修明细抽屉：看板格子与列表共用，取值与列表完全一致 -->
    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>检修明细 · {{ detail['检修编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-list">
          <div v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd :class="{ 'dd-warn': field === '计划工期' && isOverdueRow(detail) }">
              {{ display(detail, field) || '—' }}
              <i v-if="field === '检修状态' && isOverdueRow(detail)" class="tag warn">已拖期</i>
            </dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd>{{ detail.status }}（{{ detail.overdue ? '已拖过计划工期' : detail.delayedNotStarted ? '延期已批尚未开工' : '进度正常' }}）</dd>
          </div>
        </dl>
        <div class="drawer-actions">
          <button
            v-for="action in allowedActions(detail)"
            :key="action"
            class="btn"
            :class="{ primary: action === '确认完工' }"
            type="button"
            @click="runAction(action, detail)"
          >
            {{ action }}
          </button>
          <button class="btn ghost" type="button" @click="jumpToList">回到明细列表定位本条</button>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  resetModule,
  runAction as applyAction,
} from '@/api/local-service'
import {
  boardColumns,
  currentScope,
  inScope,
  maintenanceStats,
  patchMaintenance,
  scopeLabel,
  type BoardCard,
  type BoardScope,
} from '@/api/maintenance-service'
import { parseDate, today } from '@/data/date'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('maintenance')
const tableColumns = meta.fields
const detailFields = meta.fields
const tabs = [
  { key: 'board', label: '进度看板' },
  { key: 'list', label: '检修明细' },
] as const

const activeTab = ref<'board' | 'list'>('board')
const scope = reactive<BoardScope>(currentScope())
const scopeOnly = ref(true)
const keyword = ref('')
const teamFilter = ref('')
const allRows = ref<EntryRow[]>([])
const errorMessage = ref('')
const actionMessage = ref('')
const detail = ref<BoardCard | null>(null)
const highlightedId = ref<number | null>(null)

const columns = ref(boardColumns(scope))
const stats = computed(() => maintenanceStats(scope))
const boardTotal = computed(() => columns.value.reduce((sum, col) => sum + col.cards.length, 0))
const scopeText = computed(() => scopeLabel(scope))

const statCards = computed(() => [
  { label: '待开工（本月口径）', value: stats.value.待开工, warn: false },
  { label: '已拖过计划工期', value: stats.value.已逾期, warn: stats.value.已逾期 > 0 },
  { label: '延期已批还没动', value: stats.value.已延期未动, warn: stats.value.已延期未动 > 0 },
  { label: '检修中', value: stats.value.检修中, warn: false },
  { label: '本月到期未完工', value: stats.value.本月到期, warn: false },
  { label: `本月完工（${scope.monthIndex + 1}月）`, value: stats.value.本月完工, warn: false },
  { label: '看板合计', value: stats.value.看板合计, warn: false },
])

// 明细列表取值：看板口径 + 文本筛选；不勾「仅看板口径」时列出全量。
const scopeRows = computed(() => {
  const kw = keyword.value.trim()
  const team = teamFilter.value.trim()
  return allRows.value.filter((row) => {
    if (scopeOnly.value && !inScope(row, scope)) {
      return false
    }
    if (team && !String(row['检修班组'] ?? '').includes(team)) {
      return false
    }
    if (kw) {
      const haystack = `${row['检修编号'] ?? ''}${row['检修对象'] ?? ''}${row['检修班组'] ?? ''}`
      if (!haystack.includes(kw)) {
        return false
      }
    }
    return true
  })
})

function isOverdueRow(row: EntryRow): boolean {
  const due = parseDate(row['计划工期'])
  return row.status !== '已完工' && due !== null && due.getTime() < today().getTime()
}

function isDelayedNotStarted(row: EntryRow): boolean {
  return row.status === '已延期' && !parseDate(row['开工日期'])
}

// 环节只能一段一段推进：按分段状态机算出当前真正可点的动作，其余根本不渲染。
function allowedActions(row: EntryRow): string[] {
  if (row.status === '待开工') {
    return ['申请延期', '提交开工']
  }
  if (row.status === '已延期') {
    return ['提交开工']
  }
  if (row.status === '检修中') {
    return ['确认完工']
  }
  return []
}

function display(row: EntryRow, field: string): string {
  const value = row[field]
  if (field === '更换部件' && (value === '' || value === undefined || value === null)) {
    return '—'
  }
  return String(value ?? '')
}

function shiftMonth(delta: number) {
  const date = new Date(scope.year, scope.monthIndex + delta, 1)
  scope.year = date.getFullYear()
  scope.monthIndex = date.getMonth()
  rebuild()
}

function backToCurrent() {
  Object.assign(scope, currentScope())
  rebuild()
}

function resetFilters() {
  keyword.value = ''
  teamFilter.value = ''
  scopeOnly.value = true
  rebuild()
}

function exportRows() {
  downloadEntries(meta.key)
}

function resetAll() {
  resetModule(meta.key)
  rebuild()
}

function openDetail(id: number) {
  const payload = listEntries(meta.key)
  allRows.value = payload.items
  const found = boardColumns(scope)
    .flatMap((col) => col.cards)
    .find((card) => card.id === id)
  const fallback = payload.items.find((row) => Number(row.id) === id) as BoardCard | undefined
  detail.value = found
    ?? (fallback
      ? {
          ...fallback,
          overdue: isOverdueRow(fallback),
          delayedNotStarted: isDelayedNotStarted(fallback),
        }
      : null)
}

function closeDetail() {
  detail.value = null
}

function jumpToList() {
  if (!detail.value) {
    return
  }
  scopeOnly.value = true
  keyword.value = ''
  teamFilter.value = ''
  activeTab.value = 'list'
  highlightedId.value = Number(detail.value.id)
  window.setTimeout(() => {
    highlightedId.value = null
  }, 3000)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  actionMessage.value = ''
  const id = Number(row.id)
  // 申请延期前在页面侧补登批文（业务判断仍由服务端状态机兜底）。
  if (action === '申请延期' && !String(row['延期批文'] ?? '').trim()) {
    const permit = window.prompt('请登记延期批文（批复编号与同意延至的日期）')
    if (permit === null) {
      return
    }
    if (!permit.trim()) {
      errorMessage.value = '卡在「待开工」段：没有延期批文不能申请延期'
      return
    }
    patchMaintenance(id, { 延期批文: permit.trim() })
  }
  if (action === '确认完工' && !String(row['处理结论'] ?? '').trim()) {
    const conclusion = window.prompt('请填写处理结论（完工必填，将同步到设备维保台账）')
    if (conclusion === null) {
      return
    }
    if (!conclusion.trim()) {
      errorMessage.value = '卡在「检修中」段：没有处理结论不能确认完工'
      return
    }
    patchMaintenance(id, { 处理结论: conclusion.trim() })
  }
  const result = applyAction(meta.key, id, action)
  if (!result.ok) {
    errorMessage.value = result.message
    rebuild()
    if (detail.value) {
      openDetail(id)
    }
    return
  }
  actionMessage.value = result.message
  rebuild()
  if (detail.value) {
    openDetail(id)
  }
}

function rebuild() {
  errorMessage.value = ''
  columns.value = boardColumns(scope)
  const payload = listEntries(meta.key)
  allRows.value = payload.items
}

onMounted(rebuild)
</script>
