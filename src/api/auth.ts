import type { TokenResponse, User } from "@/types";
import { apiClient } from "./client";

export async function register(
  username: string,
  password: string
): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>("/api/auth/register", {
    username,
    password,
  });
  return data;
}

export async function login(
  username: string,
  password: string
): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>("/api/auth/login", {
    username,
    password,
  });
  return data;
}

export async function getMe(): Promise<User> {
  const { data } = await apiClient.get<User>("/api/auth/me");
  return data;
}

/** 永久注销当前账号（需密码确认）；成功后后端删除用户及关联数据。 */
export async function deleteAccount(password: string): Promise<{ ok: boolean }> {
  const { data } = await apiClient.post<{ ok: boolean }>("/api/auth/delete-account", {
    password,
  });
  return data;
}
