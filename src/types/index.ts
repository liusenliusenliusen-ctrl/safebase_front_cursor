export interface User {
  id: string;
  email: string;
  username: string;
  created_at?: string;
}

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface DiaryEntry {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

