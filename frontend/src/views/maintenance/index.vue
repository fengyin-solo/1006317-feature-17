<template>
  <section class="page" data-module="maintenance">
    <header class="page-head">
      <div>
        <h2>设施检修管理</h2>
        <p class="page-desc">按检修班组和检修状态排布的月度进度视图：当月到期、拖过计划工期、延期批复未动工一屏看清；点卡片可回到检修明细。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出检修清单</button>
      </div>
    </header>

    <div class="tab-row">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: viewMode === tab.key }"
        type="button"
        @click="viewMode = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="stat-row">
      <article v-for="item in board.stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ alert: isAlert(item.label) }">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>进度月份</span>
        <input v-model="month" type="month" />
      </label>
      <button class="btn" type="button" @click="month = todayMonth">回到本月</button>
      <label class="filter-item grow">
        <span>关键字</span>
        <input v-model="keyword" placeholder="按检修编号 / 对象 / 班组 / 关联设备检索" />
      </label>
    </form>

    <!-- 进度看板：每列一种检修状态，每行一个班组 -->
    <div v-if="viewMode === 'board'" class="board-wrap">
      <table class="board-table">
        <thead>
          <tr>
            <th class="crew-col">检修班组</th>
            <th v-for="status in statuses" :key="status">
              <span class="col-head" :class="statusClass(status)">{{ status }}</span>
              <span class="col-count">{{ board.statusTotals[status] ?? 0 }} 条</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="crew in board.crews" :key="crew">
            <td class="crew-col">{{ crew }}</td>
            <td v-for="status in statuses" :key="status" class="board-cell">
              <button
                v-for="row in board.cells[crew][status]"
                :key="String(row.id)"
                class="maint-card"
                :class="statusClass(status)"
                type="button"
                @click="openRow(row)"
              >
                <span class="card-no">{{ row.检修编号 }}</span>
                <span class="card-target">{{ row.检修对象 }}</span>
                <span class="card-meta">
                  计划到期：{{ row.计划结束 || '—' }}
                </span>
                <span v-if="row.完工日期" class="card-meta">完工：{{ row.完工日期 }}</span>
                <span v-if="hasTags(row)" class="card-tags">
                  <em v-for="tag in tagsOf(row)" :key="tag">{{ tag }}</em>
                </span>
              </button>
              <span v-if="!board.cells[crew][status].length" class="cell-empty">—</span>
            </td>
          </tr>
          <tr v-if="!board.crews.length">
            <td :colspan="statuses.length + 1" class="empty-state">该月没有到期的检修记录</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="crew-col">合计</td>
            <td v-for="status in statuses" :key="status" class="foot-count">
              {{ board.statusTotals[status] ?? 0 }} 条
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- 明细视图：与看板同一份月份切片，条数对得上 -->
    <template v-else>
      <p class="status-legend">
        <span v-for="status in statuses" :key="status" class="legend-item">
          {{ status }}：{{ board.statusTotals[status] ?? 0 }}
        </span>
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>进度标记</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in board.rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] !== '' && row[column] !== undefined ? row[column] : '—' }}</td>
            <td><span class="status-chip" :class="statusClass(String(row.status))">{{ row.status }}</span></td>
            <td>
              <em v-for="tag in tagsOf(row)" :key="tag" class="mini-tag">{{ tag }}</em>
              <span v-if="!hasTags(row)">—</span>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="openRow(row)">检修明细</button>
            </td>
          </tr>
          <tr v-if="!board.rows.length">
            <td :colspan="columns.length + 3" class="empty-state">该月没有到期的检修记录</td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span>
        {{ month }} 视图共 {{ board.total }} 条，与明细列表条数一致
        <template v-if="keyword">（已按「{{ keyword }}」过滤）</template>
      </span>
    </footer>

    <MaintenanceDetailDrawer :row="activeRow" @close="activeRow = null" @changed="reload" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import { buildBoard, getMaintenance, maintenanceTags } from '@/api/maintenance-service'
import { currentMonth } from '@/data/maintenance-model'
import type { EntryRow } from '@/data/types'
import MaintenanceDetailDrawer from './MaintenanceDetailDrawer.vue'

const statuses = ['待开工', '检修中', '已延期', '已完工']
const columns = ['检修编号', '检修对象', '关联设备', '检修类别', '检修班组', '计划开始', '计划结束', '完工日期', '更换部件', '材料批次号']
const tabs = [
  { key: 'board', label: '进度看板' },
  { key: 'list', label: '检修明细' },
] as const

const todayMonth = currentMonth()
const month = ref(todayMonth)
const keyword = ref('')
const viewMode = ref<(typeof tabs)[number]['key']>('board')
const activeId = ref<number | null>(null)
// localStorage 不是响应式源，动作落库后自增版本号，驱动看板/明细重算。
const dataVersion = ref(0)

const board = computed(() => {
  void dataVersion.value
  return buildBoard(month.value, keyword.value)
})
const activeRow = computed<EntryRow | null>(() => {
  void dataVersion.value
  return activeId.value === null ? null : getMaintenance(activeId.value) ?? null
})

function statusClass(status: string): string {
  return { 待开工: 'todo', 检修中: 'doing', 已延期: 'delayed', 已完工: 'done' }[status] ?? ''
}
function tagsOf(row: EntryRow): string[] {
  return maintenanceTags(row)
}
function hasTags(row: EntryRow): boolean {
  return maintenanceTags(row).length > 0
}
function isAlert(label: string): boolean {
  return label.includes('拖过') || label.includes('延期')
}

function openRow(row: EntryRow) {
  activeId.value = Number(row.id)
}

function reload() {
  dataVersion.value += 1
}

function exportRows() {
  downloadEntries('maintenance')
}
</script>
