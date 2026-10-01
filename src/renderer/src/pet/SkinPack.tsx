import { useEffect, useRef } from 'react'
// The light player: SVG renderer only, no expressions, so no eval under the app's CSP.
import lottie from 'lottie-web/build/player/lottie_light'
import type { LoadedSkin, PetState } from '@shared/types'

/** Draws an installed skin pack; states it doesn't define fall back to idle. */
export function SkinPack({ skin, state }: { skin: LoadedSkin; state: PetState }) {
  const entry = skin.states[state] ?? skin.states.idle!
  const box = { width: skin.width, height: skin.height }

  if (entry.kind === 'image') {
    return <img className="skin-pack" src={entry.src} alt="貓咪助手" draggable={false} style={box} />
  }
  return <LottieState key={state} data={entry.data} style={box} />
}

function LottieState({ data, style }: { data: unknown; style: { width: number; height: number } }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const anim = lottie.loadAnimation({ container: ref.current, renderer: 'svg', loop: true, autoplay: true, animationData: data })
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduce.matches) anim.goToAndStop(0, true)
    return () => anim.destroy()
  }, [data])
  return <div ref={ref} className="skin-pack" aria-label="貓咪助手" style={style} />
}
