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
