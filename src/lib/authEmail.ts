/** 将界面上的「用户名」映射为 Supabase Auth 所需的 email（本地开发用内部域）。 */
export function usernameToAuthEmail(username: string): string {
  const slug = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = slug.length > 0 ? slug : "user";
  return `${safe}@safebase.internal`;
}
