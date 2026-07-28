---
name: qq-group-admin
description: 在当前 QQ 群执行撤回、禁言、解禁、修改群名片或群名，以及带确认流程的踢人操作。
allowed-tools: group_recall group_mute group_rename group_kick
---

# QQ Group Administration

仅在当前消息明确涉及群管理动作时使用。所有权限、目标范围、证据和确认仍由工具服务端校验。

- 撤回消息使用 `group_recall`。
- 禁言或解禁使用 `group_mute`。
- 修改群名片或群名使用 `group_rename`。
- 踢人使用 `group_kick`，严格遵循工具返回的二次确认流程。
- 不得根据昵称猜测 QQ 号，不得绕过主人或群权限限制。
