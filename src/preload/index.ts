import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AgentEvent, DesktopApi, PetSkinId } from '@shared/types'

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
    savePlaces: (places) => ipcRenderer.invoke('settings:savePlaces', places)
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
  windows: {
    openChat: () => ipcRenderer.send('windows:openChat'),
    openSettings: () => ipcRenderer.send('windows:openSettings')
  }
}

contextBridge.exposeInMainWorld('api', api)
