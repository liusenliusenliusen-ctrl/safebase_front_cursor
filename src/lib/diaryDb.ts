import type { DiaryEntry } from "@/types";
import { supabase } from "@/lib/supabase";
import { auditReadAccess } from "@/lib/auditLog";

export async function listDiaries(
  userId: string,
  params: { page: number; pageSize: number }
): Promise<{ items: DiaryEntry[]; total: number }> {
  const from = (params.page - 1) * params.pageSize;
  const to = from + params.pageSize - 1;

  const { count, error: cErr } = await supabase
    .from("diaries")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  if (cErr) throw new Error(cErr.message);

  const { data: rows, error } = await supabase
    .from("diaries")
    .select("id, title, content, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  void auditReadAccess({
    subjectUserId: userId,
    table: "diaries",
    scope: "list_page",
    detail: { page: params.page, pageSize: params.pageSize, returned: rows?.length ?? 0 },
  });

  const items: DiaryEntry[] = (rows ?? []).map((r) => ({
    id: r.id as number,
    title: (r.title as string) ?? "",
    content: (r.content as string) ?? "",
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }));

  return { items, total: count ?? 0 };
}

/** 搜索用：拉取一批后在内存过滤（避免服务端全文索引时仍可通过审计记录访问意图） */
export async function listDiariesBatch(
  userId: string,
  pageSize: number
): Promise<DiaryEntry[]> {
  const { data: rows, error } = await supabase
    .from("diaries")
    .select("id, title, content, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(pageSize);

  if (error) throw new Error(error.message);

  void auditReadAccess({
    subjectUserId: userId,
    table: "diaries",
    scope: "list_batch_search",
    detail: { limit: pageSize, returned: rows?.length ?? 0 },
  });

  return (rows ?? []).map((r) => ({
    id: r.id as number,
    title: (r.title as string) ?? "",
    content: (r.content as string) ?? "",
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  }));
}

export async function createDiary(
  userId: string,
  title: string,
  content: string
): Promise<DiaryEntry> {
  const { data, error } = await supabase
    .from("diaries")
    .insert({
      user_id: userId,
      title,
      content,
    })
    .select("id, created_at, updated_at")
    .single();

  if (error) throw new Error(error.message);
  return {
    id: data.id as number,
    title,
    content,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  };
}

export async function updateDiary(
  id: number,
  title: string,
  content: string
): Promise<DiaryEntry> {
  const { data, error } = await supabase
    .from("diaries")
    .update({ title, content })
    .eq("id", id)
    .select("id, created_at, updated_at")
    .single();

  if (error) throw new Error(error.message);
  return {
    id: data.id as number,
    title,
    content,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  };
}

export async function deleteDiaryRow(id: number): Promise<void> {
  const { error } = await supabase.from("diaries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
