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

/** A built-in skin id ('desk', 'classic') or an installed skin pack's id. */
export type PetSkinId = string

export const PET_SKINS: { id: PetSkinId; label: string }[] = [
  { id: 'desk', label: '拍桌貓' },
  { id: 'classic', label: '橘貓' }
]

export const PET_STATES: PetState[] = ['idle', 'listening', 'thinking', 'talking', 'working', 'alert', 'sleeping', 'error']

export interface SkinView {
  id: PetSkinId
  name: string
  author?: string
  builtin: boolean
  renderer?: 'lottie' | 'images'
  /** Which states the pack draws itself (the rest fall back to idle). */
  states?: PetState[]
}

/** A skin pack ready to draw: every file already read into memory (no file access from the UI). */
export interface LoadedSkin {
  id: PetSkinId
  renderer: 'lottie' | 'images'
  width: number
  height: number
  states: Partial<Record<PetState, { kind: 'image'; src: string } | { kind: 'lottie'; data: unknown }>>
}

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
  /** Folders whose contents may only go to a local model. */
  sensitiveFolders: string[]
  /** The local profile used for them; must be marked isLocal. */
  localProfileId: string | null
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

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: string
  messageCount: number
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
  /** Another conversation was opened (or a new one started); windows reload the history. */
  | { type: 'conversation-changed'; id: string }

export interface TestResult {
  ok: boolean
  message: string
}

// ── Reminders (M4) ─────────────────────────────────────────────────────────

export type ReminderRepeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'

export interface ReminderView {
  id: string
  text: string
  /** Next time it fires, ISO. */
  at: string
  repeat: ReminderRepeat
}

/** A reminder that has come due, as delivered to the pet. */
export interface DueReminder extends ReminderView {
  /** Fired late because the app was closed (or do-not-disturb held it). */
  late: boolean
}

export interface DndView {
  /** Manual do-not-disturb until this time, ISO. */
  until?: string
  /** Daily quiet hours, 'HH:mm'. */
  quietStart?: string
  quietEnd?: string
  /** Whether do-not-disturb is in effect right now. */
  active: boolean
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
  /** Set when it was installed from a marketplace. */
  origin?: { marketplace: string; entry: string; version?: string; sha?: string }
}

export interface MarketplaceEntryView {
  name: string
  description?: string
  version?: string
  category?: string
  tags: string[]
  author?: string
  homepage?: string
  /** Where the plugin is downloaded from, in short. */
  sourceLabel: string
  /** Popularity the marketplace itself publishes (entry metadata.installs / downloads / popularity). */
  popularity?: { value: number; kind: 'installs' | 'downloads' | 'score' }
  /** False for npm / command sources, which this app doesn't fetch. */
  supported: boolean
  installed?: { pluginId: string; updateAvailable: boolean }
}

export interface MarketplaceView {
  name: string
  description?: string
  owner?: string
  /** Where the catalog comes from, e.g. github.com/owner/repo. */
  source: string
  isDefault: boolean
  status: 'not-loaded' | 'loading' | 'ready' | 'error'
  error?: string
  updatedAt?: string
  entries: MarketplaceEntryView[]
  warnings: string[]
}

export type PluginSource =
  | { kind: 'folder' }
  | { kind: 'zip' }
  | { kind: 'git'; url: string }
  | { kind: 'marketplace'; marketplace: string; entry: string }

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
/** Result of checking GitHub Releases for a newer build. */
export interface UpdateStatus {
  current: string
  latest?: string
  available: boolean
  notes?: string
  /** Release page, for "what's new". */
  url?: string
  checkedAt?: string
  error?: string
}

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
    addSensitiveFolder(): Promise<SettingsView>
    removeSensitiveFolder(path: string): Promise<SettingsView>
    setLocalProfile(id: string | null): Promise<SettingsView>
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
  conversations: {
    list(): Promise<ConversationSummary[]>
    current(): Promise<string>
    open(id: string): Promise<void>
    /** Starts an empty conversation; the current one stays in the list. */
    create(): Promise<void>
    rename(id: string, title: string): Promise<ConversationSummary[]>
    remove(id: string): Promise<ConversationSummary[]>
  }
  reminders: {
    list(): Promise<ReminderView[]>
    cancel(id: string): Promise<ReminderView[]>
    /** Dismiss a due reminder (repeating ones move to their next time). */
    dismiss(id: string): Promise<void>
    snooze(id: string, minutes: number): Promise<void>
    onDue(cb: (r: DueReminder) => void): () => void
    dnd(): Promise<DndView>
    /** minutes = null turns manual do-not-disturb off. */
    setDnd(minutes: number | null): Promise<DndView>
    setQuietHours(start: string | null, end: string | null): Promise<DndView>
  }
  skins: {
    list(): Promise<SkinView[]>
    load(id: PetSkinId): Promise<LoadedSkin | null>
    /** Opens a folder (or zip) picker and installs the skin pack inside. Resolves null if cancelled. */
    install(from: 'folder' | 'zip'): Promise<SkinView[] | null>
    remove(id: PetSkinId): Promise<SkinView[]>
    select(id: PetSkinId): Promise<void>
  }
  marketplaces: {
    list(): Promise<MarketplaceView[]>
    /** `owner/repo`, a git URL, a link to marketplace.json, or a local folder. */
    add(input: string): Promise<MarketplaceView[]>
    remove(name: string, uninstallPlugins: boolean): Promise<MarketplaceView[]>
    /** Downloads the catalog again (or for the first time). */
    refresh(name: string): Promise<MarketplaceView[]>
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
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    /** Runs the install script in the background and quits; it reopens the new version. */
    install(): Promise<void>
    openReleasePage(): void
    onAvailable(cb: (status: UpdateStatus) => void): () => void
  }
  windows: {
    openChat(): void
    openSettings(): void
  }
}
