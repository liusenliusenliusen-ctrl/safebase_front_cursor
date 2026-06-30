# SafeBase 数据访问与隐私演进路线

本文档描述用户敏感数据（对话、日记、画像、摘要、锚点）的**访问控制演进计划**，供后续迭代参考。当前阶段以 **Prompt 调试与功能稳定** 为主，不要求立刻实现下文各阶段。

相关：[DEVELOPMENT.md](./DEVELOPMENT.md) · [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## 1. 设计原则（已达成共识）

| 原则 | 说明 |
|------|------|
| **库内暂存明文** | 便于服务端 RAG、embedding、夜间批处理（`daily` / `profiles` / `anchors`）读写 |
| **严格限制「谁可以连库」** | 生产环境仅 backend 进程使用的 DB 账号可访问业务表；人不持库凭证、不日常 `psql` |
| **管理端不读正文** | 运营/管理后台只看元数据与统计，不看对话、日记、画像正文 |
| **分阶段演进** | 先做运维安全（Operational Security），若产品需要「平台技术上无法读库」再考虑客户端加密 |

这不是「零知识 / 端到端加密」方案，而是 **「信任平台运营者 + 技术手段降低误访问与滥用」** 的务实路线。

---

## 2. 威胁模型：各方案能防什么

### 2.1 当前实现（阶段 0）

- 业务内容（`messages`、`diaries`、`profiles`、`summaries`、`anchors`）以 **明文** 存 Postgres。
- 密码为 bcrypt 哈希；**内容无加密**。
- 管理 API（`/api/admin/*`）可返回用户 **最近消息正文** 与画像内容。
- 任何持有 `DATABASE_URL` 或能 `psql` 的人均可读全库。

### 2.2 目标模型（阶段 1–2）

```text
用户浏览器 ──HTTPS──► Nginx ──► Fastify backend ──► Postgres（明文，仅 app 账号）
                              │
                              └──► Admin API（仅元数据，无正文）

人不连库 · 管理不看正文 · 备份受控
```

### 2.3 防护对照表

| 威胁 | 阶段 0 | 阶段 1–2 | 阶段 3（客户端加密，可选） |
|------|--------|----------|---------------------------|
| 管理后台偷看对话/日记 | ❌ 可能 | ✅ 设计上禁止 | ✅ |
| 运维无 DB 账号误读 | ❌ | ✅ | ✅ |
| 数据库端口误暴露公网 | ⚠️ 依赖配置 | ✅ 本机 + 防火墙 | ✅ |
| 备份文件被拷走 | ❌ 明文 | ⚠️ 仍明文，靠权限/加密备份 | ✅ 密文 |
| backend 被入侵 / SQL 注入 | ❌ | ❌ | ⚠️ 会话内仍可能泄露 |
| 有 root / SSH 的服务器管理员 | ❌ | ❌ | ❌（可读内存、改代码、`.env`） |
| 对话时 LLM（OpenRouter） | 服务端见明文 | 服务端见明文 | 会话内见明文 |

**结论：** 阶段 1–2 满足「**不允许除 backend 以外的角色读库**」；**不满足**「即使 DBA 读库也看不到明文」。后者需阶段 3，且与 RAG/批处理存在产品与技术权衡（见 [§6](#6-阶段-3可选客户端加密)）。

---

## 3. 数据分级

演进时按级别处理，避免「全有或全无」：

| 级别 | 字段示例 | 阶段 1–2 | 阶段 3（若做） |
|------|----------|----------|----------------|
| **L0 元数据** | `users.username`、`created_at`、各表 `count` | 管理端可见 | 可见 |
| **L1 高敏内容** | `messages.content`、`diaries.*`、`profiles.content`、`summaries.content`、`anchors.*_thought` | 管理端 **不可见**；仅 backend + 用户 JWT | 库内密文 |
| **L2 推理中间态** | `*.embedding` | 随 L1 策略；尽量不对外暴露 | 加密或不落库 |

---

## 4. 演进阶段

### 阶段 0：当前（开发与 Prompt 调优）

**状态：** 明文库 + 完整 admin 详情 + 本地/生产均可 `psql`。

**允许：** 本地 `psql` 查 `profiles` / `summaries` 验证 prompt；admin 看最近消息。

**注意：** 勿将生产库数据拉到开发机；`.env` 不入 Git。

---

### 阶段 1：治理层（低成本，优先做）

**目标：** 从产品和 API 上杜绝「通过管理后台读用户正文」，不涉及改表结构。

| 项 | 动作 |
|----|------|
| Admin API | `/api/admin/users/:id` **移除** `recent_messages`、画像正文；仅保留 id、username、计数、时间等 |
| Admin 前端 | 用户详情页只展示统计，不展示对话/画像内容 |
| 制度 | 生产环境禁止用管理密钥批量导出用户内容 |
| 文档 | 对外说明：运营界面不看 L1 内容 |

**实现参考（backend）：** `src/admin/routes.ts`  
**实现参考（admin）：** `src/pages/UserDetailPage.tsx`

**验收：**

```bash
curl -H "X-Admin-Key: ..." http://127.0.0.1:8000/api/admin/users/<uuid>
# 响应中不得含 messages.content、profile 全文
```

---

### 阶段 2：生产库访问控制（核心）

**目标：** Postgres 中仍为明文，但 **仅 backend 应用账号** 在 **仅本机** 可连；人员不持 `DATABASE_URL`。

#### 2.1 网络

- [ ] Postgres 只监听 `127.0.0.1`（Docker 端口映射不对公网；云安全组不放行 5433/5432）
- [ ] backend 与 DB 同机或同私有网络；无公网直连 DB

#### 2.2 数据库账号（推荐单独 migration）

- [ ] 创建角色 `safebase_app`（非 `SUPERUSER`）
- [ ] 仅授予业务表 `SELECT, INSERT, UPDATE, DELETE`（及 `USAGE` on schema、`SEQUENCE` 若需要）
- [ ] 撤销 PUBLIC 默认权限；`postgres` 超级用户 **不** 写入 backend `.env`
- [ ] `DATABASE_URL=postgresql://safebase_app:强密码@127.0.0.1:5433/safebase`

示例（后续实现时可放入 `sql/migrations/002_app_role.sql`）：

```sql
-- 示意，实施前在 staging 验证
-- CREATE ROLE safebase_app LOGIN PASSWORD '...';
-- GRANT CONNECT ON DATABASE safebase TO safebase_app;
-- GRANT USAGE ON SCHEMA public TO safebase_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO safebase_app;
-- ALTER DEFAULT PRIVILEGES ... 
```

#### 2.3 密钥与人员

- [ ] `DATABASE_URL` 仅存在于 `/opt/safebase/backend/.env`；开发机不连生产库
- [ ] 管理员仅有 `ADMIN_SECRET`，**无** DB 密码
- [ ] SSH / root 仅限必要人员；生产 DB 无日常人工账号

#### 2.4 备份

- [ ] 备份目录权限最小化（如 `0700`）
- [ ] 备份等同明文库：禁止拷贝到个人机器；可选备份加密（密钥与 DB 分离存储）
- [ ] 恢复流程文档化，避免在公网环境解压备份

#### 2.5 应用层

- [ ] 依赖升级与 SQL 参数化，降低 SQL 注入面
- [ ] `pm2` / Docker 日志不打印请求体中的对话正文
- [ ] OpenRouter：知悉请求会出境到第三方 LLM（隐私政策中说明）

#### 2.6 审计（可选增强）

- [ ] 记录 SSH 登录、`.env` 变更、`pm2 restart`（如 auditd / 云审计）
- [ ] 现有 `data_access_audit` 表可在后续接 backend 写操作审计

**验收清单（生产）：**

```bash
# 从公网 IP 连 DB 应失败
nc -zv 公网IP 5433   # 应超时或拒绝

# 本机无 DATABASE_URL 时 psql 应失败
psql "$DATABASE_URL" -c 'SELECT 1'   # 运维不应持有 URL

# backend 健康与注册仍正常
curl http://127.0.0.1:8000/api/health
```

---

### 阶段 3（可选）：客户端加密

**触发条件：** 产品承诺「平台读库也无法看到用户内容」，或合规/用户预期要求强于阶段 2。

**概要：**

- 用户密码（或独立恢复码）在浏览器派生 `DataKey`，**不落服务器**
- L1 字段以密文存库；展示与上传前在客户端加解密
- 对话/RAG：会话内客户端解密后送 `/api/chat/stream`（**推理瞬间服务端仍见明文**）
- 夜间任务：改为用户触发、或登录会话内执行，结果加密写回；embedding/RAG 策略需单独设计

**与阶段 2 关系：** 阶段 2 仍应保留（网络与账号隔离）；阶段 3 在 L1 上叠加密码学保护。

详细方案讨论见开发过程记录；**不在 Prompt 调试期实施**。

---

## 5. 推荐实施顺序

```text
现在（阶段 0）
  Prompt / RAG / 批处理调优，明文库 + psql 可查

        ↓ 功能稳定后

阶段 1（1–2 天量级）
  收缩 Admin API + 管理前端，无 L1 正文

        ↓ 上线或扩大用户前

阶段 2（约 1 次 migration + 运维改造）
  独立 DB 角色、网络与备份策略、生产检查清单

        ↓ 若产品需要「读库也无明文」

阶段 3（大项）
  客户端加密 + 批处理/RAG 改造
```

---

## 6. 阶段 3（可选）：客户端加密

| 能力 | 全库密文后的典型选择 |
|------|----------------------|
| 实时对话 RAG | 客户端解密历史 → 请求 stream；库内仍密文 |
| daily / profiles / anchors | 用户主动触发，或登录会话内跑；结果加密写回 |
| embedding | 可能不落库、或会话内计算；向量检索弱化或改方案 |
| 忘密 | 需恢复码/导出密钥，否则数据不可恢复 |

---

## 7. 生产安全检查清单（阶段 2 完成后勾选）

复制到运维笔记，上线前逐项确认：

### 网络与进程

- [ ] Postgres 不对公网监听（`ss -tlnp | grep 5433` 仅 127.0.0.1 或 docker 内部）
- [ ] 云安全组未放行 5433/5432
- [ ] Nginx 仅 80/443（及 8081 管理静态页）；`/api` 反代到 127.0.0.1:8000
- [ ] `pm2` 仅运行 backend，且 `.env` 在 backend 根目录

### 数据库

- [ ] backend 使用 `safebase_app`（或等价）非 superuser 账号
- [ ] 生产 `POSTGRES_PASSWORD` / `DATABASE_URL` 已换强密码
- [ ] 无人将生产 `DATABASE_URL` 存放在笔记本 `.env` 或 Git

### 应用与 Admin

- [ ] Admin API 不返回 L1 正文（阶段 1）
- [ ] `JWT_SECRET`、`ADMIN_SECRET` 为随机长串
- [ ] HTTPS 已启用（生产推荐）

### 备份与制度

- [ ] 备份路径权限受控；恢复流程仅在内网/受控环境
- [ ] 开发人员默认不 SSH 生产；必要操作有记录

### 第三方

- [ ] 隐私说明中含：对话内容会发往 OpenRouter 用于生成回复与 embedding

---

## 8. 相关代码位置（演进时改动的入口）

| Concern | 仓库 | 路径 |
|---------|------|------|
| Admin 读用户数据 | backend | `src/admin/routes.ts` |
| Admin 展示 | admin | `src/pages/UserDetailPage.tsx`、`src/api/admin.ts` |
| DB 连接 | backend | `src/db.ts`、`src/config.ts` |
| Schema / 角色 | backend | `sql/migrations/` |
| 批处理读明文 | backend | `src/tasks/index.ts`、`prompts/*.txt` |
| 对话 RAG | backend | `src/chat/memory.ts`、`src/chat/routes.ts` |

---

## 9. 文档维护

- 每完成一阶段，在本文件「阶段 N」下补充 **完成日期** 与 **实际 migration 文件名**。
- 阶段 3 若启动，应另增「密钥恢复、换设备、密码修改」专项说明。

---

*最后更新：与 Prompt 调试期并行；阶段 1–2 为推荐下一跳，非当前 sprint 阻塞项。*
