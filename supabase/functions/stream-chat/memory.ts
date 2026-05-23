import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { getEmbedding } from "./openrouter.ts";

export async function updateUserMessageEmbedding(
  supabase: SupabaseClient,
  messageId: number,
  content: string,
  openRouter: {
    apiKey: string;
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions?: number;
  }
): Promise<void> {
  const embedding = await getEmbedding(
    content,
    openRouter.apiKey,
    openRouter.baseUrl,
    openRouter.embeddingModel,
    openRouter.embeddingDimensions
  );
  const { error } = await supabase
    .from("messages")
    .update({ embedding })
    .eq("id", messageId)
    .eq("role", "user");
  if (error) {
    throw new Error(`update user message embedding failed: ${error.message}`);
  }
}

export async function insertAssistantMessage(
  supabase: SupabaseClient,
  userId: string,
  content: string,
  openRouter: {
    apiKey: string;
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions?: number;
  }
): Promise<void> {
  const embedding = await getEmbedding(
    content,
    openRouter.apiKey,
    openRouter.baseUrl,
    openRouter.embeddingModel,
    openRouter.embeddingDimensions
  );
  const { error } = await supabase.from("messages").insert({
    user_id: userId,
    role: "assistant",
    content,
    embedding,
  });
  if (error) {
    throw new Error(`insert assistant message failed: ${error.message}`);
  }
}

export async function ensureDefaultProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      content: `# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录`,
    },
    { onConflict: "user_id", ignoreDuplicates: true }
  );
  if (error) {
    console.warn("ensureDefaultProfile:", error.message);
  }
}
