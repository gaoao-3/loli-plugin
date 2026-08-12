---
name: qq-group-admin
description: >-
  执行当前 QQ 群的消息撤回、禁言或解禁、修改群名片或群名，以及带确认的踢人操作。
  用户明确要求“撤回消息、禁言、解除禁言、改名片、改群名、踢出或移出群成员”时使用。Use for explicit QQ group moderation requests such as recalling messages, muting members, renaming, or kicking a member.
allowed-tools: group_recall group_mute group_rename group_kick
---

# QQ Group Administration

- 撤回消息使用 `group_recall`。
- 禁言或解禁使用 `group_mute`。
- 修改群名片或群名使用 `group_rename`。
- 踢人使用 `group_kick`，严格遵循工具返回的二次确认流程。
- 让工具服务端校验权限、目标范围、证据和确认，不要自行假定操作已获授权。
- 不得根据昵称猜测 QQ 号，不得绕过主人或群权限限制。
