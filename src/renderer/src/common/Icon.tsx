/**
 * Line icons drawn with the same pen as the cat: round caps, one stroke weight, currentColor.
 * Replaces emoji so the UI reads as one hand-drawn set in both themes.
 */
const PATHS = {
  check: 'M5 12.5l4.2 4L19 7',
  cross: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  block: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17M6 18L18 6',
  wait: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17M12 7.5V12l3 2',
  alert: 'M12 4l9 15.5H3zM12 10v4M12 17v.2',
  file: 'M7 3.5h7l4 4V20.5H7zM14 3.5v4h4',
  image: 'M4 5.5h16v13H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.2v.1',
  folder: 'M3.5 6.5h6l2 2h9v10h-17z',
  send: 'M4.5 12h13M12.5 6.5L18 12l-5.5 5.5',
  paw: 'M8 10.5a1.8 2.2 0 1 0 0.01 0M16 10.5a1.8 2.2 0 1 0 0.01 0M12 8a1.8 2.2 0 1 0 0.01 0M12 13c-3 0-4.5 2.3-4.5 4s1.6 2.5 4.5 2.5 4.5-.8 4.5-2.5-1.5-4-4.5-4',
  trash: 'M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13',
  plus: 'M12 5v14M5 12h14',
  lock: 'M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  camera: 'M3.5 7.5h4l1.5-2.5h6l1.5 2.5h4v12h-17zM12 10a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 1 0 0-6.4',
  crop: 'M7 3.5V17h13.5M3.5 7H17v13.5',
  menu: 'M4 7h16M4 12h16M4 17h10',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8',
  sweep: 'M14 4l-6.5 9M5 14.5l6 3.5M4 20.5l2-5 5.5 3-1 2.5z'
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** The cat's head in the same line art, used as the app mark in window headers. */
export function CatMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="cat-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M4 27c0-7 2.5-11.5 6-13.5L10 5l6 5.5c1.5-.3 2.5-.3 4 0L26 5l.2 8.5C29.5 15.5 30 20 30 27z"
        className="cat-mark-head"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="13" cy="19.5" r="1.4" fill="currentColor" />
      <circle cx="21" cy="19.5" r="1.4" fill="currentColor" />
      <path d="M15 22.5q1 1.2 2 0q1 1.2 2 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
