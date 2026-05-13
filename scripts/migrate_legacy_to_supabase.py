#!/usr/bin/env python3
"""
将旧 FastAPI 使用的 Postgres（public.users + profiles/summaries/anchors/messages/diary_entries）
中的业务表复制到 Supabase Postgres（auth.users + 同名业务表）。

依赖：
  pip install psycopg2-binary

用法示例（本地 Supabase）：
  export LEGACY_DATABASE_URL="postgresql://user:pass@host:5432/olddb"
  export TARGET_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  python scripts/migrate_legacy_to_supabase.py

前置条件（必做）：
  1. 目标库已执行 supabase/migrations（含 profiles、summaries、anchors、messages、diary_entries）。
  2. 旧库 users.id（uuid）与 Supabase auth.users.id 一一对应：
     每个旧用户需已在 Supabase 注册/导入，且 id 相同。
     若仅用户名相同而 id 不同，需先做 UUID 映射表或手工对齐后再跑本脚本。
  3. 使用具备绕过 RLS 权限的角色连接目标库（推荐本地 postgres 超级用户或服务角色直连 DB）。

可选：
  --dry-run 只检查旧库行数与 auth 中缺失的 user_id，不写目标库。
"""

from __future__ import annotations

import argparse
import os
import sys
from contextlib import closing

try:
    import psycopg2
    from psycopg2 import sql
    from psycopg2.extensions import connection as PgConnection
except ImportError:
    print("请先安装: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)


def _toggle_audit_triggers(dst: PgConnection, enable: bool) -> None:
    verb = "ENABLE" if enable else "DISABLE"
    with dst.cursor() as cur:
        for i, tbl in enumerate(
            (
                "profiles",
                "summaries",
                "anchors",
                "messages",
                "diary_entries",
                "diaries",
                "chat_sessions",
                "chat_messages",
            )
        ):
            sp = f"sb_audit_{verb.lower()}_{i}"
            cur.execute(sql.SQL("SAVEPOINT {}").format(sql.Identifier(sp)))
            try:
                cur.execute(
                    sql.SQL("ALTER TABLE public.{} {} TRIGGER {}").format(
                        sql.Identifier(tbl),
                        sql.SQL(verb),
                        sql.Identifier(tbl + "_audit_dml"),
                    )
                )
            except Exception:
                cur.execute(sql.SQL("ROLLBACK TO SAVEPOINT {}").format(sql.Identifier(sp)))
            else:
                cur.execute(sql.SQL("RELEASE SAVEPOINT {}").format(sql.Identifier(sp)))
    dst.commit()


def disable_audit_triggers(dst: PgConnection) -> None:
    _toggle_audit_triggers(dst, enable=False)


def enable_audit_triggers(dst: PgConnection) -> None:
    _toggle_audit_triggers(dst, enable=True)


def check_auth_coverage(src: PgConnection, dst: PgConnection) -> list[str]:
    with src.cursor() as s, dst.cursor() as d:
        s.execute("SELECT id::text FROM users")
        legacy_ids = {r[0] for r in s.fetchall()}
        if not legacy_ids:
            return []
        d.execute("SELECT id::text FROM auth.users")
        auth_ids = {r[0] for r in d.fetchall()}
    missing = sorted(legacy_ids - auth_ids)
    return missing


def migrate(
    legacy_url: str,
    target_url: str,
    dry_run: bool,
    skip_trigger_toggle: bool,
) -> None:
    with closing(psycopg2.connect(legacy_url)) as src, closing(
        psycopg2.connect(target_url)
    ) as dst:
        missing = check_auth_coverage(src, dst)
        if missing:
            print(
                "警告：下列旧 users.id 在 auth.users 中不存在，"
                "相关行的外键插入将失败。请先导入/创建对应 Auth 用户："
            )
            for u in missing[:50]:
                print(f"  - {u}")
            if len(missing) > 50:
                print(f"  ... 共 {len(missing)} 个")
        if dry_run:
            print("dry-run：不写入目标库。")
            return

        src.autocommit = True
        dst.autocommit = False

        if not skip_trigger_toggle:
            try:
                disable_audit_triggers(dst)
            except Exception as e:
                print(f"禁用审计触发器失败（可忽略或检查权限）: {e}")
                dst.rollback()

        try:
            with src.cursor() as s, dst.cursor() as d:
                # profiles
                s.execute("SELECT user_id::text, content, updated_at FROM profiles")
                for row in s.fetchall():
                    d.execute(
                        """
                        INSERT INTO public.profiles (user_id, content, updated_at)
                        VALUES (%s::uuid, %s, %s)
                        ON CONFLICT (user_id) DO UPDATE SET
                          content = EXCLUDED.content,
                          updated_at = EXCLUDED.updated_at
                        """,
                        row,
                    )

                # summaries（id 为 GENERATED ALWAYS AS IDENTITY，需 OVERRIDING 以保留旧 id）
                s.execute(
                    """
                    SELECT id, user_id::text, type, content, summary_date,
                           embedding::text, created_at
                    FROM summaries
                    ORDER BY id
                    """
                )
                for sid, uid, typ, content, sdate, emb, cat in s.fetchall():
                    d.execute(
                        """
                        INSERT INTO public.summaries
                          (id, user_id, type, content, summary_date, embedding, created_at)
                        OVERRIDING SYSTEM VALUE
                        VALUES (%s, %s::uuid, %s, %s, %s, %s::vector, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          user_id = EXCLUDED.user_id,
                          type = EXCLUDED.type,
                          content = EXCLUDED.content,
                          summary_date = EXCLUDED.summary_date,
                          embedding = EXCLUDED.embedding,
                          created_at = EXCLUDED.created_at
                        """,
                        (sid, uid, typ, content, sdate, emb, cat),
                    )

                # anchors
                s.execute(
                    """
                    SELECT id, user_id::text, event_name, initial_thought, current_thought,
                           evolution_history::text, embedding::text, updated_at
                    FROM anchors
                    ORDER BY id
                    """
                )
                for (
                    aid,
                    uid,
                    ename,
                    it,
                    ct,
                    evo,
                    emb,
                    uat,
                ) in s.fetchall():
                    evo_arg = evo if evo is not None else "[]"
                    d.execute(
                        """
                        INSERT INTO public.anchors
                          (id, user_id, event_name, initial_thought, current_thought,
                           evolution_history, embedding, updated_at)
                        OVERRIDING SYSTEM VALUE
                        VALUES (%s, %s::uuid, %s, %s, %s, %s::jsonb, %s::vector, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          user_id = EXCLUDED.user_id,
                          event_name = EXCLUDED.event_name,
                          initial_thought = EXCLUDED.initial_thought,
                          current_thought = EXCLUDED.current_thought,
                          evolution_history = EXCLUDED.evolution_history,
                          embedding = EXCLUDED.embedding,
                          updated_at = EXCLUDED.updated_at
                        """,
                        (aid, uid, ename, it, ct, evo_arg, emb, uat),
                    )

                # messages（RAG 近期对话 + embedding）
                s.execute(
                    """
                    SELECT id, user_id::text, role, content, embedding::text, created_at
                    FROM messages
                    ORDER BY id
                    """
                )
                for mid, uid, role, content, emb, cat in s.fetchall():
                    emb_arg = emb if emb else None
                    d.execute(
                        """
                        INSERT INTO public.messages
                          (id, user_id, role, content, embedding, created_at)
                        VALUES (%s, %s::uuid, %s, %s, %s::vector, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          user_id = EXCLUDED.user_id,
                          role = EXCLUDED.role,
                          content = EXCLUDED.content,
                          embedding = EXCLUDED.embedding,
                          created_at = EXCLUDED.created_at
                        """,
                        (mid, uid, role, content, emb_arg, cat),
                    )

                # diary_entries
                s.execute(
                    """
                    SELECT id, user_id::text, title, content, created_at, updated_at
                    FROM diary_entries
                    ORDER BY id
                    """
                )
                for did, uid, title, content, cat, uat in s.fetchall():
                    d.execute(
                        """
                        INSERT INTO public.diary_entries
                          (id, user_id, title, content, created_at, updated_at)
                        VALUES (%s, %s::uuid, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                          user_id = EXCLUDED.user_id,
                          title = EXCLUDED.title,
                          content = EXCLUDED.content,
                          created_at = EXCLUDED.created_at,
                          updated_at = EXCLUDED.updated_at
                        """,
                        (did, uid, title, content, cat, uat),
                    )

            dst.commit()

            with dst.cursor() as d:
                for tbl in ("summaries", "anchors", "messages", "diary_entries"):
                    d.execute(
                        "SELECT setval(pg_get_serial_sequence(%s, 'id'), COALESCE((SELECT MAX(id) FROM public.%s), 1), true)",
                        (f"public.{tbl}", tbl),
                    )
            dst.commit()

        except Exception:
            dst.rollback()
            raise
        finally:
            if not skip_trigger_toggle:
                try:
                    enable_audit_triggers(dst)
                except Exception as e:
                    print(f"恢复审计触发器失败: {e}", file=sys.stderr)


def main() -> None:
    p = argparse.ArgumentParser(description="Migrate legacy Safebase tables to Supabase Postgres")
    p.add_argument(
        "--legacy-url",
        default=os.environ.get("LEGACY_DATABASE_URL"),
        help="旧库连接串（含 public.users 与业务表）",
    )
    p.add_argument(
        "--target-url",
        default=os.environ.get("TARGET_DATABASE_URL"),
        help="Supabase Postgres 直连串（建议 postgres 角色）",
    )
    p.add_argument("--dry-run", action="store_true", help="只检查 auth 覆盖，不写库")
    p.add_argument(
        "--skip-trigger-toggle",
        action="store_true",
        help="不禁用/启用审计触发器（无超级用户权限时用）",
    )
    args = p.parse_args()
    if not args.legacy_url or not args.target_url:
        print("请设置 LEGACY_DATABASE_URL / TARGET_DATABASE_URL 或传入命令行参数", file=sys.stderr)
        sys.exit(1)
    migrate(args.legacy_url, args.target_url, args.dry_run, args.skip_trigger_toggle)
    print("完成。")


if __name__ == "__main__":
    main()
