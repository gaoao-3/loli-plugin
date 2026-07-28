/**
 * Memory — 结构化记忆图谱的入口封装
 *
 * 把 GraphMemory + MemoryExtractor + MemoryInjector 组合成一套接口，
 * 供 LoliEngine 直接使用。
 */

import { GraphMemory } from './graph.js'
import { MemoryExtractor } from './extractor.js'
import { MemoryInjector } from './injector.js'

export class Memory {
  graph
  extractor
  injector
  logger
  master

  /**
   * @param {Object} opts
   * @param {LoliStorage} opts.storage
   * @param {Function} [opts.extractFn] - AI 提取函数，若为空则只读记忆
   * @param {Function} [opts.logger]
   * @param {Object} [opts.injectorOpts]
   * @param {Object} [opts.master] - 主人配置 { userId, label, aliases }
   */
  constructor (opts) {
    this.graph = new GraphMemory(opts.storage, { logger: opts.logger })
    this.extractor = opts.extractFn
      ? new MemoryExtractor({ extractFn: opts.extractFn, masterConfig: opts.master || null })
      : null
    this.injector = new MemoryInjector(opts.injectorOpts || {})
    this.logger = opts.logger || (() => {})
    this.master = opts.master || {}
  }

  async init () {
    await this.graph.init()
    return this
  }

  async destroy () {
    await this.graph.destroy()
  }

  /**
   * 召回相关记忆文本
   * @param {Object} params
   * @param {string} [params.userId]
   * @param {string} [params.groupId]
   * @param {string} [params.queryText]
   * @param {number} [params.limit]
   */
  recall ({ userId, groupId, queryText, limit = 10 } = {}) {
    const entityIds = []
    if (userId) entityIds.push(String(userId))
    if (groupId) entityIds.push(String(groupId))

    // 如果没有明确实体，但知道主人，则优先召回主人相关记忆
    if (entityIds.length === 0 && queryText) {
      if (this.master?.userId) {
        entityIds.push(String(this.master.userId))
      } else {
        const masters = [...this.graph.entities.values()].filter(e => e.attrs?.is_master)
        for (const m of masters) {
          if (!entityIds.includes(m.id)) entityIds.push(m.id)
        }
      }
    }

    let result
    if (entityIds.length > 0 && queryText) {
      // 既有实体又有文本：先按实体召回，再用文本补充
      const entityResult = this.graph.recallMany({ entityIds, depth: 2, limit: limit * 2, minConfidence: 0.5 })
      const textResult = this.graph.recallByText(queryText, { limit: limit * 2, minConfidence: 0.5 })
      // 合并关系并按置信度排序，主人相关关系优先
      const mergedRelations = new Map([
        ...entityResult.relations.map(r => [r.id, r]),
        ...textResult.relations.map(r => [r.id, r])
      ])
      const relations = this.#sortRelationsByMaster([...mergedRelations.values()], entityIds).slice(0, limit)
      const entitySet = new Map()
      for (const e of entityResult.entities) entitySet.set(e.id, e)
      for (const e of textResult.entities) entitySet.set(e.id, e)
      for (const r of relations) {
        entitySet.set(r.from, this.graph.entities.get(r.from))
        entitySet.set(r.to, this.graph.entities.get(r.to))
      }
      const entities = [...entitySet.values()].filter(Boolean)
      result = { entities, relations, text: this.graph.formatRelationsText(entities, relations) }
    } else if (entityIds.length > 0) {
      result = this.graph.recallMany({ entityIds, depth: 2, limit, minConfidence: 0.5 })
      // 主人相关优先
      result.relations = this.#sortRelationsByMaster(result.relations, entityIds).slice(0, limit)
      result.text = this.graph.formatRelationsText(result.entities, result.relations)
    } else if (queryText) {
      result = this.graph.recallByText(queryText, { limit, minConfidence: 0.5 })
    } else {
      return ''
    }

    return this.injector.buildPrompt(result)
  }

  /**
   * 排序：主人相关关系优先，其次按置信度
   */
  #sortRelationsByMaster (relations, priorityIds) {
    const masterIds = new Set([
      ...priorityIds,
      ...(this.master?.userId ? [String(this.master.userId)] : []),
      ...[...this.graph.entities.values()].filter(e => e.attrs?.is_master).map(e => e.id)
    ])
    return relations.sort((a, b) => {
      const aIsMaster = masterIds.has(a.from) || masterIds.has(a.to) ? 1 : 0
      const bIsMaster = masterIds.has(b.from) || masterIds.has(b.to) ? 1 : 0
      if (aIsMaster !== bIsMaster) return bIsMaster - aIsMaster
      return (b.confidence || 0) - (a.confidence || 0)
    })
  }

  /**
   * 从一次完整对话中提取并保存记忆
   * @param {Object} params
   * @param {string} params.userText
   * @param {string} params.assistantText
   * @param {Object} [params.event]
   */
  async record ({ userText, assistantText, event }) {
    if (!this.extractor) return
    if (!userText && !assistantText) return

    try {
      const existingEntities = [...this.graph.entities.values()]
      const extracted = await this.extractor.extract({ userText, assistantText, event, existingEntities })
      if (extracted.entities.length === 0 && extracted.relations.length === 0) return

      const eventUserId = event?.user_id ? String(event.user_id) : null
      const masterUserId = this.master?.userId ? String(this.master.userId) : null

      // 自动关联用户和群实体
      if (eventUserId && event?.group_id) {
        extracted.relations.push({
          from: eventUserId,
          to: String(event.group_id),
          rel: 'member_of',
          confidence: 1.0,
          source: 'event'
        })
      }

      // 把平台用户 ID 和 AI 提取的 user 实体关联起来
      if (eventUserId) {
        const userEntity = extracted.entities.find(e => e.type === 'user')
        if (userEntity && userEntity.id !== eventUserId) {
          extracted.relations.push({
            from: eventUserId,
            to: userEntity.id,
            rel: 'related_to',
            confidence: 1.0,
            source: 'event'
          })
        }
      }

      // 确保主人实体存在，并标记 system -> 主人的 master_of 关系
      if (masterUserId) {
        this.#ensureMasterEntity(extracted, masterUserId)
      } else if (eventUserId) {
        // 未配置主人时，回退：把当前 event 用户当作主人
        extracted.relations.push({
          from: 'system',
          to: eventUserId,
          rel: 'master_of',
          confidence: 1.0,
          source: 'event'
        })
      }

      this.graph.mergeExtracted(extracted, { source: 'conversation', timestamp: Date.now() })
      this.logger('[memory] recorded %d entities, %d relations', extracted.entities.length, extracted.relations.length)
    } catch (err) {
      this.logger('[memory] record error: %s', err.message)
    }
  }

  /**
   * 确保主人实体在提取结果中存在，并添加 system -> master 的 master_of 关系
   */
  #ensureMasterEntity (extracted, masterUserId) {
    const idx = extracted.entities.findIndex(e => e.id === masterUserId)
    if (idx === -1) {
      extracted.entities.push({
        id: masterUserId,
        type: 'user',
        label: this.master?.label || masterUserId,
        aliases: Array.isArray(this.master?.aliases) ? this.master.aliases : [],
        attrs: { is_master: true }
      })
    } else {
      extracted.entities[idx].attrs = extracted.entities[idx].attrs || {}
      extracted.entities[idx].attrs.is_master = true
    }
    extracted.relations.push({
      from: 'system',
      to: masterUserId,
      rel: 'master_of',
      confidence: 1.0,
      source: 'master_config'
    })
  }

  /**
   * 导出可读 Markdown
   */
  toMarkdown () {
    return this.graph.toMarkdown()
  }
}

export { GraphMemory, MemoryExtractor, MemoryInjector }
