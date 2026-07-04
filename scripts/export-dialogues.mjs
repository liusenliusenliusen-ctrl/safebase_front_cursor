/**
 * 将模拟用户对话导出为 docs/SIMULATED_USER_DIALOGUES.md
 * 用法: node scripts/export-dialogues.mjs
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../docs/SIMULATED_USER_DIALOGUES.md");
const API = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
const PASSWORD = "lb6325515";

const USERS = [
  {
    username: "lin_morning",
    label: "林晓晨 · 职场警觉型",
    persona: "28岁女性，互联网运营。冻结反应、过度自责、回避社交、浅眠易惊醒。",
  },
  {
    username: "chen_night",
    label: "陈夜雨 · 讨好与关系型",
    persona: "35岁，自由职业插画师。讨好反应、难拒绝、关系羞耻、正在学着表达需要。",
  },
  {
    username: "su_river",
    label: "苏清河 · 解离与躯体化",
    persona: "22岁大学生。解离、感官过载、用触感小物接地、怕被当怪人。",
  },
];

async function login(username) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`登录失败: ${username}`);
  return (await res.json()).token;
}

async function getMessages(token) {
  const res = await fetch(`${API}/api/messages?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("拉取消息失败");
  return (await res.json()).messages;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

async function main() {
  let md = `# 模拟用户对话记录

> 导出时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
> 数据来源：本地开发环境（\`${API}\`）
> 统一密码：\`lb6325515\`
> 每用户 10 轮对话（20 条消息）

---

## 目录

`;

  for (const u of USERS) {
    md += `- [${u.label}（\`${u.username}\`）](#${u.username})\n`;
  }
  md += "\n---\n\n";

  for (const u of USERS) {
    const token = await login(u.username);
    const messages = await getMessages(token);
    const rounds = messages.filter((m) => m.role === "user").length;

    md += `## ${u.username}\n\n`;
    md += `**${u.label}**\n\n`;
    md += `| 字段 | 值 |\n|------|----|\n`;
    md += `| 用户名 | \`${u.username}\` |\n`;
    md += `| 人设摘要 | ${u.persona} |\n`;
    md += `| 对话轮数 | ${rounds} |\n`;
    md += `| 消息总数 | ${messages.length} |\n\n`;

    let round = 0;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "user") round++;
      const who = m.role === "user" ? "**用户**" : "**疗愈伙伴**";
      if (m.role === "user") md += `### 第 ${round} 轮\n\n`;
      md += `${who}（${fmtTime(m.created_at)}）\n\n`;
      md += `${m.content}\n\n`;
      if (m.role === "assistant" && i < messages.length - 1) md += "---\n\n";
    }
    md += "\n---\n\n";
  }

  md += `*由 \`scripts/seed-trauma-users.mjs\` 生成模拟数据；重新导出：\`node scripts/export-dialogues.mjs\`*\n`;

  writeFileSync(OUT, md, "utf8");
  console.log(`已写入 ${OUT}（${md.length} 字符）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
