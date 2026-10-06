<template>
  <section class="page" data-module="device">
    <header class="page-head">
      <div>
        <h2>设备台账管理</h2>
        <p class="page-desc">设备主台账、检修完工同步出的保养记录与保养计划一套账；完工结论落到维保台账，待保养计划只留最新一版。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出设备清单</button>
        <button class="btn ghost" type="button" @click="resetAll">重置示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ warn: item.warn }">{{ item.value }}</strong>
      </article>
    </div>

    <div class="tab-bar" role="tablist">
      <button
        v-for="tab in tabHeaders"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        role="tab"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}<span class="tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>设备编号 / 名称 / 所属舱室</span>
        <input v-model="keyword" placeholder="按关键字检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="keyword = ''; reload()">重置条件</button>
    </form>

    <div v-show="activeTab === 'device'">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in deviceColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in shownDevices" :key="String(row.id)" :class="{ overdueRow: row.status === '待保养' }">
            <td v-for="column in deviceColumns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button v-if="row.status === '待保养'" class="link" type="button" @click="completeCare(row)">
                完成保养
              </button>
              <button v-if="row.status === '已报废'" class="link disabled" type="button" disabled>已报废</button>
              <span v-else-if="row.status !== '待保养'" class="muted-text">暂无待办</span>
            </td>
          </tr>
          <tr v-if="!shownDevices.length">
            <td :colspan="deviceColumns.length + 2" class="empty-state">暂无设备台账数据</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ shownDevices.length }} / {{ devices.length }} 台设备</span>
      </footer>
    </div>

    <div v-show="activeTab === 'logs'">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in logColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in shownLogs" :key="String(log.id)">
            <td v-for="column in logColumns" :key="column">{{ log[column as keyof typeof log] ?? '—' }}</td>
          </tr>
          <tr v-if="!shownLogs.length">
            <td :colspan="logColumns.length" class="empty-state">暂无保养记录，检修确认完工后自动写入</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot"><span>共 {{ shownLogs.length }} / {{ logs.length }} 条保养记录（同一检修编号再报只覆盖最新版）</span></footer>
    </div>

    <div v-show="activeTab === 'plans'">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in planColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="plan in shownPlans" :key="String(plan.id)" :class="{ overdueRow: planOverdue(plan) }">
            <td v-for="column in planColumns" :key="column">
              {{ plan[column as keyof typeof plan] ?? '—' }}
              <i v-if="column === '计划状态' && planOverdue(plan)" class="tag warn">已超期未保养</i>
            </td>
          </tr>
          <tr v-if="!shownPlans.length">
            <td :colspan="planColumns.length" class="empty-state">暂无保养计划，检修确认完工后自动排入待保养</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot"><span>共 {{ shownPlans.length }} / {{ plans.length }} 条保养计划（同一设备只留最新一条待保养）</span></footer>
    </div>

    <footer class="page-foot">
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="actionMessage" class="ok-text">{{ actionMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  careLogs,
  carePlans,
  downloadEntries,
  listEntries,
  moduleMeta,
  resetModule,
  runAction as applyAction,
} from '@/api/local-service'
import { isOverdue } from '@/data/date'
import type { CareLog, CarePlan, EntryRow } from '@/data/types'

const meta = moduleMeta('device')
const deviceColumns = meta.fields
const logColumns = ['设备编号', '设备名称', '保养日期', '更换部件', '处理结论', '来源检修编号', '检修班组']
const planColumns = ['设备编号', '设备名称', '计划保养日', '计划状态', '来源检修编号', '登记说明', '保养日期']
const tabs = [
  { key: 'device', label: '设备台账' },
  { key: 'logs', label: '保养记录（维保台账）' },
  { key: 'plans', label: '保养计划' },
] as const

const activeTab = ref<(typeof tabs)[number]['key']>('device')
const devices = ref<EntryRow[]>([])
const logs = ref<CareLog[]>([])
const plans = ref<CarePlan[]>([])
const keyword = ref('')
const errorMessage = ref('')
const actionMessage = ref('')

const tabHeaders = computed(() => [
  { key: 'device', label: '设备台账', count: devices.value.length },
  { key: 'logs', label: '保养记录（维保台账）', count: logs.value.length },
  { key: 'plans', label: '保养计划', count: plans.value.length },
] as const)

const shownDevices = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) {
    return devices.value
  }
  return devices.value.filter((row) =>
    `${row['设备编号']}${row['设备名称']}${row['所属舱室']}`.includes(kw),
  )
})
const shownLogs = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) {
    return logs.value
  }
  return logs.value.filter((row) => `${row['设备编号']}${row['设备名称']}${row['来源检修编号']}`.includes(kw))
})
const shownPlans = computed(() => {
  const kw = keyword.value.trim()
  if (!kw) {
    return plans.value
  }
  return plans.value.filter((row) => `${row['设备编号']}${row['设备名称']}${row['来源检修编号']}`.includes(kw))
})

const statCards = computed(() => [
  { label: '设备总数', value: devices.value.length, warn: false },
  { label: '运行中', value: devices.value.filter((d) => d.status === '运行中').length, warn: false },
  { label: '待保养（同步检修完工）', value: devices.value.filter((d) => d.status === '待保养').length, warn: true },
  { label: '已保养', value: devices.value.filter((d) => d.status === '已保养').length, warn: false },
  { label: '保养记录数', value: logs.value.length, warn: false },
  { label: '待保养计划', value: plans.value.filter((p) => p.计划状态 === '待保养').length, warn: true },
])

function planOverdue(plan: CarePlan): boolean {
  return plan.计划状态 === '待保养' && isOverdue(plan.计划保养日)
}

function completeCare(row: EntryRow) {
  errorMessage.value = ''
  actionMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), '完成保养')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  actionMessage.value = result.message
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function resetAll() {
  resetModule(meta.key)
  reload()
}

function reload() {
  errorMessage.value = ''
  devices.value = listEntries(meta.key).items
  logs.value = careLogs()
  plans.value = carePlans()
}

onMounted(reload)
</script>
