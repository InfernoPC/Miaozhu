import type { AttachmentView } from '@shared/types'
import { Icon } from './Icon'

export function AttachmentChips({ items, onRemove }: { items: AttachmentView[]; onRemove?: (path: string) => void }) {
  if (!items.length) return null
  return (
    <div className="chips">
      {items.map((a) => (
        <span key={a.path} className="chip" title={a.path}>
          <Icon name={a.kind} size={13} />
          <span className="chip-name">{a.name}</span>
          {onRemove && (
            <button type="button" className="chip-x" onClick={() => onRemove(a.path)} aria-label={`移除 ${a.name}`}>
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  )
}

/** Paths of files dropped from the OS (Finder / Explorer). */
export function droppedPaths(ev: React.DragEvent): string[] {
  return [...ev.dataTransfer.files].map((f) => window.api.files.pathOf(f)).filter(Boolean)
}

/**
 * Files or a screenshot pasted into an input (⌘V / Ctrl+V). Returns null for an ordinary
 * text paste, which is left to the input; copied text wins over the image some apps add.
 */
export function pastedAttachments(ev: React.ClipboardEvent): Promise<AttachmentView[]> | null {
  const files = [...ev.clipboardData.files]
  if (!files.length) return null
  const paths = files.map((f) => window.api.files.pathOf(f)).filter(Boolean)
  if (!paths.length && ev.clipboardData.getData('text/plain').trim()) return null
  ev.preventDefault()
  if (paths.length) return window.api.agent.describeAttachments(paths)
  return window.api.capture.pasteImage().then((a) => (a ? [a] : []))
}
