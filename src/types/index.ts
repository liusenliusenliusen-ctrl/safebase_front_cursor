export interface User {
  id: string;
  email: string;
  username: string;
  /** 兼容旧版本地缓存；Supabase 用户可无此项 */
  created_at?: string;
}

export interface TokenResponse {
  token: string;
  user: User;
}

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
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
