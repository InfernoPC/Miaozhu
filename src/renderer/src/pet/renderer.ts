import type { ComponentType } from 'react'
import type { PetSkinId, PetState } from '@shared/types'
import { DeskCat } from './DeskCat'
import { SvgCat } from './SvgCat'

/**
 * A pet renderer draws the character for a given state. Built-in skins are SVG + CSS;
 * Lottie / Live2D / VRM skin packs (DESIGN.md §4.1) plug in behind this same contract.
 */
export interface PetRendererProps {
  state: PetState
}

export const SKINS: Record<PetSkinId, ComponentType<PetRendererProps>> = {
  desk: DeskCat,
  classic: SvgCat
}
