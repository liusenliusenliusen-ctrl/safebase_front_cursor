export interface User {
  id: string;
  username: string;
  created_at: string;
}

export interface TokenResponse {
  token: string;
  user: User;
}

export type MessageRole = "user" | "assistant";

export interface Message {
  id: number;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface MessageListResponse {
  messages: Message[];
  hasMore: boolean;
}

export interface DiaryEntry {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface DiaryListResponse {
  items: DiaryEntry[];
  total: number;
  page: number;
  page_size: number;
}
