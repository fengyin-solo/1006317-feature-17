<template>
  <section class="page" data-module="device">
    <header class="page-head">
      <div>
        <h2>设备台账管理</h2>
        <p class="page-desc">管廊设备台账，以及检修完工联动生成的保养计划与保养记录；同一检修重复上报只保留最新一版。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出当前清单</button>
      </div>
    </header>

    <div class="tab-row">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: tabKey === tab.key }"
        type="button"
        @click="tabKey = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="stat-row">
      <article v-for="item in activeStats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ alert: item.alert }">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item grow">
        <span>关键字</span>
        <input v-model="keyword" :placeholder="`按编号 / 名称 / 舱室 / 来源检修检索`" />
      </label>
    </form>

    <!-- 设备台账 -->
    <template v-if="tabKey === 'device'">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in deviceColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filtered(devices)" :key="String(row.id)">
            <td v-for="column in deviceColumns" :key="column">{{ row[column] ?? '—' }}</td>
            <td><span class="status-chip" :class="row.status === '待保养' ? 'delayed' : 'done'">{{ row.status }}</span></td>
            <td class="row-actions">
              <button v-if="row.status === '待保养'" class="link" type="button" @click="finishCare(row)">完成保养</button>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 保养计划：检修完工后自动添一条待保养 -->
    <template v-else-if="tabKey === 'plan'">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in planColumns" :key="column">{{ column }}</th>
            <th>计划状态</th>
            <th>逾期标记</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filtered(plans)" :key="String(row.id)">
            <td v-for="column in planColumns" :key="column">{{ row[column] ?? '—' }}</td>
            <td><span class="status-chip" :class="row.status === '待保养' ? 'todo' : 'done'">{{ row.计划状态 }}</span></td>
            <td>
              <em v-if="planOverdue(row)" class="mini-tag">已逾期</em>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="!filtered(plans).length">
            <td :colspan="planColumns.length + 2" class="empty-state">暂无保养计划，检修完工后会自动添加</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 保养记录：更换部件随检修完工同步过来 -->
    <template v-else>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in logColumns" :key="column">{{ column }}</th>
            <th>记录状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filtered(logs)" :key="String(row.id)">
            <td v-for="column in logColumns" :key="column">{{ row[column] ?? '—' }}</td>
            <td><span class="status-chip done">{{ row.status }}</span></td>
          </tr>
          <tr v-if="!filtered(logs).length">
            <td :colspan="logColumns.length + 1" class="empty-state">暂无保养记录，检修更换部件完工后自动生成</td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span>{{ activeFoot }}</span>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import { listRows } from '@/data/local-store'
import { completeDeviceCare, planIsOverdue } from '@/api/maintenance-service'
import { CARE_LOG_KEY, CARE_PLAN_KEY, DEVICE_KEY } from '@/data/maintenance-model'
import type { EntryRow } from '@/data/types'

const tabs = [
  { key: 'device', label: '设备台账' },
  { key: 'plan', label: '保养计划' },
  { key: 'log', label: '保养记录' },
] as const

const deviceColumns = ['设备编号', '设备名称', '设备型号', '所属舱室', '投运日期', '保养周期', '上次保养日']
const planColumns = ['保养计划编号', '设备编号', '设备名称', '来源检修编号', '计划保养日', '保养周期', '计划内容']
const logColumns = ['保养记录编号', '设备编号', '设备名称', '来源检修编号', '保养日期', '保养内容', '更换部件', '材料批次号', '检修班组']

const tabKey = ref<(typeof tabs)[number]['key']>('device')
const keyword = ref('')
const message = ref('')
const messageOk = ref(true)
const dataVersion = ref(0)

function touch() {
  dataVersion.value += 1
}

const devices = computed<EntryRow[]>(() => {
  void dataVersion.value
  return listRows(DEVICE_KEY)
})
const plans = computed<EntryRow[]>(() => {
  void dataVersion.value
  return listRows(CARE_PLAN_KEY)
})
const logs = computed<EntryRow[]>(() => {
  void dataVersion.value
  return listRows(CARE_LOG_KEY)
})

const FILTER_FIELDS: Record<string, string[]> = {
  device: ['设备编号', '设备名称', '设备型号', '所属舱室'],
  plan: ['保养计划编号', '设备编号', '设备名称', '来源检修编号'],
  log: ['保养记录编号', '设备编号', '设备名称', '来源检修编号', '更换部件', '材料批次号'],
}

function filtered(source: EntryRow[]): EntryRow[] {
  const word = keyword.value.trim()
  if (!word) {
    return source
  }
  return source.filter((row) => FILTER_FIELDS[tabKey.value].some((field) => String(row[field] ?? '').includes(word)))
}

const activeStats = computed(() => {
  if (tabKey.value === 'device') {
    const rows = devices.value
    return [
      { label: '运行中设备', value: rows.filter((row) => row.status === '运行中').length, alert: false },
      { label: '待保养设备', value: rows.filter((row) => row.status === '待保养').length, alert: true },
      { label: '已报废设备', value: rows.filter((row) => row.status === '已报废').length, alert: false },
    ]
  }
  if (tabKey.value === 'plan') {
    const rows = plans.value
    return [
      { label: '待保养计划', value: rows.filter((row) => row.status === '待保养').length, alert: true },
      { label: '已逾期计划', value: rows.filter((row) => planIsOverdue(row)).length, alert: true },
      { label: '已完成计划', value: rows.filter((row) => row.status === '已保养').length, alert: false },
    ]
  }
  const rows = logs.value
  return [
    { label: '保养记录总数', value: rows.length, alert: false },
    { label: '涉及更换部件', value: rows.filter((row) => String(row.更换部件 ?? '') !== '').length, alert: false },
    { label: '关联检修工单数', value: new Set(rows.map((row) => String(row.来源检修编号))).size, alert: false },
  ]
})

const activeFoot = computed(() => {
  if (tabKey.value === 'device') {
    return `共 ${filtered(devices.value).length} 台设备`
  }
  if (tabKey.value === 'plan') {
    return `共 ${filtered(plans.value).length} 条保养计划（检修完工自动添加）`
  }
  return `共 ${filtered(logs.value).length} 条保养记录（同一检修只留最新一版）`
})

function planOverdue(row: EntryRow): boolean {
  return planIsOverdue(row)
}

function finishCare(row: EntryRow) {
  const result = completeDeviceCare(Number(row.id))
  message.value = result.message
  messageOk.value = result.ok
  if (result.ok) {
    touch()
  }
}

function exportRows() {
  const key = tabKey.value === 'device' ? DEVICE_KEY : tabKey.value === 'plan' ? CARE_PLAN_KEY : CARE_LOG_KEY
  downloadEntries(key)
}
</script>
