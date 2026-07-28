/**
 * search_docs — 搜索 AnythingLLM 文档知识库
 *
 * 工具定义：AI 可调用此工具检索文档，返回引用来源
 * 需要通过 engine.setAnythingLLM() 注入客户端实例
 */

export const toolDef = {
  name: 'search_docs',
  description: '搜索文档知识库。当用户询问产品功能、技术文档、使用说明、配置方法等需要查阅资料的问题时调用此工具。返回相关文档片段和引用来源。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索查询，用自然语言描述要查找的内容'
      },
      mode: {
        type: 'string',
        enum: ['query', 'chat'],
        description: '检索模式：query=纯检索（推荐），chat=带上下文的对话检索',
        default: 'query'
      },
      workspace: {
        type: 'string',
        description: '工作区 slug，不传则使用默认工作区'
      }
    },
    required: ['query']
  }
}

/** @type {import('./types').ToolRunFn} */
export async function run (args, context) {
  const { query, mode = 'query', workspace } = args

  if (!query) {
    return JSON.stringify({ error: 'query 参数不能为空' })
  }

  // 从上下文获取 AnythingLLM 客户端
  const client = context?.anythingllm
  if (!client) {
    return JSON.stringify({
      error: 'AnythingLLM 未配置',
      hint: '请在 engine 初始化时传入 anythingllm 配置，或调用 engine.setAnythingLLM() 注入客户端'
    })
  }

  try {
    const result = await client.chat({ message: query, mode, workspace })

    // 格式化输出
    const output = {
      answer: result.textResponse,
      sources: result.sources.map(s => ({
        title: s.title || s.docName || '未知文档',
        snippet: s.chunk || s.text || '',
        score: s.score || 0,
        docPath: s.docPath || ''
      }))
    }

    return JSON.stringify(output, null, 2)
  } catch (err) {
    return JSON.stringify({
      error: `AnythingLLM 查询失败: ${err.message}`,
      query
    })
  }
}
