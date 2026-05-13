import { supabase } from "@/lib/supabase";

/** 读路径审计：在 PostgREST 查询成功后调用（Postgres 无法对 SELECT 挂触发器）。 */
export async function auditReadAccess(params: {
  subjectUserId: string;
  table: string;
  scope: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.rpc("audit_read_access", {
    p_subject: params.subjectUserId,
    p_table: params.table,
    p_scope: params.scope,
    p_detail: params.detail ?? {},
  });
  if (error) console.warn("[audit]", error.message);
}
