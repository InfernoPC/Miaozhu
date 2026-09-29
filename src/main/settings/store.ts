import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import type {
  PetSkinId,
  ProfileView,
  SavedPlace,
  ProviderProfile,
  SaveProfileInput,
  SaveSearchInput,
  SearchConfig,
  SettingsView
} from '@shared/types'
import { blockedRoots } from '../permissions/guard'
import { displayPath } from '../tools/paths'
import { readJson, writeJson } from '../util/json-file'
import { DEFAULT_PERSONA, fixedRules, MAX_PERSONA_CHARS, normalizePersona } from '../agent/prompt'

interface ConfigFile {
  activeProfileId: string | null
  profiles: ProviderProfile[]
  petSkin?: PetSkinId
  /** Missing = defaults (Desktop, Documents, Downloads); an empty list is a deliberate choice. */
  allowedFolders?: string[]
  search?: SearchConfig
  /** Missing = default persona. */
  persona?: string
  places?: SavedPlace[]
}

/** Search API keys share the secrets file with profile keys under this id. */
const SEARCH_SECRET_ID = 'search'

const defaultAllowedFolders = () => ['desktop', 'documents', 'downloads'].map((n) => app.getPath(n as 'desktop'))

/** Encrypted API keys, keyed by profile id. Values are base64 of safeStorage ciphertext. */
type SecretsFile = Record<string, string>

const configPath = () => join(app.getPath('userData'), 'config.json')
const secretsPath = () => join(app.getPath('userData'), 'secrets.json')

export class SettingsStore {
  private config: ConfigFile = readJson<ConfigFile>(configPath(), { activeProfileId: null, profiles: [] })
  private secrets: SecretsFile = readJson<SecretsFile>(secretsPath(), {})

  view(): SettingsView {
    return {
      activeProfileId: this.config.activeProfileId,
      profiles: this.config.profiles.map<ProfileView>((p) => ({ ...p, hasKey: p.id in this.secrets })),
      petSkin: this.config.petSkin ?? 'desk',
      allowedFolders: this.allowedFolders(),
      search: { ...this.searchConfig(), hasKey: SEARCH_SECRET_ID in this.secrets },
      blockedPaths: blockedRoots().map(displayPath),
      persona: normalizePersona(this.config.persona),
      personaIsDefault: !this.config.persona?.trim(),
      defaultPersona: DEFAULT_PERSONA,
      fixedRules: fixedRules(),
      maxPersonaChars: MAX_PERSONA_CHARS,
      places: this.places()
    }
  }

  places(): SavedPlace[] {
    return this.config.places ?? []
  }

  savePlaces(places: SavedPlace[]): SettingsView {
    this.config.places = places
      .map((p) => ({ name: p.name.trim(), address: p.address.trim() }))
      .filter((p) => p.name && p.address)
      .slice(0, 10)
    this.persist()
    return this.view()
  }

  persona(): string | undefined {
    return this.config.persona
  }

  savePersona(text: string): SettingsView {
    const trimmed = text.trim().slice(0, MAX_PERSONA_CHARS)
    // Saving the default text verbatim is the same as not customizing it.
    this.config.persona = trimmed && trimmed !== DEFAULT_PERSONA ? trimmed : undefined
    this.persist()
    return this.view()
  }

  allowedFolders(): string[] {
    return this.config.allowedFolders ?? defaultAllowedFolders()
  }

  setAllowedFolders(folders: string[]): SettingsView {
    this.config.allowedFolders = [...new Set(folders)]
    this.persist()
    return this.view()
  }

  searchConfig(): SearchConfig {
    return this.config.search ?? { provider: 'none' }
  }

  searchCredentials(): { config: SearchConfig; apiKey?: string } {
    return { config: this.searchConfig(), apiKey: this.getApiKey(SEARCH_SECRET_ID) }
  }

  /** Key to use for an unsaved search form: the typed one, else the stored one. */
  resolveSearchKey(input: SaveSearchInput): string | undefined {
    if (input.apiKey !== undefined) return input.apiKey || undefined
    return this.getApiKey(SEARCH_SECRET_ID)
  }

  saveSearch({ config, apiKey }: SaveSearchInput): SettingsView {
    this.config.search = config
    this.storeSecret(SEARCH_SECRET_ID, apiKey)
    this.persist()
    return this.view()
  }

  setPetSkin(skin: PetSkinId): void {
    this.config.petSkin = skin
    this.persist()
  }

  activeProfile(): ProviderProfile | null {
    return this.config.profiles.find((p) => p.id === this.config.activeProfileId) ?? null
  }

  getApiKey(profileId: string): string | undefined {
    const stored = this.secrets[profileId]
    if (!stored) return undefined
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  }

  /** Key to use for an unsaved form: the typed one, else the stored one. */
  resolveApiKey(input: SaveProfileInput): string | undefined {
    if (input.apiKey !== undefined) return input.apiKey || undefined
    return this.getApiKey(input.profile.id)
  }

  saveProfile({ profile, apiKey }: SaveProfileInput): SettingsView {
    const idx = this.config.profiles.findIndex((p) => p.id === profile.id)
    if (idx >= 0) this.config.profiles[idx] = profile
    else this.config.profiles.push(profile)
    if (!this.config.activeProfileId) this.config.activeProfileId = profile.id

    this.storeSecret(profile.id, apiKey)
    this.persist()
    return this.view()
  }

  /** undefined = keep, '' = remove, otherwise encrypt and replace. */
  private storeSecret(id: string, value: string | undefined): void {
    if (value === '') delete this.secrets[id]
    else if (value !== undefined) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系統加密服務無法使用，無法安全儲存 API Key')
      this.secrets[id] = safeStorage.encryptString(value).toString('base64')
    }
  }

  deleteProfile(id: string): SettingsView {
    this.config.profiles = this.config.profiles.filter((p) => p.id !== id)
    delete this.secrets[id]
    if (this.config.activeProfileId === id) this.config.activeProfileId = this.config.profiles[0]?.id ?? null
    this.persist()
    return this.view()
  }

  setActive(id: string): SettingsView {
    if (this.config.profiles.some((p) => p.id === id)) {
      this.config.activeProfileId = id
      this.persist()
    }
    return this.view()
  }

  private persist(): void {
    writeJson(configPath(), this.config)
    writeJson(secretsPath(), this.secrets)
  }
}
