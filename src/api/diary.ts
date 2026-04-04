import type { DiaryEntry, DiaryListResponse } from "@/types";
import { apiClient } from "./client";

export async function listDiaries(params: {
  q?: string;
  page?: number;
  page_size?: number;
}): Promise<DiaryListResponse> {
  const { data } = await apiClient.get<DiaryListResponse>("/api/diary", { params });
  return data;
}

export async function createDiary(body: {
  title?: string;
  content: string;
}): Promise<DiaryEntry> {
  const { data } = await apiClient.post<DiaryEntry>("/api/diary", body);
  return data;
}

export async function getDiary(id: number): Promise<DiaryEntry> {
  const { data } = await apiClient.get<DiaryEntry>(`/api/diary/${id}`);
  return data;
}

export async function updateDiary(
  id: number,
  body: { title?: string; content?: string }
): Promise<DiaryEntry> {
  const { data } = await apiClient.patch<DiaryEntry>(`/api/diary/${id}`, body);
  return data;
}

export async function deleteDiary(id: number): Promise<void> {
  await apiClient.delete(`/api/diary/${id}`);
}
