import { useEffect, useRef, useState } from 'react'
import './snip.css'

interface Point {
  x: number
  y: number
}

/**
 * Region picker shown over a still of the screen (Windows; macOS uses its own picker).
 * Drag to select, Esc to cancel, Enter for the whole screen.
 */
export function Snip() {
  const [image, setImage] = useState<string | null>(null)
  const [start, setStart] = useState<Point | null>(null)
  const [end, setEnd] = useState<Point | null>(null)
  const sent = useRef(false)
  // Read in event handlers, which can run before the re-render that would update `start`.
  const startRef = useRef<Point | null>(null)

  const finish = (rect: { x: number; y: number; width: number; height: number } | null) => {
    if (sent.current) return
    sent.current = true
    window.api.snip.done(rect)
  }

  useEffect(() => window.api.snip.onImage(setImage), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(null)
      if (e.key === 'Enter') finish({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rect =
    start && end
      ? { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
      : null

  return (
    <div
      className="snip"
      style={image ? { backgroundImage: `url(${image})` } : undefined}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // Not an active pointer (synthetic events): dragging still works inside the window.
        }
        startRef.current = { x: e.clientX, y: e.clientY }
        setStart(startRef.current)
        setEnd(startRef.current)
      }}
      onPointerMove={(e) => startRef.current && setEnd({ x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = startRef.current
        startRef.current = null
        if (!s) return
        const r = { x: Math.min(s.x, e.clientX), y: Math.min(s.y, e.clientY), width: Math.abs(e.clientX - s.x), height: Math.abs(e.clientY - s.y) }
        // A plain click (no drag) starts over instead of sending a tiny picture.
        if (r.width > 4 && r.height > 4) finish(r)
        else setStart(null)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        finish(null)
      }}
    >
      {rect ? (
        <div className="snip-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <span className="snip-size">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
        </div>
      ) : (
        <div className="snip-dim" />
      )}
      {!start && <div className="snip-hint">拖曳選取要給喵助看的範圍　Enter 整個螢幕　Esc 取消</div>}
    </div>
  )
}
