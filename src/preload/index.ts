import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AgentEvent, AttachmentView, DesktopApi, DueReminder, GalleryTagStatus, PetSkinId, UpdateStatus } from '@shared/types'

const api: DesktopApi = {
  agent: {
    send: (text, attachments) => ipcRenderer.invoke('agent:send', text, attachments),
    respondPermission: (id, decision) => ipcRenderer.invoke('agent:respondPermission', id, decision),
    pendingPermissions: () => ipcRenderer.invoke('agent:pendingPermissions'),
    describeAttachments: (paths) => ipcRenderer.invoke('agent:describeAttachments', paths),
    cancel: () => ipcRenderer.invoke('agent:cancel'),
    history: () => ipcRenderer.invoke('agent:history'),
    clear: () => ipcRenderer.invoke('agent:clear'),
    onEvent: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, event: AgentEvent) => cb(event)
      ipcRenderer.on('agent:event', listener)
      return () => ipcRenderer.removeListener('agent:event', listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    saveProfile: (input) => ipcRenderer.invoke('settings:saveProfile', input),
    deleteProfile: (id) => ipcRenderer.invoke('settings:deleteProfile', id),
    setActive: (id) => ipcRenderer.invoke('settings:setActive', id),
    test: (input) => ipcRenderer.invoke('settings:test', input),
    listModels: (input) => ipcRenderer.invoke('settings:listModels', input),
    connectOpenRouter: (input) => ipcRenderer.invoke('settings:connectOpenRouter', input),
    cancelConnect: () => ipcRenderer.invoke('settings:cancelConnect'),
    addAllowedFolder: () => ipcRenderer.invoke('settings:addAllowedFolder'),
    removeAllowedFolder: (path) => ipcRenderer.invoke('settings:removeAllowedFolder', path),
    saveSearch: (input) => ipcRenderer.invoke('settings:saveSearch', input),
    testSearch: (input) => ipcRenderer.invoke('settings:testSearch', input),
    openAuditLog: () => ipcRenderer.invoke('settings:openAuditLog'),
    savePersona: (text) => ipcRenderer.invoke('settings:savePersona', text),
    savePlaces: (places) => ipcRenderer.invoke('settings:savePlaces', places),
    addSensitiveFolder: () => ipcRenderer.invoke('settings:addSensitiveFolder'),
    removeSensitiveFolder: (path) => ipcRenderer.invoke('settings:removeSensitiveFolder', path),
    setLocalProfile: (id) => ipcRenderer.invoke('settings:setLocalProfile', id),
    chooseScreenshotFolder: () => ipcRenderer.invoke('settings:chooseScreenshotFolder'),
    resetScreenshotFolder: () => ipcRenderer.invoke('settings:resetScreenshotFolder'),
    openScreenshotFolder: () => ipcRenderer.invoke('settings:openScreenshotFolder'),
    chooseGalleryFolder: () => ipcRenderer.invoke('settings:chooseGalleryFolder'),
    resetGalleryFolder: () => ipcRenderer.invoke('settings:resetGalleryFolder'),
    setGalleryTagging: (autoTag, profileId) => ipcRenderer.invoke('settings:setGalleryTagging', autoTag, profileId)
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    inspect: (source) => ipcRenderer.invoke('plugins:inspect', source),
    install: (stagingId) => ipcRenderer.invoke('plugins:install', stagingId),
    cancelInstall: (stagingId) => ipcRenderer.invoke('plugins:cancelInstall', stagingId),
    setEnabled: (id, enabled) => ipcRenderer.invoke('plugins:setEnabled', id, enabled),
    remove: (id) => ipcRenderer.invoke('plugins:remove', id),
    setSecret: (id, name, value) => ipcRenderer.invoke('plugins:setSecret', id, name, value),
    onChange: (cb) => {
      const listener = () => cb()
      ipcRenderer.on('plugins:changed', listener)
      return () => ipcRenderer.removeListener('plugins:changed', listener)
    }
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    current: () => ipcRenderer.invoke('conversations:current'),
    open: (id) => ipcRenderer.invoke('conversations:open', id),
    create: () => ipcRenderer.invoke('conversations:create'),
    rename: (id, title) => ipcRenderer.invoke('conversations:rename', id, title),
    remove: (id) => ipcRenderer.invoke('conversations:remove', id)
  },
  reminders: {
    list: () => ipcRenderer.invoke('reminders:list'),
    cancel: (id) => ipcRenderer.invoke('reminders:cancel', id),
    dismiss: (id) => ipcRenderer.invoke('reminders:dismiss', id),
    snooze: (id, minutes) => ipcRenderer.invoke('reminders:snooze', id, minutes),
    onDue: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, r: DueReminder) => cb(r)
      ipcRenderer.on('reminder:due', listener)
      return () => ipcRenderer.removeListener('reminder:due', listener)
    },
    dnd: () => ipcRenderer.invoke('reminders:dnd'),
    setDnd: (minutes) => ipcRenderer.invoke('reminders:setDnd', minutes),
    setQuietHours: (start, end) => ipcRenderer.invoke('reminders:setQuietHours', start, end)
  },
  skins: {
    list: () => ipcRenderer.invoke('skins:list'),
    load: (id) => ipcRenderer.invoke('skins:load', id),
    install: (from) => ipcRenderer.invoke('skins:install', from),
    remove: (id) => ipcRenderer.invoke('skins:remove', id),
    select: (id) => ipcRenderer.invoke('skins:select', id)
  },
  marketplaces: {
    list: () => ipcRenderer.invoke('marketplaces:list'),
    add: (input) => ipcRenderer.invoke('marketplaces:add', input),
    remove: (name, uninstallPlugins) => ipcRenderer.invoke('marketplaces:remove', name, uninstallPlugins),
    refresh: (name) => ipcRenderer.invoke('marketplaces:refresh', name)
  },
  files: {
    pathOf: (file) => webUtils.getPathForFile(file)
  },
  pet: {
    setHitRects: (rects) => ipcRenderer.send('pet:setHitRects', rects),
    dragStart: () => ipcRenderer.send('pet:dragStart'),
    dragMove: () => ipcRenderer.send('pet:dragMove'),
    dragEnd: () => ipcRenderer.send('pet:dragEnd'),
    showMenu: () => ipcRenderer.send('pet:showMenu'),
    onSkinChange: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, skin: PetSkinId) => cb(skin)
      ipcRenderer.on('pet:skin', listener)
      return () => ipcRenderer.removeListener('pet:skin', listener)
    }
  },
  capture: {
    take: (mode) => ipcRenderer.invoke('capture:take', mode),
    choose: () => ipcRenderer.invoke('capture:choose'),
    pasteImage: () => ipcRenderer.invoke('capture:paste'),
    onAttached: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, r: { attachment?: AttachmentView; error?: string }) => cb(r)
      ipcRenderer.on('capture:attached', listener)
      return () => ipcRenderer.removeListener('capture:attached', listener)
    }
  },
  snip: {
    onImage: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, url: string) => cb(url)
      ipcRenderer.on('snip:image', listener)
      return () => ipcRenderer.removeListener('snip:image', listener)
    },
    done: (rect) => ipcRenderer.send('snip:done', rect)
  },
  gallery: {
    list: (rel) => ipcRenderer.invoke('gallery:list', rel),
    search: (query) => ipcRenderer.invoke('gallery:search', query),
    copy: (rel) => ipcRenderer.invoke('gallery:copy', rel),
    menu: (rel, kind) => ipcRenderer.invoke('gallery:menu', rel, kind),
    rename: (rel, name) => ipcRenderer.invoke('gallery:rename', rel, name),
    move: (rel, to) => ipcRenderer.invoke('gallery:move', rel, to),
    remove: (rel) => ipcRenderer.invoke('gallery:remove', rel),
    mkdir: (parent, name) => ipcRenderer.invoke('gallery:mkdir', parent, name),
    importFiles: (paths, to) => ipcRenderer.invoke('gallery:import', paths, to),
    paste: (to) => ipcRenderer.invoke('gallery:paste', to),
    startDrag: (rel) => ipcRenderer.send('gallery:startDrag', rel),
    openFolder: (rel) => ipcRenderer.invoke('gallery:openFolder', rel),
    open: (rel) => ipcRenderer.invoke('gallery:open', rel),
    reveal: (rel) => ipcRenderer.invoke('gallery:reveal', rel),
    lineDownload: (url, to) => ipcRenderer.invoke('gallery:lineDownload', url, to),
    onLineProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, p: { done: number; total: number; title: string }) => cb(p)
      ipcRenderer.on('gallery:line-progress', listener)
      return () => ipcRenderer.removeListener('gallery:line-progress', listener)
    },
    tagStatus: () => ipcRenderer.invoke('gallery:tagStatus'),
    tag: (rels) => ipcRenderer.invoke('gallery:tag', rels),
    stopTagging: () => ipcRenderer.invoke('gallery:stopTagging'),
    onChange: (cb) => {
      const listener = () => cb()
      ipcRenderer.on('gallery:changed', listener)
      return () => ipcRenderer.removeListener('gallery:changed', listener)
    },
    onTagStatus: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, s: GalleryTagStatus) => cb(s)
      ipcRenderer.on('gallery:tag-status', listener)
      return () => ipcRenderer.removeListener('gallery:tag-status', listener)
    }
  },
  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    openReleasePage: () => ipcRenderer.send('updates:openReleasePage'),
    onAvailable: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, s: UpdateStatus) => cb(s)
      ipcRenderer.on('update:available', listener)
      return () => ipcRenderer.removeListener('update:available', listener)
    }
  },
  windows: {
    openChat: () => ipcRenderer.send('windows:openChat'),
    openSettings: () => ipcRenderer.send('windows:openSettings'),
    openGallery: () => ipcRenderer.send('windows:openGallery')
  }
}

contextBridge.exposeInMainWorld('api', api)
