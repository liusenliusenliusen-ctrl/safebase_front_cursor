---
name: safebase-chat-eval
description: >-
  Evaluates and improves SafeBase trauma-healing chat quality: prompt.ts tuning, contextual
  user simulation, dialogue export, text-chat style rules (no stage directions),
  and analysis of SIMULATED_USER_DIALOGUES.md. Use when simulating users, re-running
  conversations, exporting dialogues, fixing fake dialogue tone, or reviewing
  healing companion replies.
---

# SafeBase Chat Eval

## Key files

| 用途 | 路径 |
|------|------|
| 疗愈伙伴 system prompt | `safebase_backend_cursor/src/chat/prompt.ts` |
| RAG + 流式 | `safebase_backend_cursor/src/chat/memory.ts`, `routes.ts` |
| 前端停止/流式 | `safebase_front_cursor/src/api/chatStream.ts`, `stores/chatStore.ts` |
| 模拟用户脚本 | `safebase_front_cursor/scripts/seed-trauma-users.mjs` |
| 导出对话 | `safebase_front_cursor/scripts/export-dialogues.mjs` |
| 对话分析文档 | `safebase_front_cursor/docs/SIMULATED_USER_DIALOGUES.md` |

## 模拟用户（必须先起 backend :8000 + Docker）

```bash
cd safebase_backend_cursor && docker compose up -d && npm run dev

cd safebase_front_cursor
node scripts/seed-trauma-users.mjs              # 全量：清空消息+日记，10 轮+2 日记
node scripts/seed-trauma-users.mjs --chat-only # 仅重做对话，保留日记
node scripts/export-dialogues.mjs             # 导出到 docs/SIMULATED_USER_DIALOGUES.md
```

测试账号（本地）：`lin_morning` / `chen_night` / `su_river`，密码 `lb6325515`。

## 用户消息生成原则（模拟脚本已固化）

**必须是 App 打字风格**，不是剧本/配音：

- ✅ 直接写想法感受：`今天开会被点名，我脑子一片空白……`
- ❌ 舞台指示：`（停顿了一会）`、`（小声）`、`（低头玩手指）`
- ❌ 动作旁白：`对着镜子微笑……`
- 每轮用户消息须**回应疗愈伙伴上一轮**，由 LLM 根据完整历史动态生成，不要预写 10 条固定台词。

脚本读取 `safebase_backend_cursor/.env` 的 `OPENROUTER_API_KEY` 生成用户侧；疗愈伙伴走真实 `/api/chat/stream`。

## 疗愈伙伴 prompt 要点（`prompt.ts`）

- 只输出口语中文，**禁止**括号动作、Markdown 标题、编号列表体。
- 结构：具体反映 → 整合串联 → 温和假设 → 贴地收尾。
- 篇幅：长自述 400–800 字；日常 150–350；急性 distress 120–250。
- 引用 RAG 块（画像/摘要/锚点/日记）中至少一处真实细节，不捏造。

改 prompt 后：**重启 backend**（本地 `npm run dev`；生产 `pm2 restart safebase-backend --update-env`）。

## 评估 checklist（分析导出文档时用）

**用户侧**

- [ ] 无括号/星号动作描写
- [ ] 像打字而非朗诵
- [ ] 每轮回应了伙伴上一轮内容
- [ ] 有人设一致性（冻结/讨好/解离等）

**疗愈伙伴侧**

- [ ] 反映用户具体用词，非空洞「你很勇敢」
- [ ] 未堆砌 ①②③ 或报告体
- [ ] 引用记忆/日记时有据，无幻觉
- [ ] 篇幅与场景匹配
- [ ] 无「你应该」说教

## 清空模拟数据（仅消息）

```bash
docker exec trauma-heal-postgres psql -U postgres -d trauma_heal -c \
  "DELETE FROM public.messages WHERE user_id IN (SELECT id FROM public.users WHERE username IN ('lin_morning','chen_night','su_river'));"
```

## Agent rules

- 优化对话质量时：先读 `SIMULATED_USER_DIALOGUES.md` 或跑 `export-dialogues.mjs`，再改 `prompt.ts` 或 seed 脚本。
- 用户抱怨「对话假」：检查是否为预写台词问题 → 用 `--chat-only` 按上下文重跑。
- 用户抱怨「像剧本」：检查用户生成 `CHAT_STYLE_RULES` 与伙伴 `CHAT_SYSTEM_PROMPT` 动作禁令。
- 详细评估维度见 [eval-rubric.md](eval-rubric.md)。
