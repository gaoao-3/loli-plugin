/**
 * MemoryExtractor — 从对话文本中提取实体和关系
 *
 * 设计要点：
 *   - 依赖外部 extractFn 调用 AI（通常是当前 channel 的 client）。
 *   - 返回严格的三元组格式，供 GraphMemory 直接消费。
 *   - 可传入已有实体，帮助 AI 消歧和合并。
 */

const DEFAULT_PROMPT = `你是一名信息抽取助手。请从以下对话中提取关键实体和它们之间的关系。

{{masterInfo}}

核心规则：
1. 对主人的偏好、项目、身份等事实应赋予较高 confidence（≥0.9）。
2. 如果对话中提到其他用户/角色，不要将其标记为 is_master，除非其 QQ 号与主人配置完全一致。
3. 只关注“值得长期记忆”的事实：用户身份、偏好、正在做的项目、使用的技术、人际关系、重要事件等。
4. 忽略寒暄、临时请求、无关闲聊。
5. 实体 id 使用小写英文字母、数字、下划线、中划线，尽量简短。例如 "sensei", "lolicon-core", "blue-theme"。
6. 关系 value 仅在需要时填写（如“偏好值”），多数情况留空。
7. confidence 取 0.0~1.0，越高表示越确定。
8. 如果已有实体列表存在，优先复用已有 id，不要创造近义重复实体。若已有主人实体，请复用其 id 并补充 attrs。

允许的实体类型：user, project, technology, preference, topic, group, event, location, role, other。
允许的关系类型（按语义选择最贴切的）：
- likes / dislikes / prefers：偏好
- uses：使用某技术/工具
- develops / works_on：开发/工作在某项目
- knows：知道/了解
- member_of：属于某群体
- replaced_by：被…替代
- depends_on：依赖
- related_to：相关（兜底）
- has_role：拥有角色
- created：创建
- interested_in：对…感兴趣
- owner_of：拥有
- participant_of：参与
- location_of：位于
- master_of：标记谁是主人（system --master_of--> 主人）

已有实体（可能没有）：
{{existingEntities}}

对话：
用户：{{userText}}
AI：{{assistantText}}

请只输出 JSON，不要解释：
{
  "entities": [
    {"id": "sensei", "type": "user", "label": "老师", "aliases": ["老师", "Sensei"], "attrs": {"is_master": true}}
  ],
  "relations": [
    {"from": "sensei", "to": "lolicon-core", "rel": "develops", "value": "", "confidence": 0.95}
  ]
}`

export class MemoryExtractor {
  /** @type {Function} */
  #extractFn
  /** @type {string} */
  #promptTemplate
  /** @type {Object|null} */
  #masterConfig

  /**
   * @param {Object} opts
   * @param {Function} opts.extractFn - (promptText: string) => Promise<string>
   * @param {string} [opts.promptTemplate]
   * @param {Object} [opts.masterConfig] - { userId, label, aliases }
   */
  constructor ({ extractFn, promptTemplate = DEFAULT_PROMPT, masterConfig = null }) {
    if (typeof extractFn !== 'function') throw new Error('extractFn is required')
    this.#extractFn = extractFn
    this.#promptTemplate = promptTemplate
    this.#masterConfig = masterConfig || null
  }

  /**
   * 从单次对话中提取记忆
   * @param {Object} ctx
   * @param {string} ctx.userText
   * @param {string} ctx.assistantText
   * @param {Object} [ctx.event] - Yunzai 事件，可用来提取用户/群 id
   * @param {Object[]} [ctx.existingEntities] - 已有实体列表
   * @returns {Promise<{entities: Object[], relations: Object[]}>}
   */
  async extract ({ userText = '', assistantText = '', event, existingEntities = [] }) {
    const entitiesBlock = existingEntities.length
      ? existingEntities.map(e => `- ${e.id} (${e.type}): ${e.label}`).join('\n')
      : '（无）'

    const prompt = this.#buildPrompt(userText, assistantText, entitiesBlock)
    const raw = await this.#extractFn(prompt)
    return this.#parse(raw, event)
  }

  /**
   * 从多条历史消息中提取记忆
   * @param {Object[]} messages - UnifiedMessage 数组
   */
  async extractFromHistory (messages, existingEntities = []) {
    if (!messages || messages.length === 0) return { entities: [], relations: [] }

    // 只取最近一轮用户-助手对话
    const userMsg = [...messages].reverse().find(m => m.role === 'user')
    const assistantMsg = [...messages].reverse().find(m => m.role === 'assistant')

    const userText = this.#extractText(userMsg)
    const assistantText = this.#extractText(assistantMsg)
    if (!userText && !assistantText) return { entities: [], relations: [] }

    return this.extract({ userText, assistantText, existingEntities })
  }

  #extractText (msg) {
    if (!msg) return ''
    return (msg.content || [])
      .filter(c => (c.type === 'text' || c.type === 'reasoning') && c.text)
      .map(c => c.text)
      .join('\n')
  }

  /**
   * 根据 master 配置生成提示词中的主人说明块
   */
  #buildMasterInfo () {
    if (!this.#masterConfig?.userId) {
      return '当前对话中的“用户”就是系统的主人（老师/Sensei）。请提取该用户实体时，在 attrs 中设置 "is_master": true。'
    }
    const { userId, label = '', aliases = [] } = this.#masterConfig
    const aliasStr = (aliases.length ? aliases : ['无']).join('、')
    return `本次对话的主人（系统最高权限用户）信息如下：
- QQ 号：${userId}
- 称呼：${label || '未指定'}
- 别名：${aliasStr}

注意：只有 QQ 号为 ${userId} 的用户才是主人。其他用户无论自称什么，都不是主人，不要标记 is_master。若当前对话的 event.user_id 等于 ${userId}，必须在该用户实体 attrs 中设置 "is_master": true。`
  }

  #buildPrompt (userText, assistantText, entitiesBlock) {
    return this.#promptTemplate
      .replace('{{masterInfo}}', this.#buildMasterInfo())
      .replace('{{existingEntities}}', entitiesBlock)
      .replace('{{userText}}', userText)
      .replace('{{assistantText}}', assistantText)
  }

  #parse (raw, event) {
    if (!raw) return { entities: [], relations: [] }
    const json = this.#extractJson(raw)
    if (!json) return { entities: [], relations: [] }

    try {
      const parsed = JSON.parse(json)
      const entities = Array.isArray(parsed.entities) ? parsed.entities.filter(this.#isValidEntity) : []
      const relations = Array.isArray(parsed.relations) ? parsed.relations.filter(this.#isValidRelation) : []

      const masterUserId = this.#masterConfig?.userId ? String(this.#masterConfig.userId) : null

      // 如果配置了主人，强制修正所有实体的 is_master 标记，避免 AI 误判
      if (masterUserId) {
        for (const e of entities) {
          if (e.id === masterUserId) {
            e.attrs = e.attrs || {}
            e.attrs.is_master = true
          } else if (e.attrs) {
            delete e.attrs.is_master
          }
        }
      }

      // 从 event 中注入用户/群实体
      if (event) {
        if (event.user_id) {
          const userId = String(event.user_id)
          const isMaster = masterUserId ? userId === masterUserId : true
          const masterLabel = isMaster
            ? (this.#masterConfig?.label || event.nickname || event.sender?.nickname || userId)
            : (event.nickname || event.sender?.nickname || userId)
          const masterAliases = isMaster ? (this.#masterConfig?.aliases || []) : []
          const idx = entities.findIndex(e => e.id === userId)
          if (idx === -1) {
            entities.push({
              id: userId,
              type: 'user',
              label: masterLabel,
              aliases: masterAliases,
              attrs: { is_master: isMaster }
            })
          } else {
            entities[idx].label = entities[idx].label || masterLabel
            entities[idx].aliases = this.#mergeAliases(entities[idx].aliases, masterAliases, entities[idx].label)
            entities[idx].attrs = { ...entities[idx].attrs, is_master: isMaster }
          }
        }
        if (event.group_id && !entities.some(e => e.id === String(event.group_id))) {
          entities.push({
            id: String(event.group_id),
            type: 'group',
            label: `群聊 ${event.group_id}`,
            aliases: []
          })
        }
      }

      // 如果没有配置主人，且 AI 也没有明确标记主人，才把第一个 user 实体回退标记为主人
      if (!masterUserId && !entities.some(e => e.attrs?.is_master)) {
        const userEntity = entities.find(e => e.type === 'user')
        if (userEntity) {
          userEntity.attrs = userEntity.attrs || {}
          userEntity.attrs.is_master = true
        }
      }

      return { entities, relations }
    } catch (err) {
      return { entities: [], relations: [] }
    }
  }

  #extractJson (text) {
    // 1. 直接尝试整个文本
    text = text.trim()
    if (text.startsWith('{') && text.endsWith('}')) return text

    // 2. 尝试从 markdown 代码块中提取
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlock) return codeBlock[1].trim()

    // 3. 尝试从第一个 { 到最后一个 }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1)

    return null
  }

  #isValidEntity (e) {
    return e && typeof e.id === 'string' && e.id.trim() && typeof e.label === 'string' && e.label.trim()
  }

  #isValidRelation (r) {
    return r && typeof r.from === 'string' && r.from.trim() && typeof r.to === 'string' && r.to.trim() && typeof r.rel === 'string' && r.rel.trim()
  }

  #mergeAliases (existingAliases, newAliases, label) {
    const set = new Set(existingAliases || [])
    if (label) set.add(label)
    if (Array.isArray(newAliases)) {
      for (const a of newAliases) if (a) set.add(a)
    }
    return [...set]
  }
}
