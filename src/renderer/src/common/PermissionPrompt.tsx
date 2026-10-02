import type { PermissionRequest, ToolRisk } from '@shared/types'
import { Icon, type IconName } from './Icon'
import './permission.css'

/** What the cat is asking for, in the user's terms. */
const RISK: Record<ToolRisk, { ask: string; icon: IconName }> = {
  read: { ask: '可以讓我讀這個嗎？', icon: 'file' },
  network: { ask: '可以讓我連這個網址嗎？', icon: 'send' },
  screen: { ask: '可以讓我看一下螢幕嗎？', icon: 'image' },
  write: { ask: '可以讓我修改檔案嗎？', icon: 'file' },
  execute: { ask: '可以讓我執行這個指令嗎？', icon: 'gear' }
}

/** Confirmation for a tool call; shared by the pet balloon and the chat window. */
export function PermissionPrompt({ request, compact }: { request: PermissionRequest; compact?: boolean }) {
  const respond = (d: 'once' | 'session' | 'deny') => void window.api.agent.respondPermission(request.id, d)
  const risky = request.risk === 'write' || request.risk === 'execute'
  const { ask, icon } = RISK[request.risk]
  return (
    <div className={`perm ${risky ? 'perm-risky' : ''} ${compact ? 'perm-compact' : ''}`} role="alertdialog" aria-label={ask}>
      {/* Scrolls on its own when space is short, so the buttons below stay visible. */}
      <div className="perm-body">
        <p className="perm-ask">{ask}</p>
        <div className="perm-what">
          <Icon name={icon} size={15} />
          <span>{request.title}</span>
        </div>
        {request.reason && <p className="perm-reason">{request.reason}</p>}
        {request.detail && request.detail !== request.title && <pre className="perm-detail">{request.detail}</pre>}
      </div>
      <div className="perm-actions">
        <button className="primary" onClick={() => respond('once')} autoFocus>
          允許
        </button>
        <button onClick={() => respond('session')} title="清除對話前，同類操作不再詢問">
          這次對話都允許
        </button>
        <button className="quiet" onClick={() => respond('deny')}>
          不要
        </button>
      </div>
    </div>
  )
}
