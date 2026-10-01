import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { DueReminder } from '@shared/types'
import { inQuietHours, nextOccurrence, parseLocalTime, ReminderService } from '../src/main/reminders/service'
import { findTool } from '../src/main/tools'
import { reminderTools } from '../src/main/tools/reminders'
import type { ToolContext } from '../src/main/tools/types'
import { makeSandbox, type Sandbox } from './helpers/sandbox'

let sb: Sandbox
afterAll(() => sb?.cleanup())

/** A service on a clock the test moves by hand. */
function setup(start = new Date(2026, 9, 1, 9, 0)) {
  let now = start
  const delivered: DueReminder[] = []
  const service = new ReminderService({ now: () => now, deliver: (r) => delivered.push(r) })
  return {
    service,
    delivered,
    at: (d: Date) => {
      now = d
      service.tick()
    },
    advance: (minutes: number) => {
      now = new Date(now.getTime() + minutes * 60_000)
      service.tick()
    },
    now: () => now
  }
}

beforeEach(() => {
  sb?.cleanup()
  sb = makeSandbox()
})

describe('times', () => {
  it('reads local date-times and refuses impossible dates', () => {
    expect(parseLocalTime('2026-10-01 15:30')).toEqual(new Date(2026, 9, 1, 15, 30))
    expect(parseLocalTime('2026-10-01T15:30')).toEqual(new Date(2026, 9, 1, 15, 30))
    expect(parseLocalTime('2026-02-30 10:00')).toBeNull()
    expect(parseLocalTime('tomorrow')).toBeNull()
    expect(parseLocalTime('2026-10-01T07:00:00Z')).toEqual(new Date('2026-10-01T07:00:00Z'))
  })

  it('repeats daily, on weekdays, weekly and monthly without drifting', () => {
    const fri = new Date(2026, 9, 2, 17, 0) // Friday
    expect(nextOccurrence(fri, 'daily', fri)).toEqual(new Date(2026, 9, 3, 17, 0))
    expect(nextOccurrence(fri, 'weekdays', fri)).toEqual(new Date(2026, 9, 5, 17, 0)) // Monday
    expect(nextOccurrence(fri, 'weekly', fri)).toEqual(new Date(2026, 9, 9, 17, 0))
    // The 31st becomes the last day of a shorter month.
    expect(nextOccurrence(new Date(2026, 0, 31, 9, 0), 'monthly', new Date(2026, 0, 31, 9, 0))).toEqual(new Date(2026, 1, 28, 9, 0))
    // Catching up after a long gap skips straight to the next future time.
    expect(nextOccurrence(fri, 'daily', new Date(2026, 9, 10, 12, 0))).toEqual(new Date(2026, 9, 10, 17, 0))
    expect(nextOccurrence(fri, 'none', fri)).toBeNull()
  })

  it('handles quiet hours that wrap past midnight', () => {
    expect(inQuietHours(new Date(2026, 9, 1, 23, 0), '22:00', '08:00')).toBe(true)
    expect(inQuietHours(new Date(2026, 9, 1, 7, 59), '22:00', '08:00')).toBe(true)
    expect(inQuietHours(new Date(2026, 9, 1, 8, 0), '22:00', '08:00')).toBe(false)
    expect(inQuietHours(new Date(2026, 9, 1, 13, 0), '12:00', '13:30')).toBe(true)
  })
})

describe('firing', () => {
  it('fires on time, once, and waits for the user to dismiss', () => {
    const t = setup()
    t.service.add('開會', new Date(2026, 9, 1, 9, 30))
    t.advance(29)
    expect(t.delivered).toEqual([])
    t.advance(1)
    expect(t.delivered).toMatchObject([{ text: '開會', late: false }])
    t.advance(5)
    expect(t.delivered).toHaveLength(1)
    expect(t.service.list()).toEqual([])
  })

  it('a repeating reminder comes back at its next time after dismiss', () => {
    const t = setup()
    const r = t.service.add('喝水', new Date(2026, 9, 1, 10, 0), 'daily')
    t.at(new Date(2026, 9, 1, 10, 0))
    t.service.dismiss(r.id)
    expect(t.service.list()[0].at).toBe(new Date(2026, 9, 2, 10, 0).toISOString())
  })

  it('snooze fires again later; snoozing a repeating one keeps the series', () => {
    const t = setup()
    const once = t.service.add('打電話', new Date(2026, 9, 1, 9, 1))
    const daily = t.service.add('站起來', new Date(2026, 9, 1, 9, 1), 'daily')
    t.advance(1)
    t.service.snooze(once.id, 10)
    t.service.snooze(daily.id, 10)
    t.advance(10)
    expect(t.delivered.map((d) => d.text)).toEqual(['打電話', '站起來', '打電話', '站起來'])
    // The daily series already moved on to tomorrow; only the snoozed copies are out.
    expect(t.service.list().map((r) => [r.text, r.repeat])).toEqual([['站起來', 'daily']])
    t.delivered.slice(2).forEach((d) => t.service.dismiss(d.id))
    expect(t.service.list().map((r) => [r.text, r.repeat])).toEqual([['站起來', 'daily']])
  })

  it('after a restart, announces recent missed reminders as late and drops old ones', () => {
    const first = setup(new Date(2026, 9, 1, 9, 0))
    first.service.add('剛錯過', new Date(2026, 9, 1, 9, 10))
    first.service.add('很久以前', new Date(2026, 9, 1, 9, 5))
    first.service.add('每天早會', new Date(2026, 9, 1, 9, 5), 'daily')

    // Two days later the app starts again: only the recent one is announced.
    let now = new Date(2026, 9, 2, 9, 9)
    const delivered: DueReminder[] = []
    const later = new ReminderService({ now: () => now, deliver: (r) => delivered.push(r) })
    later.start()
    later.stop()
    // Today's 9:05 occurrence of the daily one, and yesterday's 9:10 one-off (within 24 h).
    expect(delivered.map((d) => [d.text, d.late])).toEqual([
      ['剛錯過', true],
      ['每天早會', true]
    ])
    expect(delivered[1].at).toBe(new Date(2026, 9, 2, 9, 5).toISOString())
  })

  it('holds reminders during do-not-disturb and delivers them when it ends', () => {
    const t = setup()
    t.service.setDnd(60)
    t.service.add('簡報後回信', new Date(2026, 9, 1, 9, 30))
    t.advance(45)
    expect(t.delivered).toEqual([])
    expect(t.service.dnd().active).toBe(true)
    t.advance(16)
    expect(t.delivered).toMatchObject([{ text: '簡報後回信', late: true }])
  })

  it('respects quiet hours', () => {
    const t = setup(new Date(2026, 9, 1, 21, 0))
    t.service.setQuietHours('22:00', '08:00')
    t.service.add('明天要帶便當', new Date(2026, 9, 1, 23, 0))
    t.at(new Date(2026, 9, 2, 7, 0))
    expect(t.delivered).toEqual([])
    t.at(new Date(2026, 9, 2, 8, 0))
    expect(t.delivered).toHaveLength(1)
  })

  it('keeps reminders across restarts', () => {
    setup().service.add('存起來', new Date(2026, 9, 5, 9, 0), 'weekly')
    expect(setup().service.list()).toMatchObject([{ text: '存起來', repeat: 'weekly' }])
  })
})

describe('reminder tools', () => {
  const ctx = { signal: new AbortController().signal } as ToolContext
  const tools = (t: ReturnType<typeof setup>) => Object.fromEntries(reminderTools(t.service, t.now).map((x) => [x.spec.name, x]))

  it('sets reminders by clock time or minutes from now', async () => {
    const t = setup()
    const tool = tools(t)
    expect((await tool.set_reminder.run({ text: '開會', time: '2026-10-01 15:00' }, ctx)).summary).toContain('15:00')
    await tool.set_reminder.run({ text: '泡麵好了', in_minutes: 3 }, ctx)
    expect(t.service.list().map((r) => r.text)).toEqual(['泡麵好了', '開會'])
  })

  it('refuses times in the past and says what time it is now', async () => {
    const tool = tools(setup())
    await expect(tool.set_reminder.run({ text: 'x', time: '2026-10-01 08:00' }, ctx)).rejects.toThrow('已經過了')
    await expect(tool.set_reminder.run({ text: 'x', time: '明天三點' }, ctx)).rejects.toThrow('看不懂時間')
    await expect(tool.set_reminder.run({ text: 'x' }, ctx)).rejects.toThrow('time 或 in_minutes')
  })

  it('lists and cancels by id', async () => {
    const t = setup()
    const tool = tools(t)
    const r = t.service.add('取消我', new Date(2026, 9, 1, 12, 0))
    expect((await tool.list_reminders.run({}, ctx)).text).toContain(`${r.id}｜`)
    await tool.cancel_reminder.run({ id: r.id }, ctx)
    expect(t.service.list()).toEqual([])
    await expect(tool.cancel_reminder.run({ id: 'nope' }, ctx)).rejects.toThrow('找不到')
  })

  it('are not part of the static tool list (they need the running service)', () => {
    expect(findTool('set_reminder')).toBeUndefined()
  })
})
