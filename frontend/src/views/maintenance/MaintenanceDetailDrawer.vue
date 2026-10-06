<template>
  <div v-if="row" class="drawer-mask" @click.self="emit('close')">
    <aside class="drawer">
      <header class="drawer-head">
        <div>
          <h3>{{ row.检修编号 }} · {{ row.检修对象 }}</h3>
          <p class="drawer-sub">
            <span class="status-chip" :class="chipClass">{{ row.status }}</span>
            <span v-for="tag in tags" :key="tag" class="status-chip warn">{{ tag }}</span>
          </p>
        </div>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <dl class="detail-grid">
        <template v-for="field in fields" :key="field">
          <dt>{{ field }}</dt>
          <dd>{{ row[field] !== '' && row[field] !== undefined ? row[field] : '—' }}</dd>
        </template>
      </dl>

      <section class="drawer-flow">
        <h4>环节推进（只能逐段往下）</h4>
        <p class="flow-line">{{ flowHint }}</p>
        <div class="flow-actions">
          <button
            v-for="action in allowed"
            :key="action"
            class="btn"
            :class="{ primary: action === '确认完工' }"
            type="button"
            @click="onAction(action)"
          >
            {{ action }}
          </button>
        </div>
      </section>

      <section v-if="formVisible" class="drawer-form">
        <h4>{{ formTitle }}</h4>
        <label class="form-line">
          <span>更换部件</span>
          <input v-model="formPart" placeholder="如：轴承组件" />
        </label>
        <label class="form-line">
          <span>材料批次号</span>
          <input v-model="formBatch" placeholder="如：LOT-2026-1006" />
        </label>
        <label class="form-line column">
          <span>处理结论</span>
          <textarea v-model="formConclusion" rows="3" placeholder="本次检修/补报的处理结论，会落到维保台账" />
        </label>
        <div class="form-foot">
          <button class="btn ghost" type="button" @click="formVisible = false">取消</button>
          <button class="btn primary" type="button" @click="submitForm">提交</button>
        </div>
      </section>

      <p v-if="message" class="drawer-message" :class="{ error: !lastOk }">{{ message }}</p>
      <ul v-if="notes.length" class="drawer-notes">
        <li v-for="note in notes" :key="note">{{ note }}</li>
      </ul>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  maintenanceAllowedActions,
  maintenanceTags,
  runMaintenanceAction,
} from '@/api/maintenance-service'
import type { EntryRow } from '@/data/types'

const props = defineProps<{ row: EntryRow | null }>()
const emit = defineEmits<{ (event: 'close'): void; (event: 'changed'): void }>()

const fields = [
  '检修对象', '关联设备', '检修类别', '检修班组',
  '计划开始', '计划结束', '实际开工日', '完工日期',
  '更换部件', '材料批次号', '延期批复日', '处理结论', '回填说明',
]

const tags = computed(() => (props.row ? maintenanceTags(props.row) : []))
const allowed = computed(() => (props.row ? maintenanceAllowedActions(props.row) : []))

const chipClass = computed(() => {
  switch (props.row?.status) {
    case '待开工': return 'todo'
    case '检修中': return 'doing'
    case '已延期': return 'delayed'
    case '已完工': return 'done'
    default: return ''
  }
})

const flowHint = computed(() => {
  if (!props.row) {
    return ''
  }
  const status = String(props.row.status)
  if (status === '待开工') {
    return '当前在「待开工」段：先提交开工；确实赶不上计划工期可申请延期，不能直接报完工。'
  }
  if (status === '检修中') {
    return '当前在「检修中」段：可确认完工或申请延期，完工将同步维保台账与设备保养计划。'
  }
  if (status === '已延期') {
    return '当前在「已延期」段：延期已批复但还没动工，需先「延期开工」回到检修中，不能直接完工。'
  }
  return '已到终段「已完工」：不会重复推进；如部件/批次有更新，用「材料补报」覆盖最新一版。'
})

const message = ref('')
const lastOk = ref(true)
const notes = ref<string[]>([])
const formVisible = ref(false)
const formMode = ref<'finish' | 'report'>('finish')
const formPart = ref('')
const formBatch = ref('')
const formConclusion = ref('')

const formTitle = computed(() => (formMode.value === 'finish' ? '完工登记' : '材料补报（覆盖最新版）'))

watch(
  () => props.row?.id,
  () => {
    message.value = ''
    notes.value = []
    formVisible.value = false
    formPart.value = String(props.row?.更换部件 ?? '')
    formBatch.value = String(props.row?.材料批次号 ?? '')
    formConclusion.value = String(props.row?.处理结论 ?? '')
  },
)

function onAction(action: string) {
  message.value = ''
  notes.value = []
  if (action === '确认完工' || action === '材料补报') {
    formMode.value = action === '确认完工' ? 'finish' : 'report'
    formVisible.value = true
    return
  }
  const result = runMaintenanceAction(Number(props.row?.id), action)
  lastOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    emit('changed')
  }
}

function submitForm() {
  const result = runMaintenanceAction(Number(props.row?.id), formMode.value === 'finish' ? '确认完工' : '材料补报', {
    更换部件: formPart.value,
    材料批次号: formBatch.value,
    处理结论: formConclusion.value,
  })
  lastOk.value = result.ok
  message.value = result.message
  notes.value = result.notes ?? []
  if (result.ok) {
    formVisible.value = false
    emit('changed')
  }
}
</script>
