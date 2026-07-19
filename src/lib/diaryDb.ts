import type { DiaryEntry } from "@/types";
import { apiFetch, apiJson } from "@/api/client";

export async function listDiaries(
  userId: string,
  params: { page: number; pageSize: number }
): Promise<{ items: DiaryEntry[]; total: number }> {
  void userId;
  const qs = new URLSearchParams({
    page: String(params.page),
    page_size: String(params.pageSize),
  });
  return apiJson<{ items: DiaryEntry[]; total: number }>(
    `/api/diaries?${qs.toString()}`
  );
}

export async function listDiariesBatch(
  userId: string,
  pageSize: number
): Promise<DiaryEntry[]> {
  void userId;
  const qs = new URLSearchParams({ limit: String(pageSize) });
  const data = await apiJson<{ items: DiaryEntry[] }>(
    `/api/diaries/batch?${qs.toString()}`
  );
  return data.items;
}

/** 连续日记流（按日升序） */
export async function fetchJournal(
  opts?: { limit?: number; q?: string }
): Promise<DiaryEntry[]> {
  const qs = new URLSearchParams();
  if (opts?.limit) qs.set("limit", String(opts.limit));
  if (opts?.q?.trim()) qs.set("q", opts.q.trim());
  const suffix = qs.toString() ? `?${qs}` : "";
  const data = await apiJson<{ items: DiaryEntry[] }>(`/api/diaries/journal${suffix}`);
  return data.items;
}

export async function fetchDiaryDates(): Promise<
  { entry_date: string; excerpt: string }[]
> {
  const data = await apiJson<{ items: { entry_date: string; excerpt: string }[] }>(
    "/api/diaries/dates"
  );
  return data.items;
}

/** 按日保存；空内容会删除该日 */
export async function upsertDiaryByDate(
  entryDate: string,
  content: string
): Promise<DiaryEntry | { deleted: true; entry_date: string }> {
  return apiJson(`/api/diaries/by-date/${entryDate}`, {
    method: "PUT",
    body: JSON.stringify({ content, title: entryDate }),
  });
}

export async function createDiary(
  userId: string,
  title: string,
  content: string
): Promise<DiaryEntry> {
  void userId;
  return apiJson<DiaryEntry>("/api/diaries", {
    method: "POST",
    body: JSON.stringify({ title, content }),
  });
}

export async function updateDiary(
  id: number,
  title: string,
  content: string
): Promise<DiaryEntry> {
  return apiJson<DiaryEntry>(`/api/diaries/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title, content }),
  });
}

export async function deleteDiaryRow(id: number): Promise<void> {
  await apiFetch(`/api/diaries/${id}`, { method: "DELETE" });
}
