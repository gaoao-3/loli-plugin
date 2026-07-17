# loli-plugin 管理面板

loli-plugin 自带 Web 管理面板，随 Yunzai 启动自动运行，无需额外启动服务。

## 访问地址

启动 Yunzai 后，浏览器打开：

```
http://localhost:3000
```

如果端口冲突，在 `data/config.json` 中修改 `dashboard.port`。

## 配置

`data/config.json`：

```json
{
  "dashboard": {
    "enable": true,
    "port": 3000,
    "host": "0.0.0.0",
    "authToken": ""
  }
}
```

- `enable`：是否启用面板
- `port`：面板端口
- `host`：绑定地址
- `authToken`：访问令牌（目前预留，未启用校验）

## 功能

- **总览**：系统状态、渠道数、工具数、运行时间
- **渠道管理**：查看/编辑/启用禁用 AI 渠道
- **预设管理**：查看/编辑/启用禁用角色预设
- **工具管理**：热重载、上传工具文件、启用禁用工具
- **记忆系统**：记忆实体/关系统计
- **系统配置**：修改 loli-plugin 核心配置
- **运行日志**：查看插件运行日志

## 上传工具

通过面板"工具"页面上传 `.js` 文件，文件会保存到 `utils/tools/` 目录。禁用工具会被移动到 `utils/tools/disabled/`。

工具文件格式：

```javascript
export default async function myTool (args) {
  return 'result'
}

myTool.description = '工具描述'

export const function = {
  name: 'my_tool',
  description: '工具描述',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' }
    },
    required: ['query']
  }
}
```

## 开发

面板文件位于 `dashboard/` 目录：

```
dashboard/
├── index.html      # 入口页面
├── css/style.css   # 样式
└── js/app.js       # 前端逻辑
```

后端 API 位于 `server/` 目录。

## 注意事项

- 面板仅作为管理辅助，关键操作前请备份 `data/config.json`。
- 修改配置后，部分设置可能需要重启 Yunzai 才能完全生效。
