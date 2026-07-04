const backendUrl = process.env.E2E_BACKEND_URL ?? "http://127.0.0.1:8000";

export default async function globalSetup(): Promise<void> {
  try {
    const res = await fetch(`${backendUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`health returned ${res.status}`);
    }
    const body = (await res.json()) as { ok?: boolean };
    if (!body.ok) {
      throw new Error("health body not ok");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      [
        `E2E 需要本地后端已启动 (${backendUrl})。`,
        "请先执行：",
        "  cd safebase_backend_cursor && docker compose up -d",
        "  cd safebase_backend_cursor && npm run dev",
        `原因: ${msg}`,
      ].join("\n")
    );
  }
}
