<template>
  <section class="page" data-module="careledger">
    <header class="page-head">
      <div>
        <h2>维保台账</h2>
        <p class="page-desc">
          检修处理结论的落地台账：检修完工按「来源检修编号」同步归档，同一记录再报只覆盖最新版；
          早年漏登记的事项没有原编号，另起 WBLR- 补录行并写明原因。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出维保台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">台账总条数</span>
        <strong class="stat-value">{{ rows.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检修完工归档</span>
        <strong class="stat-value">{{ archivedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">原编号迁移</span>
        <strong class="stat-value">{{ migratedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">早年漏登记补录</span>
        <strong class="stat-value alert-value">{{ supplementCount }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item grow">
        <span>关键字</span>
        <input v-model="keyword" placeholder="按台账编号 / 来源检修编号 / 对象 / 班组 / 结论检索" />
      </label>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>登记方式</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] !== '' && row[column] !== undefined ? row[column] : '—' }}</td>
          <td>
            <span class="status-chip" :class="row.登记方式 === '早年漏登记补录' ? 'delayed' : 'done'">
              {{ row.登记方式 }}
            </span>
          </td>
        </tr>
        <tr v-if="!filteredRows.length">
          <td :colspan="columns.length + 1" class="empty-state">没有匹配的维保台账记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filteredRows.length }} 条；同编号重复上报按覆盖处理，不会出现两版并排</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import { listRows } from '@/data/local-store'
import { CARE_LEDGER_KEY } from '@/data/maintenance-model'

const columns = ['台账编号', '来源检修编号', '检修对象', '检修班组', '检修类别', '完工日期', '更换部件', '材料批次号', '处理结论', '备注']
const keyword = ref('')

const rows = computed(() => listRows(CARE_LEDGER_KEY))

const filteredRows = computed(() => {
  const word = keyword.value.trim()
  if (!word) {
    return rows.value
  }
  return rows.value.filter((row) =>
    ['台账编号', '来源检修编号', '检修对象', '检修班组', '处理结论', '更换部件', '材料批次号'].some((field) =>
      String(row[field] ?? '').includes(word),
    ),
  )
})

const archivedCount = computed(() => rows.value.filter((row) => row.登记方式 === '检修完工同步').length)
const migratedCount = computed(() => rows.value.filter((row) => row.登记方式 === '原编号迁移').length)
const supplementCount = computed(() => rows.value.filter((row) => row.登记方式 === '早年漏登记补录').length)

function exportRows() {
  downloadEntries(CARE_LEDGER_KEY)
}
</script>
