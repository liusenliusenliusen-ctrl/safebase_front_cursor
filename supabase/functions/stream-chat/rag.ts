import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { renderChatPrompt } from "./prompt.ts";
import { getEmbedding } from "./openrouter.ts";

const DEFAULT_PROFILE = `# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录`;

export function extractLastUserMessage(
  messages: { role: string; content: string }[]
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].content?.trim()) {
      return messages[i].content.trim();
    }
  }
  return "";
}

function formatShortCtx(rows: { role: string; content: string }[]): string {
  const lines: string[] = [];
  for (const m of rows) {
    const role = m.role === "user" ? "用户" : "AI";
    lines.push(`${role}: ${m.content}`);
  }
  return lines.join("\n");
}

async function fetchRecentDiariesFallback(
  supabase: SupabaseClient,
  limit: number
): Promise<string> {
  const { data, error } = await supabase
    .from("diaries")
    .select("title, content")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error || !data?.length) return "";
  return data
    .map((d) => {
      const title = (d.title as string) || "无标题";
      const content = (d.content as string) || "";
      return `- ${title}: ${content.slice(0, 500)}`;
    })
    .join("\n");
}

/**
 * 与 FastAPI build_memory_context 对齐：
 * - 近期对话来自 public.messages（须已写入本轮 user 消息）
 * - summaries / anchors 向量检索
 * - diaries 向量检索（主站扩展）
 */
export async function buildMemoryPrompt(
  supabase: SupabaseClient,
  _userId: string,
  userMessage: string,
  openRouter: {
    apiKey: string;
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions?: number;
  }
): Promise<string> {
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("content")
    .maybeSingle();
  const profile_text = (profileRow?.content as string) || DEFAULT_PROFILE;

  const { data: memRows, error: memErr } = await supabase.rpc(
    "get_recent_memory_messages",
    { msg_limit: 30 }
  );
  if (memErr) {
    console.warn("get_recent_memory_messages:", memErr.message);
  }
  const short_ctx = formatShortCtx(
    (memRows as { role: string; content: string }[]) ?? []
  );

  let summaries_text = "";
  let anchors_text = "";
  let diaries_text = "";

  const emb = await getEmbedding(
    userMessage,
    openRouter.apiKey,
    openRouter.baseUrl,
    openRouter.embeddingModel,
    openRouter.embeddingDimensions
  );

  const { data: sums, error: sumErr } = await supabase.rpc(
    "match_summaries_daily",
    { query_embedding: emb, match_count: 2 }
  );
  if (!sumErr && sums?.length) {
    summaries_text = (sums as { summary_date: string; content: string }[])
      .map((r) => `- ${r.summary_date}: ${r.content}`)
      .join("\n");
  }

  const { data: anchors, error: ancErr } = await supabase.rpc("match_anchors", {
    query_embedding: emb,
    match_count: 1,
  });
  if (!ancErr && anchors?.length) {
    const a = anchors[0] as {
      event_name: string;
      initial_thought: string | null;
      current_thought: string | null;
    };
    anchors_text =
      `事件：${a.event_name}\n` +
      `最初看法：${a.initial_thought ?? ""}\n` +
      `当前看法：${a.current_thought ?? ""}\n`;
  }

  try {
    const { data: diaries, error: diaErr } = await supabase.rpc("match_diaries", {
      query_embedding: emb,
      match_count: 2,
    });
    if (!diaErr && diaries?.length) {
      diaries_text = (
        diaries as { title: string; content: string }[]
      )
        .map((d) => `- ${d.title || "无标题"}: ${(d.content || "").slice(0, 500)}`)
        .join("\n");
    } else {
      diaries_text = await fetchRecentDiariesFallback(supabase, 2);
    }
  } catch {
    diaries_text = await fetchRecentDiariesFallback(supabase, 2);
  }

  return renderChatPrompt({
    profile_text,
    short_ctx,
    summaries_text,
    anchors_text,
    diaries_text,
    user_message: userMessage,
  });
}
