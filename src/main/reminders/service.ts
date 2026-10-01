import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { DndView, DueReminder, ReminderRepeat, ReminderView } from '@shared/types'
import { readJson, writeJson } from '../util/json-file'

interface Reminder extends ReminderView {
  createdAt: string
  /** Set once it's been shown and is waiting for the user (dismiss / snooze). */
  firedAt?: string
}

interface StateFile {
  reminders: Reminder[]
  dndUntil?: string
  quietStart?: string
  quietEnd?: string
}

/** Missed reminders older than this are dropped quietly rather than announced. */
const MISSED_GRACE_MS = 24 * 60 * 60_000
const TICK_MS = 15_000

const statePath = () => join(app.getPath('userData'), 'reminders.json')

/** The next time a repeating reminder fires after `from`, in local time. */
export function nextOccurrence(at: Date, repeat: ReminderRepeat, after: Date): Date | null {
  if (repeat === 'none') return null
  const d = new Date(at)
  // Step from the original time so the hour and minute never drift.
  while (d <= after) {
    if (repeat === 'daily') d.setDate(d.getDate() + 1)
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7)
    else if (repeat === 'weekdays') {
      do d.setDate(d.getDate() + 1)
      while (d.getDay() === 0 || d.getDay() === 6)
    } else {
      const day = at.getDate()
      d.setDate(1)
      d.setMonth(d.getMonth() + 1)
      // Clamp the 31st to the last day of shorter months.
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
    }
  }
  return d
}

/** "2026-10-01 15:00", "2026-10-01T15:00" or a full ISO string; no offset means local time. */
export function parseLocalTime(text: string): Date | null {
  const m = text.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (m) {
    const [, y, mo, d, h, mi, s] = m.map(Number)
    const date = new Date(y, mo - 1, d, h, mi, s || 0)
    return date.getMonth() === mo - 1 ? date : null
  }
  const iso = new Date(text)
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(text.trim()) && !isNaN(iso.getTime()) ? iso : null
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function inQuietHours(now: Date, start?: string, end?: string): boolean {
  if (!start || !end) return false
  const t = now.getHours() * 60 + now.getMinutes()
  const a = minutesOf(start)
  const b = minutesOf(end)
  // A window like 22:00–08:00 wraps past midnight.
  return a <= b ? t >= a && t < b : t >= a || t < b
}

export interface ReminderServiceOptions {
  now?: () => Date
  /** Called when a reminder should be shown (pet bubble + system notification). */
  deliver: (r: DueReminder) => void
}

/**
 * Stores reminders, fires them on time, catches up on ones missed while the app was closed,
 * and holds them during do-not-disturb (manual or quiet hours) until it ends.
 */
export class ReminderService {
  private state: StateFile = readJson<StateFile>(statePath(), { reminders: [] })
  private timer: NodeJS.Timeout | null = null
  private now: () => Date
  private deliver: (r: DueReminder) => void

  constructor(opts: ReminderServiceOptions) {
    this.now = opts.now ?? (() => new Date())
    this.deliver = opts.deliver
  }

  start(): void {
    // Anything that came due while the app was closed: announce recent ones, drop stale ones.
    // A repeating reminder rolls forward to its latest occurrence, which may itself be recent.
    const now = this.now()
    for (const r of [...this.state.reminders]) {
      if (r.firedAt || now.getTime() - new Date(r.at).getTime() <= MISSED_GRACE_MS) continue
      if (r.repeat === 'none') {
        this.state.reminders = this.state.reminders.filter((x) => x.id !== r.id)
        continue
      }
      let latest = new Date(r.at)
      for (let next = nextOccurrence(latest, r.repeat, latest); next && next <= now; next = nextOccurrence(next, r.repeat, next)) latest = next
      r.at = (now.getTime() - latest.getTime() <= MISSED_GRACE_MS ? latest : nextOccurrence(latest, r.repeat, now)!).toISOString()
    }
    this.save()
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  list(): ReminderView[] {
    return this.state.reminders
      .filter((r) => !r.firedAt)
      .sort((a, b) => a.at.localeCompare(b.at))
      .map(({ id, text, at, repeat }) => ({ id, text, at, repeat }))
  }

  add(text: string, at: Date, repeat: ReminderRepeat = 'none'): ReminderView {
    const r: Reminder = { id: randomUUID().slice(0, 8), text: text.trim(), at: at.toISOString(), repeat, createdAt: this.now().toISOString() }
    this.state.reminders.push(r)
    this.save()
    return { id: r.id, text: r.text, at: r.at, repeat }
  }

  cancel(id: string): boolean {
    const before = this.state.reminders.length
    this.state.reminders = this.state.reminders.filter((r) => r.id !== id)
    this.save()
    return this.state.reminders.length < before
  }

  dismiss(id: string): void {
    const r = this.state.reminders.find((x) => x.id === id)
    if (r) this.advance(r)
    this.save()
  }

  snooze(id: string, minutes: number): void {
    const r = this.state.reminders.find((x) => x.id === id)
    if (!r) return
    // A snoozed repeating reminder is fired once more as a one-off copy; the series continues.
    if (r.repeat !== 'none') {
      this.advance(r)
      this.state.reminders.push({ ...r, id: randomUUID().slice(0, 8), repeat: 'none', firedAt: undefined, at: new Date(this.now().getTime() + minutes * 60_000).toISOString() })
    } else {
      r.firedAt = undefined
      r.at = new Date(this.now().getTime() + minutes * 60_000).toISOString()
    }
    this.save()
  }

  // ── Do-not-disturb ──────────────────────────────────────────────────────

  dnd(): DndView {
    return { until: this.state.dndUntil, quietStart: this.state.quietStart, quietEnd: this.state.quietEnd, active: this.dndActive() }
  }

  setDnd(minutes: number | null): DndView {
    this.state.dndUntil = minutes ? new Date(this.now().getTime() + minutes * 60_000).toISOString() : undefined
    this.save()
    this.tick()
    return this.dnd()
  }

  setQuietHours(start: string | null, end: string | null): DndView {
    const valid = (v: string | null) => (v && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined)
    this.state.quietStart = valid(start)
    this.state.quietEnd = valid(end)
    this.save()
    return this.dnd()
  }

  private dndActive(): boolean {
    const now = this.now()
    if (this.state.dndUntil && new Date(this.state.dndUntil) > now) return true
    return inQuietHours(now, this.state.quietStart, this.state.quietEnd)
  }

  // ── Firing ──────────────────────────────────────────────────────────────

  /** Fires everything due, unless do-not-disturb is on (then they wait for the next tick after it). */
  tick(): void {
    if (this.dndActive()) return
    const now = this.now()
    let changed = false
    for (const r of this.state.reminders) {
      if (r.firedAt || new Date(r.at) > now) continue
      r.firedAt = now.toISOString()
      changed = true
      const late = now.getTime() - new Date(r.at).getTime() > 2 * TICK_MS
      this.deliver({ id: r.id, text: r.text, at: r.at, repeat: r.repeat, late })
    }
    if (changed) this.save()
  }

  /** Moves a repeating reminder to its next time, or removes a one-off. */
  private advance(r: Reminder): void {
    const next = nextOccurrence(new Date(r.at), r.repeat, this.now())
    if (next) {
      r.at = next.toISOString()
      r.firedAt = undefined
    } else {
      this.state.reminders = this.state.reminders.filter((x) => x.id !== r.id)
    }
  }

  private save(): void {
    writeJson(statePath(), this.state)
  }
}
