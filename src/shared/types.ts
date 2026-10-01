// Types shared by main, preload and renderer. Keep this file free of Node/DOM imports.

export type ProviderKind = 'openai-compatible' | 'claude'

/** A saved model connection. The API key is never part of this object; see SecretStore. */
export interface ProviderProfile {
  id: string
  name: string
  kind: ProviderKind
  baseURL: string
  model: string
  /** Non-secret extra headers some gateways need (e.g. a tenant id). Secrets belong in the API key. */
  headers?: Record<string, string>
  /** Marks a profile whose traffic never leaves this machine (Ollama, LM Studio). */
  isLocal?: boolean
  /** Tried in order when the main model is rate-limited, down or unavailable. */
  fallbackModels?: string[]
}

export const MAX_FALLBACK_MODELS = 3

export const isOpenRouterURL = (baseURL: string) => /^https:\/\/openrouter\.ai\//.test(baseURL.trim())

/** Profile as the renderer sees it: no secret, only whether one is stored. */
export interface ProfileView extends ProviderProfile {
  hasKey: boolean
}

export type PetSkinId = 'desk' | 'classic'

export const PET_SKINS: { id: PetSkinId; label: string }[] = [
  { id: 'desk', label: '拍桌貓' },
  { id: 'classic', label: '橘貓' }
]

export type SearchProvider = 'none' | 'serper' | 'tavily' | 'brave' | 'searxng'

export interface SearchConfig {
  provider: SearchProvider
  /** SearXNG instance URL; unused by the other providers. */
  baseURL?: string
}

/** A place the user names often ("公司", "家"), used for "near me" and as a route start. */
export interface SavedPlace {
  name: string
  address: string
}

export interface SettingsView {
  activeProfileId: string | null
  profiles: ProfileView[]
  petSkin: PetSkinId
  /** Folders the assistant may read without asking. */
  allowedFolders: string[]
  search: SearchConfig & { hasKey: boolean }
  /** Paths that are never readable or writable, shown for transparency. */
  blockedPaths: string[]
  /** The persona in effect (the default when the user hasn't customized it). */
  persona: string
  personaIsDefault: boolean
  defaultPersona: string
  /** The rules the persona can't override, shown read-only in settings. */
  fixedRules: string
  maxPersonaChars: number
  places: SavedPlace[]
}

export interface SaveSearchInput {
  config: SearchConfig
  /** undefined = keep the stored key, '' = remove it. */
  apiKey?: string
}

export interface SaveProfileInput {
  profile: ProviderProfile
  /** undefined = keep the stored key, '' = remove it, anything else = replace it. */
  apiKey?: string
}

export type ChatRole = 'user' | 'assistant'

export type ToolStatus = 'waiting-approval' | 'running' | 'done' | 'error' | 'denied'

/** One tool call as shown to the user. */
export interface ToolCallView {
  id: string
  name: string
  /** Human-readable one-liner, e.g. 「讀取 ~/Documents/report.pdf」. */
  title: string
  status: ToolStatus
  /** Short outcome, e.g. 「找到 12 個檔案」 or the error message. */
  summary?: string
}

/** Assistant replies interleave text and tool calls in the order they happened. */
export type MessagePart = { type: 'text'; text: string } | { type: 'tool'; tool: ToolCallView }

export interface AttachmentView {
  path: string
  name: string
  kind: 'file' | 'image' | 'folder'
}

export interface ChatMessage {
  id: string
  role: ChatRole
  /** Full text of the message (all text parts joined) — what the pet bubble shows. */
  text: string
  parts?: MessagePart[]
  attachments?: AttachmentView[]
  createdAt: number
  error?: string
  /** Model that actually produced an assistant reply (may differ from the profile's with fallbacks/auto). */
  model?: string
}

export type ToolRisk = 'read' | 'network' | 'screen' | 'write' | 'execute'

export interface PermissionRequest {
  id: string
  toolName: string
  risk: ToolRisk
  /** e.g. 「刪除檔案（移到垃圾桶）」 */
  title: string
  /** Exact target: the command, the path, a preview of the content… */
  detail: string
  /** Why this needs asking, e.g. 「這個資料夾不在允許清單中」 */
  reason?: string
}

export type PermissionDecision = 'once' | 'session' | 'deny'

export type PetState = 'idle' | 'listening' | 'thinking' | 'talking' | 'working' | 'alert' | 'sleeping' | 'error'

/** Events the agent broadcasts to every window while a turn runs. */
export type AgentEvent =
  | { type: 'turn-start'; userMessage: ChatMessage; assistantId: string }
  | { type: 'delta'; assistantId: string; text: string }
  /** A tool call was added or its status changed (upsert by tool.id). */
  | { type: 'tool'; assistantId: string; tool: ToolCallView }
  | { type: 'permission-request'; request: PermissionRequest }
  | { type: 'permission-resolved'; id: string }
  | { type: 'turn-end'; message: ChatMessage }
  | { type: 'history-cleared' }

export interface TestResult {
  ok: boolean
  message: string
}

// ── Plugins (M3) ───────────────────────────────────────────────────────────

export interface PluginSkillView {
  name: string
  description: string
}

export interface PluginMcpView {
  name: string
  /** What will run: the command line for stdio servers, the URL for HTTP ones. */
  target: string
  status: 'stopped' | 'starting' | 'running' | 'error'
  error?: string
  toolCount: number
}

export interface PluginToolView {
  name: string
  kind: 'http' | 'cli'
  risk: ToolRisk
  description: string
  /** Where it sends requests / what it runs, for the install review. */
  target: string
}

export interface PluginView {
  /** Folder name under the plugins directory; unique. */
  id: string
  name: string
  version?: string
  description?: string
  enabled: boolean
  skills: PluginSkillView[]
  mcpServers: PluginMcpView[]
  tools: PluginToolView[]
  /** `${secret:name}` placeholders its tools use, and whether each has a value. */
  secrets: { name: string; isSet: boolean }[]
  /** Problems found while reading it (a bad YAML file, a name clash…). */
  warnings: string[]
}

export type PluginSource = { kind: 'folder' } | { kind: 'zip' } | { kind: 'git'; url: string }

/** A plugin read into a staging area, shown for review before it's installed. */
export interface PluginPreview {
  stagingId: string
  plugin: PluginView
  /** Set when a plugin with the same id exists and installing would replace it. */
  replaces?: string
}

export interface HitRect {
  x: number
  y: number
  width: number
  height: number
}

/** The API exposed on window.api by the preload script. */
export interface DesktopApi {
  agent: {
    send(text: string, attachments?: string[]): Promise<void>
    respondPermission(id: string, decision: PermissionDecision): Promise<void>
    pendingPermissions(): Promise<PermissionRequest[]>
    describeAttachments(paths: string[]): Promise<AttachmentView[]>
    cancel(): Promise<void>
    history(): Promise<ChatMessage[]>
    clear(): Promise<void>
    onEvent(cb: (e: AgentEvent) => void): () => void
  }
  settings: {
    get(): Promise<SettingsView>
    saveProfile(input: SaveProfileInput): Promise<SettingsView>
    deleteProfile(id: string): Promise<SettingsView>
    setActive(id: string): Promise<SettingsView>
    test(input: SaveProfileInput): Promise<TestResult>
    listModels(input: SaveProfileInput): Promise<string[]>
    /** Runs OpenRouter's OAuth flow in the browser and stores the resulting key on this profile. */
    connectOpenRouter(input: SaveProfileInput): Promise<SettingsView>
    cancelConnect(): Promise<void>
    /** Opens a native folder picker and adds the choice; resolves with the new view. */
    addAllowedFolder(): Promise<SettingsView>
    removeAllowedFolder(path: string): Promise<SettingsView>
    saveSearch(input: SaveSearchInput): Promise<SettingsView>
    testSearch(input: SaveSearchInput): Promise<TestResult>
    openAuditLog(): Promise<void>
    /** '' restores the default persona. */
    savePersona(text: string): Promise<SettingsView>
    savePlaces(places: SavedPlace[]): Promise<SettingsView>
  }
  plugins: {
    list(): Promise<PluginView[]>
    /** Opens a picker (folder / zip) or clones the URL, and returns a preview — nothing is installed yet. Resolves null if the picker was cancelled. */
    inspect(source: PluginSource): Promise<PluginPreview | null>
    install(stagingId: string): Promise<PluginView[]>
    cancelInstall(stagingId: string): Promise<void>
    setEnabled(id: string, enabled: boolean): Promise<PluginView[]>
    remove(id: string): Promise<PluginView[]>
    setSecret(id: string, name: string, value: string): Promise<PluginView[]>
    onChange(cb: () => void): () => void
  }
  files: {
    /** Absolute path of a dropped File (Electron removed File.path in sandboxed renderers). */
    pathOf(file: File): string
  }
  pet: {
    /** Clickable regions (window coordinates, CSS px); everything else passes clicks through. */
    setHitRects(rects: HitRect[]): void
    dragStart(): void
    dragMove(): void
    dragEnd(): void
    showMenu(): void
    onSkinChange(cb: (skin: PetSkinId) => void): () => void
  }
  windows: {
    openChat(): void
    openSettings(): void
  }
}
