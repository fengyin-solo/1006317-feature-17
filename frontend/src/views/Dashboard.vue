<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，并同步设施检修当月进度统计。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <h3 class="block-title">设施检修进度（{{ scopeText }}）</h3>
    <div class="stat-row">
      <article v-for="item in progressCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ warn: item.warn }">{{ item.value }}</strong>
      </article>
    </div>
    <p class="status-legend">
      <span class="legend-item">看板合计 {{ maintenanceStat.看板合计 }} 条，与检修明细「仅看板口径」条数一致</span>
      <a class="legend-item link" href="/maintenance">进入进度看板 →</a>
    </p>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import {
  currentScope,
  maintenanceStats,
  scopeLabel,
} from '@/api/maintenance-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const scope = currentScope()
const maintenanceStat = ref(maintenanceStats(scope))
const scopeText = computed(() => scopeLabel(scope))

const progressCards = computed(() => [
  { label: '待开工', value: maintenanceStat.value.待开工, warn: false },
  { label: '已拖过计划工期', value: maintenanceStat.value.已逾期, warn: maintenanceStat.value.已逾期 > 0 },
  { label: '延期已批还没动', value: maintenanceStat.value.已延期未动, warn: maintenanceStat.value.已延期未动 > 0 },
  { label: '检修中', value: maintenanceStat.value.检修中, warn: false },
  { label: '本月完工', value: maintenanceStat.value.本月完工, warn: false },
])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  maintenanceStat.value = maintenanceStats(scope)
}

onMounted(refresh)
</script>
