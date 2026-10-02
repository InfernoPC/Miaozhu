import { clipboard, ClipboardItem, nativeImage } from 'electron'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAnimated } from './library'

/** Node Buffers may sit on a SharedArrayBuffer, which Blob's types don't accept. */
const pngBlob = (b: Buffer) => new Blob([new Uint8Array(b)], { type: 'image/png' })

/**
 * One click, one copy. A still image goes on the clipboard as a picture; a GIF / APNG goes as
 * a file, the way Finder / Explorer copy it, so chat apps paste it and it keeps moving.
 * On Windows both fit in one item (verified in spike/clipboard-spike.cjs); on macOS a picture
 * would replace the file, so animated images go as the file only.
 */
export async function copyImage(abs: string): Promise<'image' | 'file'> {
  const fileUrl = pathToFileURL(abs).href
  if (isAnimated(abs)) {
    const item: Record<string, string | Blob> = { 'text/uri-list': fileUrl }
    if (process.platform === 'win32') {
      const frame = nativeImage.createFromPath(abs)
      if (!frame.isEmpty()) item['image/png'] = pngBlob(frame.toPNG())
    }
    await clipboard.write([new ClipboardItem(item)])
    return 'file'
  }
  const ext = extname(abs).toLowerCase()
  const png = ext === '.png' ? readFileSync(abs) : nativeImage.createFromPath(abs).toPNG()
  // A format nativeImage can't decode (e.g. some WebP): the file still pastes fine.
  if (!png.length) {
    await clipboard.write([new ClipboardItem({ 'text/uri-list': fileUrl })])
    return 'file'
  }
  await clipboard.write([new ClipboardItem({ 'image/png': pngBlob(png) })])
  return 'image'
}
