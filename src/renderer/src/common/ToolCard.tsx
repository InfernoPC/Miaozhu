import type { MessagePart, ToolCallView } from '@shared/types'
import { Icon, type IconName } from './Icon'

const STATUS_ICON: Record<ToolCallView['status'], IconName> = {
  'waiting-approval': 'wait',
  running: 'gear',
  done: 'check',
  error: 'alert',
  denied: 'block'
}

const STATUS_TEXT: Partial<Record<ToolCallView['status'], string>> = {
  'waiting-approval': '等你確認',
  running: '進行中'
}

export function ToolCard({ tool }: { tool: ToolCallView }) {
  const note = STATUS_TEXT[tool.status] ?? tool.summary
  return (
    <div className={`tool-card tool-${tool.status}`}>
      <Icon name={STATUS_ICON[tool.status]} size={14} className={tool.status === 'running' ? 'spin' : ''} />
      <span className="tool-title">{tool.title}</span>
      {note && <span className="tool-note">{note}</span>}
    </div>
  )
}

type Group = { type: 'text'; text: string; key: string } | { type: 'tools'; tools: ToolCallView[]; key: string }

/** Consecutive tool calls read as one log block between paragraphs. */
export function groupParts(parts: MessagePart[]): Group[] {
  const groups: Group[] = []
  parts.forEach((p, i) => {
    const last = groups[groups.length - 1]
    if (p.type === 'text') groups.push({ type: 'text', text: p.text, key: `t${i}` })
    else if (last?.type === 'tools') last.tools.push(p.tool)
    else groups.push({ type: 'tools', tools: [p.tool], key: `g${i}` })
  })
  return groups
}

export function ToolLog({ tools }: { tools: ToolCallView[] }) {
  return (
    <div className="tool-log">
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} />
      ))}
    </div>
  )
}
