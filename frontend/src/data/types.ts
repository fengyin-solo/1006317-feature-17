/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 检修完工后落到设备台账上的保养记录（维保台账）。
export type CareLog = {
  id: number
  设备编号: string
  设备名称: string
  保养日期: string
  更换部件: string
  处理结论: string
  来源检修编号: string
  检修班组: string
}

// 每次完工顺手给保养计划排一条待保养；同一设备只保留最新一条未做。
export type CarePlan = {
  id: number
  设备编号: string
  设备名称: string
  计划保养日: string
  计划状态: '待保养' | '已保养'
  来源检修编号: string
  登记说明: string
  保养日期?: string
}
