import { net, protocol } from 'electron'
import { type FSWatcher, watch } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { GalleryTagStatus } from '@shared/types'
import type { PermissionGuard } from '../permissions/guard'
import { createProvider } from '../providers'
import type { SettingsStore } from '../settings/store'
import { DATA_DIR, GalleryLibrary, isGalleryImage } from './library'
import { GalleryTags } from './tags'

export const GALLERY_SCHEME = 'miaozhu-gallery'
const CHANGE_DEBOUNCE_MS = 400
const AUTO_TAG_DELAY_MS = 5_000
const FIRST_AUTO_TAG_MS = 60_000

/** Must run before the app is ready: lets pages load gallery images like ordinary URLs. */
export function registerGalleryScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: GALLERY_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
}

/** The gallery as the app runs it: images over its own protocol, folder watching, auto-tagging. */
export class GalleryService {
  readonly library: GalleryLibrary
  readonly tags: GalleryTags
  private watcher: FSWatcher | null = null
  private changeTimer: NodeJS.Timeout | null = null
  private tagTimer: NodeJS.Timeout | null = null

  constructor(
    private settings: SettingsStore,
    guard: PermissionGuard,
    private broadcast: (channel: string, payload?: unknown) => void
  ) {
    this.library = new GalleryLibrary(() => settings.galleryFolder())
    this.tags = new GalleryTags(this.library, {
      model: () => {
        const profile = settings.galleryTagProfile()
        return profile ? { profile, provider: createProvider(profile, settings.getApiKey(profile.id)) } : null
      },
      inSensitiveFolder: () => guard.isSensitivePath(this.library.root()),
      onStatus: (s: GalleryTagStatus) => broadcast('gallery:tag-status', s)
    })
  }

  start(): void {
    // miaozhu-gallery://img/<folder>/<file>: only images, only inside the gallery.
    protocol.handle(GALLERY_SCHEME, (req) => {
      try {
        const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '')
        if (!isGalleryImage(rel)) return new Response(null, { status: 404 })
        return net.fetch(pathToFileURL(this.library.resolve(rel)).toString())
      } catch {
        return new Response(null, { status: 404 })
      }
    })
    this.watch()
    if (this.settings.galleryAutoTag()) this.tagTimer = setTimeout(() => void this.tags.run(), FIRST_AUTO_TAG_MS)
  }

  stop(): void {
    this.watcher?.close()
    this.tags.stop()
    for (const t of [this.changeTimer, this.tagTimer]) if (t) clearTimeout(t)
  }

  /** After the folder setting changes. */
  restart(): void {
    this.tags.stop()
    this.watch()
    this.changed()
  }

  /** Re-renders open gallery windows, and tags new images when auto-tagging is on. */
  changed(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer)
    this.changeTimer = setTimeout(() => this.broadcast('gallery:changed'), CHANGE_DEBOUNCE_MS)
    if (!this.settings.galleryAutoTag()) return
    if (this.tagTimer) clearTimeout(this.tagTimer)
    this.tagTimer = setTimeout(() => void this.tags.run(), AUTO_TAG_DELAY_MS)
  }

  /** Picks up changes made outside the app (Finder, Explorer, a synced drive). */
  private watch(): void {
    this.watcher?.close()
    this.watcher = null
    try {
      this.watcher = watch(this.library.root(), { recursive: true }, (_event, name) => {
        // Our own tag index lives in the gallery; writing it must not count as a change.
        if (name && String(name).split(/[\\/]/)[0] === DATA_DIR) return
        this.changed()
      })
      this.watcher.on('error', () => this.watcher?.close())
    } catch {
      // Watching is a convenience: the window still refreshes after its own changes.
    }
  }
}
