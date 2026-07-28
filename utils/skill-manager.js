import fs from 'fs'
import path from 'path'
import YAML from 'yaml'

const SAFE_RESOURCE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv'])
const MAX_SKILL_CHARS = 30000
const MAX_RESOURCE_CHARS = 20000

function getRuntimeAdapter (skill) {
  if (String(skill?.metadata?.metadata?.author || '').toLowerCase() !== 'dokobot') return ''
  return `[loli-plugin Dokobot runtime adapter]
Do not execute Bash or raw dokobot CLI commands from this Skill. Use only the plugin tools exposed in the current conversation:
- dokobot_search: web search
- dokobot_read: read URLs and continue sessions
- dokobot_screenshot: capture a page
- dokobot_download_images: download and send page images
- dokobot_close_session: close a read session
If a listed tool is not currently exposed, do not simulate it; explain that the capability is unavailable. Shell snippets in the Skill are documentation only.`
}

function findSkillDirectories (root) {
  if (!fs.existsSync(root)) return []
  const candidates = []
  if (fs.existsSync(path.join(root, 'SKILL.md'))) candidates.push(root)
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md'))) candidates.push(path.join(root, entry.name))
  }
  return candidates
}

function parseSkillFile (filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/)
  if (!match) throw new Error('SKILL.md 缺少 YAML frontmatter')
  const metadata = YAML.parse(match[1]) || {}
  const name = String(metadata.name || '').trim()
  const description = String(metadata.description || '').trim()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('Skill name 格式无效')
  if (!description) throw new Error('Skill description 不能为空')
  const allowedTools = normalizeAllowedTools(metadata['allowed-tools'] ?? metadata.allowedTools)
  return { name, description, metadata, allowedTools, body: match[2].trim(), source }
}

function normalizeAllowedTools (value) {
  const entries = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,]+/u)
  return [...new Set(entries.map(item => String(item).trim()).filter(Boolean))]
}

function toolName (tool) {
  return tool?.name ||
    tool?.toolDef?.name ||
    tool?.toolDef?.function?.name ||
    tool?.function?.name ||
    ''
}

export function normalizeSkillsConfig (value = {}, pluginRoot = process.cwd()) {
  const directories = Array.isArray(value.directories) && value.directories.length > 0
    ? value.directories
    : ['skills']
  return {
    enable: value.enable === true,
    masterOnly: value.masterOnly === true,
    directories: directories.map(dir => path.isAbsolute(dir) ? path.normalize(dir) : path.resolve(pluginRoot, String(dir))),
    disabled: Array.isArray(value.disabled) ? value.disabled.map(String) : []
  }
}

export class SkillManager {
  #getConfig
  #pluginRoot
  #logger
  #skills = new Map()
  #signature = ''

  constructor ({ getConfig, pluginRoot, logger } = {}) {
    this.#getConfig = getConfig || (() => ({}))
    this.#pluginRoot = pluginRoot || process.cwd()
    this.#logger = logger || (() => {})
  }

  async init () {
    this.scan()
    return this
  }

  reload () {
    this.#signature = ''
    this.scan()
  }

  scan () {
    const config = normalizeSkillsConfig(this.#getConfig(), this.#pluginRoot)
    const candidates = config.enable ? config.directories.flatMap(findSkillDirectories) : []
    const files = candidates.map(dir => {
      const file = path.join(dir, 'SKILL.md')
      const stat = fs.statSync(file)
      return [file, stat.size, stat.mtimeMs]
    })
    const signature = JSON.stringify({ config, files })
    if (signature === this.#signature) return
    this.#signature = signature
    this.#skills.clear()
    if (!config.enable) return

    for (const skillDir of candidates) {
        try {
          const parsed = parseSkillFile(path.join(skillDir, 'SKILL.md'))
          if (config.disabled.includes(parsed.name)) continue
          this.#skills.set(parsed.name, { ...parsed, dir: path.resolve(skillDir) })
        } catch (err) {
          this.#logger(`[Skill] ${skillDir} load failed: ${err.message}`)
        }
    }
    this.#logger(`[Skill] ${this.#skills.size} skills loaded`)
  }

  #allowed ({ event } = {}) {
    const config = normalizeSkillsConfig(this.#getConfig(), this.#pluginRoot)
    return config.enable && (!config.masterOnly || event?.isMaster === true)
  }

  getCatalogContext (context = {}) {
    this.scan()
    if (!this.#allowed(context) || this.#skills.size === 0) return ''
    const lines = [...this.#skills.values()].map(skill => `- ${skill.name}: ${skill.description}`)
    return `[可用 Skills]\n遇到匹配任务时先调用 activate_skill 获取完整工作流；不要凭名称猜测说明。\n${lines.join('\n')}`
  }

  getTools (context = {}) {
    this.scan()
    if (!this.#allowed(context) || this.#skills.size === 0) return []
    const names = [...this.#skills.keys()]
    const activatedSkills = context?.toolState?.activatedSkills
    const tools = [
      {
        name: 'activate_skill',
        toolDef: {
          name: 'activate_skill',
          description: '加载一个已安装 Skill 的完整操作说明。匹配到可用 Skill 时先调用。',
          parameters: {
            type: 'object',
            properties: { name: { type: 'string', enum: names, description: 'Skill 名称' } },
            required: ['name']
          }
        },
        run: async ({ name }) => this.activate(name, context)
      }
    ]
    if (activatedSkills instanceof Set && activatedSkills.size > 0) {
      const activatedNames = names.filter(name => activatedSkills.has(name))
      tools.push({
        name: 'read_skill_resource',
        toolDef: {
          name: 'read_skill_resource',
          description: '读取 Skill 引用的文本资料，仅允许 Skill 目录内的安全文本文件。',
          parameters: {
            type: 'object',
            properties: {
              skill: { type: 'string', enum: activatedNames },
              resource: { type: 'string', description: '相对于 Skill 目录的文件路径' }
            },
            required: ['skill', 'resource']
          }
        },
        run: async ({ skill, resource }) => this.readResource(skill, resource)
      })
    }
    return tools
  }

  /**
   * 返回当前请求已激活 Skill 允许使用的本地工具。
   * Skills 关闭时保持旧行为：本地工具全部可用。
   */
  getLocalTools (availableTools = [], context = {}) {
    this.scan()
    const config = normalizeSkillsConfig(this.#getConfig(), this.#pluginRoot)
    if (!config.enable) return [...availableTools]
    if (this.#skills.size === 0) return [...availableTools]
    if (!this.#allowed(context)) return []
    const activatedSkills = context?.toolState?.activatedSkills
    if (!(activatedSkills instanceof Set) || activatedSkills.size === 0) return []

    const allowedNames = new Set()
    for (const skillName of activatedSkills) {
      const skill = this.#skills.get(String(skillName))
      for (const name of (skill?.allowedTools || [])) allowedNames.add(name)
    }
    return availableTools.filter(tool => allowedNames.has(toolName(tool)))
  }

  activate (name, context = {}) {
    this.scan()
    const skill = this.#skills.get(String(name || ''))
    if (!skill) throw new Error(`Skill "${name}" 未安装或已禁用`)
    if (context?.toolState?.activatedSkills instanceof Set) {
      context.toolState.activatedSkills.add(skill.name)
    }
    const adapter = getRuntimeAdapter(skill)
    const prefix = `[Skill activated: ${skill.name}]${adapter ? `\n${adapter}` : ''}\n`
    const availableChars = Math.max(0, MAX_SKILL_CHARS - prefix.length)
    const content = skill.source.slice(0, availableChars)
    return `${prefix}${content}${skill.source.length > availableChars ? '\n…[truncated]' : ''}`
  }

  readResource (skillName, relativePath) {
    this.scan()
    const skill = this.#skills.get(String(skillName || ''))
    if (!skill) throw new Error(`Skill "${skillName}" 未安装或已禁用`)
    const requested = String(relativePath || '').replace(/\\/g, '/')
    if (!requested || requested.includes('\0')) throw new Error('资源路径无效')
    const resolved = path.resolve(skill.dir, requested)
    const relative = path.relative(skill.dir, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('禁止读取 Skill 目录外文件')
    if (!SAFE_RESOURCE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) throw new Error('仅允许读取文本资料，不执行 scripts')
    const text = fs.readFileSync(resolved, 'utf8')
    return text.length > MAX_RESOURCE_CHARS ? `${text.slice(0, MAX_RESOURCE_CHARS)}\n…[truncated]` : text
  }

  getStatus () {
    this.scan()
    const config = normalizeSkillsConfig(this.#getConfig(), this.#pluginRoot)
    return {
      enabled: config.enable,
      directories: config.directories,
      skills: [...this.#skills.values()].map(skill => ({
        name: skill.name,
        description: skill.description,
        allowedTools: skill.allowedTools,
        path: skill.dir
      }))
    }
  }
}
