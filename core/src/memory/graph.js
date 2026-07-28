/**
 * GraphMemory — 结构化记忆图谱
 *
 * 设计思路：
 *   - 用 LoliStorage 做持久化，实体/关系分别存 key，避免全量重写。
 *   - 内存中维护完整图，启动时加载，关闭时 flush。
 *   - 支持实体去重、关系冲突消解、关系链召回、Markdown 导出。
 *
 * 存储 key 约定：
 *   me:entity:{id}  — 实体
 *   me:relation:{id} — 关系
 *   me:meta         — 图元信息（version, lastUpdated）
 *
 * 实体 Entity:
 *   id, type, label, aliases[], attrs{}, created_at, updated_at, last_used, hit_count
 *
 * 关系 Relation:
 *   id, from, to, rel, value?, confidence, created_at, updated_at, source, history[]
 */

const ENTITY_TYPES = new Set([
  'user', 'project', 'technology', 'preference', 'topic', 'group', 'event', 'location', 'role', 'other'
])

const RELATIONS = new Set([
  'likes', 'dislikes', 'prefers', 'uses', 'develops', 'works_on', 'knows',
  'member_of', 'replaced_by', 'depends_on', 'related_to', 'has_role', 'created',
  'interested_in', 'owner_of', 'participant_of', 'location_of', 'master_of'
])

export class GraphMemory {
  /** @type {Map<string, Object>} */
  entities = new Map()
  /** @type {Map<string, Object>} */
  relations = new Map()
  /** @type {LoliStorage} */
  storage
  /** @type {Function} */
  logger

  constructor (storage, opts = {}) {
    this.storage = storage
    this.logger = opts.logger || (() => {})
  }

  async init () {
    await this.#load()
    this.logger('[memory] graph loaded, entities=%d relations=%d', this.entities.size, this.relations.size)
    return this
  }

  async destroy () {
    await this.#save()
  }

  // ─── 实体操作 ─────────────────────────────────────

  /**
   * 添加或更新实体
   * @param {Object} entity
   */
  addEntity (entity) {
    if (!entity.id) throw new Error('entity.id is required')
    if (!entity.type || !ENTITY_TYPES.has(entity.type)) {
      entity.type = 'other'
    }
    const now = Date.now()
    const existing = this.entities.get(entity.id)
    if (existing) {
      existing.aliases = this.#mergeAliases(existing.aliases, entity.aliases, entity.label)
      existing.label = entity.label || existing.label
      existing.attrs = { ...existing.attrs, ...(entity.attrs || {}) }
      existing.updated_at = now
      existing.last_used = now
      existing.hit_count = (existing.hit_count || 0) + 1
    } else {
      this.entities.set(entity.id, {
        id: entity.id,
        type: entity.type,
        label: entity.label || entity.id,
        aliases: this.#normalizeAliases(entity.aliases, entity.label),
        attrs: entity.attrs || {},
        created_at: entity.created_at || now,
        updated_at: now,
        last_used: now,
        hit_count: 1
      })
    }
    this.#scheduleSave()
    return this.entities.get(entity.id)
  }

  /**
   * 查找实体：先按 id，再按 label/alias 模糊匹配
   */
  findEntity (idOrLabel) {
    if (!idOrLabel) return null
    const key = String(idOrLabel).trim().toLowerCase()
    // 1. 精确 id
    if (this.entities.has(key)) return this.entities.get(key)
    // 2. label / alias 匹配
    for (const e of this.entities.values()) {
      if (e.label.toLowerCase() === key) return e
      if (e.aliases && e.aliases.some(a => a.toLowerCase() === key)) return e
    }
    return null
  }

  /**
   * 确保实体存在，不存在则创建
   */
  ensureEntity (id, type, label, aliases) {
    const existing = this.findEntity(id) || this.findEntity(label)
    if (existing) return existing
    return this.addEntity({ id, type, label, aliases })
  }

  // ─── 关系操作 ─────────────────────────────────────

  /**
   * 添加或合并关系
   * @param {Object} relation
   */
  addRelation (relation) {
    if (!relation.from || !relation.to || !relation.rel) {
      throw new Error('relation.from/to/rel are required')
    }
    if (!RELATIONS.has(relation.rel)) {
      relation.rel = 'related_to'
    }
    const now = Date.now()
    const id = this.#relationId(relation.from, relation.rel, relation.to)
    const existing = this.relations.get(id)

    if (existing) {
      // 冲突消解：保留置信度更高或更新的值
      const shouldUpdate = (relation.confidence || 0) > (existing.confidence || 0) ||
        relation.value !== existing.value
      if (shouldUpdate) {
        existing.history = existing.history || []
        existing.history.push({
          value: existing.value,
          confidence: existing.confidence,
          updated_at: existing.updated_at
        })
        existing.value = relation.value
        existing.confidence = relation.confidence || existing.confidence
      }
      existing.updated_at = now
      existing.hit_count = (existing.hit_count || 0) + 1
    } else {
      this.relations.set(id, {
        id,
        from: relation.from,
        to: relation.to,
        rel: relation.rel,
        value: relation.value,
        confidence: relation.confidence || 0.8,
        created_at: relation.created_at || now,
        updated_at: now,
        source: relation.source || 'unknown',
        history: [],
        hit_count: 1
      })
    }
    // 确保两端实体存在
    this.ensureEntity(relation.from, 'other', relation.from)
    this.ensureEntity(relation.to, 'other', relation.to)
    this.#scheduleSave()
    return this.relations.get(id)
  }

  /**
   * 批量合并实体和关系
   * @param {Object} extracted
   * @param {Object[]} extracted.entities
   * @param {Object[]} extracted.relations
   * @param {Object} sourceContext
   */
  mergeExtracted ({ entities = [], relations = [] }, sourceContext = {}) {
    const entityMap = new Map()
    for (const e of entities) {
      const added = this.addEntity(e)
      entityMap.set(e.id || e.label, added)
    }
    for (const r of relations) {
      this.addRelation({
        ...r,
        source: sourceContext.source || r.source || 'extracted',
        created_at: sourceContext.timestamp || Date.now()
      })
    }
    this.#scheduleSave()
    return { entityCount: this.entities.size, relationCount: this.relations.size }
  }

  // ─── 召回 ───────────────────────────────────────

  /**
   * 召回与给定实体相关的记忆
   * @param {Object} params
   * @param {string} params.entityId
   * @param {number} [params.depth=1] 关系链深度
   * @param {number} [params.limit=10] 最大关系数
   * @param {number} [params.minConfidence=0.5]
   */
  recall ({ entityId, depth = 1, limit = 10, minConfidence = 0.5 }) {
    if (!entityId) return { entities: [], relations: [], text: '' }
    const start = this.findEntity(entityId)
    if (!start) return { entities: [], relations: [], text: '' }

    const visited = new Set([start.id])
    const resultEntities = [start]
    const resultRelations = []
    let frontier = [start.id]

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const nextFrontier = []
      for (const fromId of frontier) {
        for (const r of this.relations.values()) {
          if (r.confidence < minConfidence) continue
          const relatedId = r.from === fromId ? r.to : (r.to === fromId ? r.from : null)
          if (!relatedId) continue
          if (!visited.has(relatedId)) {
            visited.add(relatedId)
            const e = this.entities.get(relatedId)
            if (e) {
              resultEntities.push(e)
              nextFrontier.push(relatedId)
            }
          }
          resultRelations.push(r)
        }
      }
      frontier = nextFrontier
    }

    // 按置信度和最近使用排序，截断
    resultRelations.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    const topRelations = resultRelations.slice(0, limit)
    const topEntityIds = new Set([start.id, ...topRelations.map(r => r.from), ...topRelations.map(r => r.to)])
    const topEntities = [...topEntityIds].map(id => this.entities.get(id)).filter(Boolean)

    return {
      entities: topEntities,
      relations: topRelations,
      text: this.formatRelationsText(topEntities, topRelations, start.id)
    }
  }

  /**
   * 多实体召回，并合并结果
   */
  recallMany ({ entityIds = [], depth = 1, limit = 15, minConfidence = 0.5 }) {
    const merged = { entities: new Map(), relations: new Map() }
    for (const id of entityIds) {
      const res = this.recall({ entityId: id, depth, limit, minConfidence })
      for (const e of res.entities) merged.entities.set(e.id, e)
      for (const r of res.relations) merged.relations.set(r.id, r)
    }
    const relations = [...merged.relations.values()]
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, limit)
    const entityIdsSet = new Set([...entityIds, ...relations.map(r => r.from), ...relations.map(r => r.to)])
    const entities = [...entityIdsSet].map(id => this.entities.get(id)).filter(Boolean)
    return { entities, relations, text: this.formatRelationsText(entities, relations) }
  }

  /**
   * 文本关键词召回：匹配实体 label/alias 和关系文本
   */
  recallByText (text, { limit = 10, minConfidence = 0.5 } = {}) {
    if (!text) return { entities: [], relations: [], text: '' }

    // 关键词：英文空格分词 + 中文 2-gram
    const words = []
    for (const w of text.toLowerCase().split(/\s+/)) {
      if (w.length > 1) words.push(w)
    }
    const zhText = text.replace(/[^\u4e00-\u9fa5]/g, '')
    for (let i = 0; i < zhText.length - 1; i++) {
      words.push(zhText[i] + zhText[i + 1])
    }
    if (words.length === 0) return { entities: [], relations: [], text: '' }

    const matchedEntities = new Set()
    for (const e of this.entities.values()) {
      const haystack = [e.label, ...(e.aliases || []), e.type].join(' ').toLowerCase()
      if (words.some(w => haystack.includes(w))) matchedEntities.add(e.id)
    }
    return this.recallMany({ entityIds: [...matchedEntities], depth: 1, limit, minConfidence })
  }

  // ─── Markdown 导出 ───────────────────────────────

  /**
   * 导出整个图的可读 Markdown
   */
  toMarkdown () {
    const lines = ['# 记忆图谱\n']
    lines.push('## 实体\n')
    const sortedEntities = [...this.entities.values()].sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label))
    for (const e of sortedEntities) {
      const masterTag = e.attrs?.is_master ? ' 👑主人' : ''
      lines.push(`### ${e.label} \`${e.id}\` (${e.type})${masterTag}`)
      if (e.aliases && e.aliases.length) lines.push(`- 别名: ${e.aliases.join(', ')}`)
      if (Object.keys(e.attrs || {}).length) {
        lines.push('- 属性:')
        for (const [k, v] of Object.entries(e.attrs)) {
          if (k === 'is_master') continue
          lines.push(`  - ${k}: ${v}`)
        }
      }
      lines.push('')
    }
    lines.push('## 关系\n')
    const sortedRelations = [...this.relations.values()].sort((a, b) => a.from.localeCompare(b.from) || a.rel.localeCompare(b.rel))
    for (const r of sortedRelations) {
      const from = this.entities.get(r.from)?.label || r.from
      const to = this.entities.get(r.to)?.label || r.to
      const value = r.value ? ` → ${r.value}` : ''
      lines.push(`- **${from}** ${r.rel} **${to}**${value} (置信度: ${r.confidence}, 来源: ${r.source})`)
    }
    return lines.join('\n')
  }

  // ─── 内部 ─────────────────────────────────────────

  async #load () {
    const entityKeys = await this.storage.getAllByPrefix('me:entity:')
    for (const e of entityKeys) {
      if (e && e.id) this.entities.set(e.id, e)
    }
    const relationKeys = await this.storage.getAllByPrefix('me:relation:')
    for (const r of relationKeys) {
      if (r && r.id) this.relations.set(r.id, r)
    }
  }

  #saveTimer = null
  #scheduleSave () {
    clearTimeout(this.#saveTimer)
    this.#saveTimer = setTimeout(() => this.#save(), 1000)
  }

  async #save () {
    for (const e of this.entities.values()) {
      await this.storage.put('me:entity:' + e.id, e)
    }
    for (const r of this.relations.values()) {
      await this.storage.put('me:relation:' + r.id, r)
    }
    await this.storage.put('me:meta', {
      version: 1,
      lastUpdated: Date.now(),
      entityCount: this.entities.size,
      relationCount: this.relations.size
    })
    this.logger('[memory] graph saved, entities=%d relations=%d', this.entities.size, this.relations.size)
  }

  #normalizeAliases (aliases, label) {
    const set = new Set()
    if (label) set.add(label)
    if (Array.isArray(aliases)) {
      for (const a of aliases) if (a) set.add(a)
    }
    return [...set]
  }

  #mergeAliases (existingAliases, newAliases, newLabel) {
    const set = new Set(existingAliases || [])
    if (newLabel) set.add(newLabel)
    if (Array.isArray(newAliases)) {
      for (const a of newAliases) if (a) set.add(a)
    }
    return [...set]
  }

  #relationId (from, rel, to) {
    return [from, rel, to].map(s => String(s).trim().toLowerCase()).join('::')
  }

  formatRelationsText (entities, relations, centerId) {
    if (!relations.length) return ''
    const center = entities.find(e => e.id === centerId)
    const lines = []
    if (center) lines.push(`关于“${center.label}”的相关记忆：`)
    for (const r of relations) {
      const from = entities.find(e => e.id === r.from)?.label || r.from
      const to = entities.find(e => e.id === r.to)?.label || r.to
      const value = r.value ? `，值为 ${r.value}` : ''
      lines.push(`- ${from} ${r.rel} ${to}${value}。`)
    }
    return lines.join('\n')
  }
}
