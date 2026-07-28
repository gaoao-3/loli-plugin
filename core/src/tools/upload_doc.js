/**
 * upload_doc — 上传文档到 AnythingLLM 知识库
 *
 * 工具定义：AI 可调用此工具上传文档
 * 需要通过 engine.setAnythingLLM() 注入客户端实例
 */

export const toolDef = {
  name: 'upload_doc',
  description: '上传文档到知识库。支持 PDF、Word、TXT、Markdown 等格式。上传后文档会自动解析并向量化。',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: '文件路径（本地文件系统路径）'
      },
      filename: {
        type: 'string',
        description: '文件名（可选，不传则从路径提取）'
      },
      add_to_workspace: {
        type: 'boolean',
        description: '上传后是否自动添加到当前工作区',
        default: true
      }
    },
    required: ['file_path']
  }
}

/** @type {import('./types').ToolRunFn} */
export async function run (args, context) {
  const { file_path, filename, add_to_workspace = true } = args

  if (!file_path) {
    return JSON.stringify({ error: 'file_path 参数不能为空' })
  }

  const client = context?.anythingllm
  if (!client) {
    return JSON.stringify({ error: 'AnythingLLM 未配置' })
  }

  try {
    // 读取文件
    const fs = await import('fs')
    const path = await import('path')

    if (!fs.existsSync(file_path)) {
      return JSON.stringify({ error: `文件不存在: ${file_path}` })
    }

    const fileBuffer = fs.readFileSync(file_path)
    const fname = filename || path.basename(file_path)

    // 上传
    const result = await client.uploadDocument({
      file: new Blob([fileBuffer]),
      filename: fname
    })

    // 自动添加到工作区
    if (add_to_workspace && result?.documents?.length > 0) {
      const docPaths = result.documents.map(d => d.docPath || d.location)
      await client.updateEmbeddings({ adds: docPaths })
    }

    return JSON.stringify({
      success: true,
      filename: fname,
      documents: result?.documents || [],
      added_to_workspace: add_to_workspace
    }, null, 2)
  } catch (err) {
    return JSON.stringify({ error: `文档上传失败: ${err.message}` })
  }
}
