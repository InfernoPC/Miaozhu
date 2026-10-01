import type { ReminderRepeat } from '@shared/types'
import type { ReminderService } from '../reminders/service'
import { parseLocalTime } from '../reminders/service'
import { ToolError, type ToolDef } from './types'

const REPEATS: ReminderRepeat[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly']
const REPEAT_LABEL: Record<ReminderRepeat, string> = { none: '', daily: '每天', weekdays: '每個工作日', weekly: '每週', monthly: '每月' }

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

const describe = (r: { id: string; text: string; at: string; repeat: ReminderRepeat }) =>
  `${r.id}｜${formatWhen(r.at)}${r.repeat !== 'none' ? `（${REPEAT_LABEL[r.repeat]}）` : ''}｜${r.text}`

/** Reminder tools; they only touch the app's own reminder list, so they don't ask first. */
export function reminderTools(service: ReminderService, now: () => Date = () => new Date()): ToolDef[] {
  const setReminder: ToolDef = {
    spec: {
      name: 'set_reminder',
      description:
        '設定提醒，時間到時貓咪會跳出來提醒使用者。相對時間（「10 分鐘後」）用 in_minutes；指定時間用 time（本地時間，格式 YYYY-MM-DD HH:mm）。兩者擇一。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '提醒內容，例如「3 點跟客戶開會」' },
          time: { type: 'string', description: '本地時間，例如 2026-10-01 15:00' },
          in_minutes: { type: 'number', description: '幾分鐘後提醒' },
          repeat: { type: 'string', enum: REPEATS, description: '重複：none、daily、weekdays（週一到週五）、weekly、monthly；預設 none' }
        },
        required: ['text']
      }
    },
    risk: 'read',
    title: (i) => `設定提醒：${String(i.text)}`,
    async run(i) {
      const current = now()
      let at: Date | null
      if (i.in_minutes !== undefined) {
        const m = Number(i.in_minutes)
        if (!(m > 0) || m > 60 * 24 * 366) throw new ToolError('in_minutes 必須是大於 0 的分鐘數')
        at = new Date(current.getTime() + m * 60_000)
      } else if (typeof i.time === 'string') {
        at = parseLocalTime(i.time)
        if (!at) throw new ToolError(`看不懂時間「${i.time}」，請用 YYYY-MM-DD HH:mm，例如 2026-10-01 15:00`)
      } else {
        throw new ToolError('請提供 time 或 in_minutes')
      }
      const repeat = (REPEATS.includes(i.repeat as ReminderRepeat) ? i.repeat : 'none') as ReminderRepeat
      if (at <= current && repeat === 'none') {
        throw new ToolError(`這個時間已經過了（現在是 ${formatWhen(current.toISOString())}），請確認日期或時間`)
      }
      const r = service.add(String(i.text), at, repeat)
      return { text: `已設定提醒：${describe(r)}`, summary: `${formatWhen(r.at)}${repeat !== 'none' ? `，${REPEAT_LABEL[repeat]}` : ''}` }
    }
  }

  const listReminders: ToolDef = {
    spec: { name: 'list_reminders', description: '列出所有尚未到期的提醒（含編號，取消時要用）。', parameters: { type: 'object', properties: {} } },
    risk: 'read',
    title: () => '查看提醒',
    async run() {
      const list = service.list()
      return { text: list.length ? `現在是 ${formatWhen(now().toISOString())}。\n${list.map(describe).join('\n')}` : '目前沒有任何提醒', summary: `${list.length} 個提醒` }
    }
  }

  const cancelReminder: ToolDef = {
    spec: {
      name: 'cancel_reminder',
      description: '取消一個提醒。先用 list_reminders 找到編號。',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '提醒編號' } }, required: ['id'] }
    },
    risk: 'read',
    title: (i) => `取消提醒 ${String(i.id)}`,
    async run(i) {
      if (!service.cancel(String(i.id))) throw new ToolError(`找不到編號 ${String(i.id)} 的提醒，請先用 list_reminders 查看`)
      return { text: '已取消', summary: '已取消' }
    }
  }

  return [setReminder, listReminders, cancelReminder]
}
