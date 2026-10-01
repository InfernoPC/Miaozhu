import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  AgentEvent,
  AttachmentView,
  ChatMessage,
  PermissionDecision,
  PermissionRequest,
  ProviderProfile,
  SavedPlace,
  SearchConfig,
  ToolCallView
} from '@shared/types'
import { audit, PermissionGuard } from '../permissions/guard'
import { createProvider, describeError } from '../providers'
import { errorStatus } from '../providers/errors'
import type { LLMMessage, ProviderData, ToolCall, UserContent } from '../providers/types'
import { isImagePath, readForModel } from '../tools/fs'
import { parseArgs, TOOLS, ToolError, type ToolDef } from '../tools'
import { displayPath, expandPath, realPath } from '../tools/paths'
import type { ConversationStore } from './conversation-store'
import { buildSystemPrompt } from './prompt'

/** What the agent needs from settings; SettingsStore implements it, tests can fake it. */
export interface AgentSettings {
  activeProfile(): ProviderProfile | null
  getApiKey(profileId: string): string | undefined
  allowedFolders(): string[]
  searchCredentials(): { config: SearchConfig; apiKey?: string }
  /** The user's persona text; blank means the default. */
  persona(): string | undefined
  /** Named places for "near me" and route starts. */
  places(): SavedPlace[]
  /** Folders whose contents may only be sent to a local model. */
  sensitiveFolders(): string[]
  /** The local (isLocal) profile used once a conversation holds sensitive content. */
  localProfile(): ProviderProfile | null
}

/** Tools and skills contributed by installed plugins (M3). */
export interface PluginSource {
  /** `taken` holds built-in names; plugins must not shadow them. */
  tools(taken: Set<string>): ToolDef[]
  skills(): { name: string; description: string }[]
}

export interface AgentDeps {
  hidePet(): Promise<() => void>
  /** Built-in tools that need app services (e.g. reminders), added after the static ones. */
  extraTools?: ToolDef[]
  plugins?: PluginSource
  /** Where the conversation is saved between launches; omitted in tests that don't care. */
  store?: ConversationStore
}

const MAX_STEPS = 15
const MAX_TOOL_TEXT = 20_000
const MAX_ATTACHMENT_CHARS = 30_000
const KEEP_TURNS = 20


/** Some models/servers reject the `tools` field; detect that and continue as plain chat. */
function toolsUnsupported(err: unknown): boolean {
  const status = errorStatus(err)
  return (status === 400 || status === 404) && /tool|function/i.test((err as Error).message ?? '')
}

export class Agent {
  /** What the UI shows. */
  private history: ChatMessage[] = []
  /** What the model sees: one message list per user turn, including tool calls and results. */
  private turns: LLMMessage[][] = []
  private controller: AbortController | null = null
  private pending = new Map<string, { request: PermissionRequest; resolve: (d: PermissionDecision) => void }>()
  /** Profiles+models known to reject tool definitions, so we stop sending them. */
  private noTools = new Set<string>()
  /** The tool call currently being authorized, so a permission prompt can mark its card. */
  private activeTool: { view: ToolCallView; assistant: ChatMessage } | null = null
  readonly guard: PermissionGuard

  constructor(
    private settings: AgentSettings,
    private broadcast: (e: AgentEvent) => void,
    private deps: AgentDeps = { hidePet: async () => () => {} }
  ) {
    this.guard = new PermissionGuard(
      () => this.settings.allowedFolders(),
      (req) => this.askUser(req),
      () => this.settings.sensitiveFolders()
    )
    // Reopen whatever conversation was open last time.
    const current = deps.store?.current()
    const saved = current ? deps.store?.load(current) : null
    if (current && saved) {
      this.conversationId = current
      this.history = saved.history
      this.turns = saved.turns
      this.localOnly = !!saved.localOnly
    }
  }

  /** Once true for a conversation, every model call in it goes to the local profile. */
  private localOnly = false

  /** The open conversation; a new one has an id before it's first saved. */
  private conversationId: string = randomUUID()

  currentConversation(): string {
    return this.conversationId
  }

  /** Switches to a saved conversation. Grants from the previous one don't carry over. */
  openConversation(id: string): void {
    const saved = this.deps.store?.load(id)
    if (!saved) return
    this.switchTo(id, saved.history, saved.turns, !!saved.localOnly)
    this.deps.store?.setCurrent(id)
  }

  /** Starts an empty conversation; the previous one stays saved in the list. */
  newConversation(): void {
    this.switchTo(randomUUID(), [], [])
    this.deps.store?.setCurrent(undefined)
  }

  deleteConversation(id: string): void {
    this.deps.store?.remove(id)
    if (id === this.conversationId) this.newConversation()
  }

  private switchTo(id: string, history: ChatMessage[], turns: LLMMessage[][], localOnly = false): void {
    this.cancel()
    this.conversationId = id
    this.history = history
    this.turns = turns
    this.localOnly = localOnly
    this.guard.resetSession()
    this.broadcast({ type: 'conversation-changed', id })
  }

  getHistory(): ChatMessage[] {
    return this.history
  }

  pendingPermissions(): PermissionRequest[] {
    return [...this.pending.values()].map((p) => p.request)
  }

  respondPermission(id: string, decision: PermissionDecision): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    this.broadcast({ type: 'permission-resolved', id })
    p.resolve(decision)
  }

  /** "清除對話": start fresh. The old conversation is kept in the list. */
  clear(): void {
    this.newConversation()
  }

  cancel(): void {
    this.controller?.abort()
  }

  async describeAttachments(paths: string[]): Promise<AttachmentView[]> {
    return Promise.all(
      paths.map(async (p) => {
        const abs = expandPath(p)
        const isDir = (await stat(abs).catch(() => null))?.isDirectory()
        return { path: abs, name: basename(abs), kind: isDir ? 'folder' : isImagePath(abs) ? 'image' : 'file' } as AttachmentView
      })
    )
  }

  async send(text: string, attachmentPaths: string[] = []): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed && !attachmentPaths.length) return
    // One turn at a time: a new message interrupts the current reply.
    this.cancel()

    const attachments = await this.describeAttachments(attachmentPaths)
    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      text: trimmed,
      attachments: attachments.length ? attachments : undefined,
      createdAt: Date.now()
    }
    const assistant: ChatMessage = { id: randomUUID(), role: 'assistant', text: '', parts: [], createdAt: Date.now() }
    // The turn belongs to the conversation it started in, even if the user switches away.
    const conversationId = this.conversationId
    const history = this.history
    history.push(userMessage)
    this.broadcast({ type: 'turn-start', userMessage, assistantId: assistant.id })

    const controller = new AbortController()
    this.controller = controller
    const turn: LLMMessage[] = [{ role: 'user', content: await this.buildUserContent(trimmed, attachments, assistant) }]
    this.turns.push(turn)

    try {
      let step = 0
      for (; step < MAX_STEPS; step++) {
        // Chosen per step: reading a sensitive file mid-turn switches the rest to the local model.
        const profile = this.localOnly ? this.settings.localProfile() : this.settings.activeProfile()
        if (!profile) {
          throw new Error(this.localOnly ? '這段對話含有敏感資料夾的內容，但本機模型連線不見了，請到「設定 → 檔案權限」重新指定' : '尚未設定模型連線，請右鍵點貓咪 →「設定」新增連線')
        }
        const provider = createProvider(profile, this.settings.getApiKey(profile.id))
        const toolKey = `${profile.id}:${profile.model}`
        let text = ''
        let calls: ToolCall[] = []
        let providerData: ProviderData | undefined
        const useTools = !this.noTools.has(toolKey)
        const tools = this.availableTools()
        try {
          for await (const ev of provider.stream({
            messages: this.buildContext(),
            tools: useTools ? tools.map((t) => t.spec) : undefined,
            signal: controller.signal
          })) {
            if (ev.type === 'model') assistant.model = ev.model
            else if (ev.type === 'tool-calls') calls = ev.calls
            else if (ev.type === 'provider-data') providerData = ev.data
            else {
              text += ev.text
              this.appendText(assistant, ev.text)
            }
          }
        } catch (err) {
          if (!useTools || text || !toolsUnsupported(err)) throw err
          this.noTools.add(toolKey)
          this.appendText(assistant, '（這個模型不支援工具，喵助只能一般聊天，無法操作檔案或上網）\n\n')
          step--
          continue
        }

        turn.push({ role: 'assistant', text, toolCalls: calls.length ? calls : undefined, providerData })
        if (!calls.length) break

        const images: string[] = []
        for (const call of calls) {
          // Every call must get a result, even after cancel, or the next request is malformed.
          if (controller.signal.aborted) {
            turn.push({ role: 'tool', toolCallId: call.id, text: '使用者已取消' })
            continue
          }
          const result = await this.runTool(call, tools, assistant, controller.signal)
          turn.push({ role: 'tool', toolCallId: call.id, text: result.text })
          images.push(...(result.images ?? []))
        }
        if (images.length) {
          // Tool messages are text-only in the OpenAI format, so images follow as a user message.
          turn.push({ role: 'user', content: [{ type: 'text', text: '（以下是剛才工具取得的圖片）' }, ...images.map((dataUrl) => ({ type: 'image' as const, dataUrl }))] })
        }
        if (controller.signal.aborted) break
      }
      if (step >= MAX_STEPS) this.appendText(assistant, `\n\n（已連續執行 ${MAX_STEPS} 個步驟，先停下來。需要的話請叫我繼續。）`)
    } catch (err) {
      if (!controller.signal.aborted) assistant.error = describeError(err)
    } finally {
      if (this.controller === controller) this.controller = null
      if (controller.signal.aborted && !assistant.text && !assistant.parts?.length) assistant.error = '已取消'
      // A turn that failed before any reply would leave a dangling user message in the context.
      if (turn.length === 1) this.turns = this.turns.filter((t) => t !== turn)
      for (const [id, p] of this.pending) {
        this.pending.delete(id)
        this.broadcast({ type: 'permission-resolved', id })
        p.resolve('deny')
      }
      history.push(assistant)
      if (conversationId === this.conversationId) {
        this.deps.store?.save(conversationId, { history, turns: this.turns, localOnly: this.localOnly })
        this.broadcast({ type: 'turn-end', message: assistant })
      }
    }
  }

  private appendText(assistant: ChatMessage, text: string): void {
    assistant.text += text
    const parts = assistant.parts!
    const last = parts[parts.length - 1]
    if (last?.type === 'text') last.text += text
    else parts.push({ type: 'text', text })
    this.broadcast({ type: 'delta', assistantId: assistant.id, text })
  }

  private updateTool(assistant: ChatMessage, view: ToolCallView): void {
    const parts = assistant.parts!
    const existing = parts.find((p) => p.type === 'tool' && p.tool.id === view.id)
    if (existing?.type === 'tool') existing.tool = { ...view }
    else parts.push({ type: 'tool', tool: { ...view } })
    this.broadcast({ type: 'tool', assistantId: assistant.id, tool: { ...view } })
  }

  /** Built-ins first, then whatever enabled plugins offer right now. */
  private availableTools(): ToolDef[] {
    const builtin = [...TOOLS, ...(this.deps.extraTools ?? [])]
    const plugin = this.deps.plugins?.tools(new Set(builtin.map((t) => t.spec.name))) ?? []
    return [...builtin, ...plugin]
  }

  private async runTool(call: ToolCall, tools: ToolDef[], assistant: ChatMessage, signal: AbortSignal): Promise<{ text: string; images?: string[] }> {
    const tool = tools.find((t) => t.spec.name === call.name)
    const view: ToolCallView = { id: call.id, name: call.name, title: call.name, status: 'running' }
    if (!tool) {
      this.updateTool(assistant, { ...view, status: 'error', summary: '未知的工具' })
      return { text: `錯誤：沒有名為 ${call.name} 的工具。可用工具：${tools.map((t) => t.spec.name).join(', ')}` }
    }

    let input: Record<string, unknown>
    try {
      input = parseArgs(tool, call.arguments)
    } catch (err) {
      this.updateTool(assistant, { ...view, status: 'error', summary: (err as Error).message })
      return { text: `錯誤：${(err as Error).message}。請修正參數後再試一次。` }
    }
    view.title = tool.title(input)
    this.updateTool(assistant, view)

    if (!this.localOnly && (await this.guard.touchesSensitive(tool, input))) {
      const local = this.settings.localProfile()
      if (!local) {
        const reason = '這個資料夾設定為只能交給本機模型處理，但還沒有指定本機模型（設定 → 檔案權限）'
        this.updateTool(assistant, { ...view, status: 'denied', summary: reason })
        void audit({ tool: tool.spec.name, input, verdict: 'blocked' })
        return { text: `操作沒有執行：${reason}` }
      }
      this.enterLocalOnly(assistant, local)
    }

    this.activeTool = { view, assistant }
    const verdict = await this.guard.authorize(tool, input, { localOnly: this.localOnly }).finally(() => (this.activeTool = null))
    if (!verdict.allowed) {
      this.updateTool(assistant, { ...view, status: verdict.byUser ? 'denied' : 'error', summary: verdict.reason })
      void audit({ tool: tool.spec.name, input, verdict: verdict.byUser ? 'denied' : 'blocked' })
      return { text: `操作沒有執行：${verdict.reason}` }
    }

    this.updateTool(assistant, { ...view, status: 'running' })
    try {
      const result = await tool.run(input, {
        signal,
        search: () => this.settings.searchCredentials(),
        isBlocked: this.guard.isBlocked,
        hidePet: this.deps.hidePet
      })
      this.updateTool(assistant, { ...view, status: 'done', summary: result.summary })
      void audit({ tool: tool.spec.name, input, verdict: verdict.asked ? 'approved' : 'auto', ok: true, summary: result.summary })
      const text = result.text.length > MAX_TOOL_TEXT ? result.text.slice(0, MAX_TOOL_TEXT) + '\n…（結果過長，已截斷）' : result.text
      return { text, images: result.images }
    } catch (err) {
      const message = err instanceof ToolError ? err.message : `${(err as Error).message}`
      this.updateTool(assistant, { ...view, status: 'error', summary: message })
      void audit({ tool: tool.spec.name, input, verdict: verdict.asked ? 'approved' : 'auto', ok: false, summary: message })
      return { text: `錯誤：${message}` }
    }
  }

  private askUser(req: Omit<PermissionRequest, 'id'>): Promise<PermissionDecision> {
    const signal = this.controller?.signal
    if (signal?.aborted) return Promise.resolve('deny')
    const request: PermissionRequest = { id: randomUUID(), ...req }
    if (this.activeTool) this.updateTool(this.activeTool.assistant, { ...this.activeTool.view, status: 'waiting-approval' })
    return new Promise((resolve) => {
      this.pending.set(request.id, { request, resolve })
      this.broadcast({ type: 'permission-request', request })
      // Stopping the reply must also withdraw the question, or the turn waits forever.
      signal?.addEventListener('abort', () => this.respondPermission(request.id, 'deny'), { once: true })
    })
  }

  /** From now on this conversation only talks to the local model; says so once in the reply. */
  private enterLocalOnly(assistant: ChatMessage, local: ProviderProfile): void {
    this.localOnly = true
    this.appendText(assistant, `（讀到敏感資料夾的內容，這段對話之後都改用本機模型「${local.name}」回答，資料不會送出這台電腦）\n\n`)
  }

  private async buildUserContent(text: string, attachments: AttachmentView[], assistant: ChatMessage): Promise<UserContent[]> {
    const content: UserContent[] = []
    const notes: string[] = []
    for (const a of attachments) {
      if (!this.localOnly && (await this.guard.isSensitivePath(a.path))) {
        const local = this.settings.localProfile()
        if (!local) {
          notes.push(`⛔ ${displayPath(a.path)}：在敏感資料夾裡，只能交給本機模型，但還沒有指定本機模型，所以沒有讀取`)
          continue
        }
        this.enterLocalOnly(assistant, local)
      }
      // Dropping a file is explicit consent to read it — but never a protected one.
      if (this.guard.isBlocked(await realPath(a.path))) {
        notes.push(`⛔ ${displayPath(a.path)}：屬於受保護的位置（帳號憑證、瀏覽器資料等），不會讀取`)
        continue
      }
      this.guard.allowReadForSession(a.path)
      if (a.kind === 'folder') {
        notes.push(`📁 資料夾 ${displayPath(a.path)}（可用 list_dir / search_files 查看內容）`)
        continue
      }
      try {
        const file = await readForModel(a.path, MAX_ATTACHMENT_CHARS)
        if (file.kind === 'image') {
          notes.push(`🖼️ 圖片 ${displayPath(a.path)}（${file.note}，內容附在下方）`)
          content.push({ type: 'image', dataUrl: file.dataUrl })
        } else {
          notes.push(`📄 檔案 ${displayPath(a.path)}（${file.note}）：\n<file path="${displayPath(a.path)}">\n${file.text}\n</file>`)
        }
      } catch (err) {
        notes.push(`⚠️ ${displayPath(a.path)}：${(err as Error).message}`)
      }
    }
    const body = notes.length ? `${text || '請看看這些檔案。'}\n\n使用者附加了：\n${notes.join('\n\n')}` : text
    return [{ type: 'text', text: body }, ...content]
  }

  /** Recent turns only; images are kept for the latest turn and replaced by a note in older ones. */
  private buildContext(): LLMMessage[] {
    const recent = this.turns.slice(-KEEP_TURNS)
    const last = recent.length - 1
    const flattened = recent.flatMap((turn, i) =>
      i === last
        ? turn
        : turn.map((m) =>
            m.role === 'user' && m.content.some((c) => c.type === 'image')
              ? { ...m, content: m.content.map((c) => (c.type === 'image' ? { type: 'text' as const, text: '[圖片已省略]' } : c)) }
              : m
          )
    )
    return [{ role: 'system', text: buildSystemPrompt(this.settings.persona(), this.settings.places(), this.deps.plugins?.skills() ?? []) }, ...flattened]
  }
}
