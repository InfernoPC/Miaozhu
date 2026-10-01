import { readdir, readFile, realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { isInside } from '../tools/paths'
import { ToolError, type ToolDef } from '../tools/types'
import { splitFrontmatter, type Skill } from './manifest'

const MAX_FILE_CHARS = 40_000

export interface SkillEntry extends Skill {
  pluginName: string
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFiles(abs, base)))
    else if (e.isFile() && e.name !== 'SKILL.md') out.push(relative(base, abs))
  }
  return out
}

/**
 * `load_skill` gives the model a skill's full instructions only when it decides to use it
 * (progressive disclosure: the system prompt carries just names and descriptions). It can also
 * read the files a skill ships with, but nothing outside that skill's folder.
 */
export function loadSkillTool(skills: () => SkillEntry[]): ToolDef {
  return {
    spec: {
      name: 'load_skill',
      description:
        '讀取已安裝技能的完整說明。當使用者的需求符合系統說明中列出的某個技能時，先用這個工具讀取該技能，再照著做。技能附帶的參考檔可用 file 參數讀取。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '技能名稱，照系統說明中列出的寫' },
          file: { type: 'string', description: '（選填）技能資料夾內的檔案相對路徑，例如 references/報帳規定.md' }
        },
        required: ['name']
      }
    },
    risk: 'read',
    title: (i) => `讀取技能「${String(i.name)}」${i.file ? `的 ${String(i.file)}` : ''}`,
    async run(i) {
      const skill = skills().find((s) => s.name === i.name)
      if (!skill) {
        const names = skills().map((s) => s.name)
        throw new ToolError(`沒有名為「${String(i.name)}」的技能。已安裝的技能：${names.join('、') || '（無）'}`)
      }
      if (typeof i.file === 'string' && i.file.trim()) {
        const root = await realpath(skill.dir)
        const target = await realpath(join(skill.dir, i.file)).catch(() => null)
        // Resolved paths, so neither ../ nor a symlink can step out of the skill folder.
        if (!target || !isInside(target, root)) throw new ToolError(`找不到技能檔案：${i.file}`)
        const text = await readFile(target, 'utf8')
        return {
          text: text.length > MAX_FILE_CHARS ? text.slice(0, MAX_FILE_CHARS) + '\n…（內容過長，已截斷）' : text,
          summary: `${i.file}`
        }
      }
      const { body } = splitFrontmatter(await readFile(join(skill.dir, 'SKILL.md'), 'utf8'))
      const files = await listFiles(skill.dir)
      const extra = files.length ? `\n\n---\n這個技能附帶的檔案（需要時用 load_skill 的 file 參數讀取）：\n${files.map((f) => `- ${f}`).join('\n')}` : ''
      return { text: `# 技能：${skill.name}（來自外掛「${skill.pluginName}」）\n\n${body.trim()}${extra}`, summary: '已載入' }
    }
  }
}
