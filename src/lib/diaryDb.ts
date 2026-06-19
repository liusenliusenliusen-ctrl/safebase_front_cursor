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
