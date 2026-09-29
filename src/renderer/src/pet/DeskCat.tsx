import type { PetRendererProps } from './renderer'
import './desk-cat.css'

/**
 * Original "desk-slapping cat" skin in minimal line art: a wide, low, bun-shaped cat peeking
 * over a slanted table edge. Everything is drawn level and rotated as one group, so paw slaps
 * move perpendicular to the edge. Paw rhythm per PetState lives in desk-cat.css.
 */
export function DeskCat({ state }: PetRendererProps) {
  return (
    <svg className={`desk-cat state-${state}`} viewBox="-6 0 232 190" width="210" height="172" aria-label="貓咪助手">
      <defs>
        {/* Only what is above the table edge is visible. */}
        <clipPath id="dc-above">
          <rect x="-60" y="-60" width="340" height="184" />
        </clipPath>
      </defs>

      <g transform="rotate(20 110 124)">
        <g clipPath="url(#dc-above)">
          <g className="dc-body">
            {/* Wide, low head: steep left side, long flat crown, small ears at both ends. */}
            <path
              className="dc-outline dc-fur"
              d="M48 160 L48 124 C44 92 62 70 88 64 C91 56 94 48 97 41 C102 47 107 54 112 60 C126 57 142 57 156 60 C161 53 166 46 172 40 C174 49 175 57 175 65 C188 76 193 100 191 124 L191 160 Z"
            />
            <g className="dc-eyes-open">
              <ellipse className="dc-eye" cx="99" cy="93" rx="3.4" ry="4" />
              <ellipse className="dc-eye" cx="120" cy="93" rx="3.4" ry="4" />
            </g>
            <path className="dc-eyes-closed dc-line" d="M94 94 Q99 97.5 104 94 M115 94 Q120 97.5 125 94" />
            <path className="dc-eyes-x dc-line" d="M96 90 L102 96 M102 90 L96 96 M117 90 L123 96 M123 90 L117 96" />
            <path className="dc-mouth dc-line" d="M104.5 100 Q107 103 109.5 100 Q112 103 114.5 100" />
            <ellipse className="dc-mouth-open" cx="109.5" cy="102.5" rx="3.4" ry="3.4" />
          </g>

          {/* Left paw overlaps the head's left edge; right paw presses its lower right. */}
          <g className="dc-paw dc-paw-left">
            <path className="dc-outline dc-fur" d="M33 162 L33 108 C33 94 57 94 57 108 L57 162" />
            <ellipse className="dc-pad" cx="45" cy="115" rx="5.5" ry="4.5" />
            <circle className="dc-bean" cx="38.5" cy="106.5" r="2.2" />
            <circle className="dc-bean" cx="45" cy="103.5" r="2.2" />
            <circle className="dc-bean" cx="51.5" cy="106.5" r="2.2" />
          </g>
          <g className="dc-paw dc-paw-right">
            <path className="dc-outline dc-fur" d="M148 162 L148 112 C148 98 172 98 172 112 L172 162" />
            <ellipse className="dc-pad" cx="160" cy="119" rx="5.5" ry="4.5" />
            <circle className="dc-bean" cx="153.5" cy="110.5" r="2.2" />
            <circle className="dc-bean" cx="160" cy="107.5" r="2.2" />
            <circle className="dc-bean" cx="166.5" cy="110.5" r="2.2" />
          </g>
        </g>

        {/* The table edge, with a paper halo so it stays visible on dark desktops. */}
        <line className="dc-edge-halo" x1="-40" y1="124" x2="260" y2="124" />
        <line className="dc-edge" x1="-40" y1="124" x2="260" y2="124" />

        <path className="dc-impact dc-impact-left dc-line" d="M25 116 L17 108 M23 124 L11 122 M31 106 L29 96" />
        <path className="dc-impact dc-impact-right dc-line" d="M180 116 L188 108 M182 124 L194 122 M174 106 L176 96" />

        <path className="dc-sweat" d="M164 70 C161 76 161 79 164 81 C167 79 167 76 164 70 Z" />
        <text className="dc-zzz" x="164" y="32">z</text>
        <text className="dc-zzz dc-zzz-2" x="178" y="16">Z</text>
      </g>
    </svg>
  )
}
