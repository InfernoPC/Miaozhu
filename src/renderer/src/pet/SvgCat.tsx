import type { PetRendererProps } from './renderer'
import './cat.css'

/** Placeholder cat drawn with SVG + CSS animations, one animation set per PetState. */
export function SvgCat({ state }: PetRendererProps) {
  return (
    <svg className={`cat state-${state}`} viewBox="0 0 200 200" width="170" height="170" aria-label="貓咪助手">
      <path className="tail" d="M148 158 C188 156 194 112 170 94" />
      <ellipse className="body" cx="100" cy="152" rx="56" ry="38" />
      <ellipse className="belly" cx="100" cy="160" rx="30" ry="22" />
      <ellipse className="paw" cx="80" cy="186" rx="13" ry="8" />
      <ellipse className="paw" cx="120" cy="186" rx="13" ry="8" />

      <g className="head">
        <g className="ear ear-left">
          <polygon className="fur" points="58,74 66,26 98,56" />
          <polygon className="ear-inner" points="66,66 70,40 88,58" />
        </g>
        <g className="ear ear-right">
          <polygon className="fur" points="142,74 134,26 102,56" />
          <polygon className="ear-inner" points="134,66 130,40 112,58" />
        </g>
        <circle className="fur" cx="100" cy="96" r="46" />
        <path className="stripe" d="M100 52 L100 66 M86 55 L90 67 M114 55 L110 67" />

        <g className="eyes-open">
          <ellipse className="eye" cx="82" cy="94" rx="6.5" ry="8.5" />
          <ellipse className="eye" cx="118" cy="94" rx="6.5" ry="8.5" />
          <circle className="eye-shine" cx="84" cy="91" r="2" />
          <circle className="eye-shine" cx="120" cy="91" r="2" />
        </g>
        <path className="eyes-closed" d="M75 95 Q82 100 89 95 M111 95 Q118 100 125 95" />
        <path className="eyes-sad" d="M75 92 L89 97 M125 92 L111 97" />

        <ellipse className="blush" cx="70" cy="110" rx="7" ry="4" />
        <ellipse className="blush" cx="130" cy="110" rx="7" ry="4" />
        <polygon className="nose" points="96,106 104,106 100,111" />
        <path className="mouth" d="M92 114 Q96 119 100 114 Q104 119 108 114" />
        <ellipse className="mouth-open" cx="100" cy="117" rx="5" ry="4" />
        <path className="whisker" d="M60 104 L40 100 M60 110 L40 112 M140 104 L160 100 M140 110 L160 112" />
      </g>

      <g className="thinking-dots">
        <circle cx="150" cy="40" r="4" />
        <circle cx="163" cy="30" r="5" />
        <circle cx="178" cy="18" r="6" />
      </g>
      <text className="zzz" x="146" y="44">z</text>
      <text className="zzz zzz-2" x="160" y="30">Z</text>
    </svg>
  )
}
