import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Input, Modal, Spin, message } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useAuthStore } from "@/stores/authStore";
import { fetchJournal, upsertDiaryByDate } from "@/lib/diaryDb";
import type { DiaryEntry } from "@/types";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

function localDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayHeading(dateStr: string, today: string): string {
  const d = dayjs(dateStr);
  if (dateStr === today) return `今天 · ${d.format("M月D日")}`;
  if (dateStr === dayjs(today).subtract(1, "day").format("YYYY-MM-DD")) {
    return `昨天 · ${d.format("M月D日")}`;
  }
  return d.format("YYYY年M月D日 ddd");
}

function dayDomId(dateStr: string) {
  return `journal-day-${dateStr}`;
}

export function DiaryPage() {
  const { user } = useAuthStore();
  const today = useMemo(() => localDateStr(), []);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const streamRef = useRef<HTMLDivElement>(null);
  const todayAreaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const items = await fetchJournal({ limit: 400, q: q || undefined });
      setEntries(items);
      const nextDrafts: Record<string, string> = {};
      for (const item of items) {
        const date = item.entry_date ?? item.created_at.slice(0, 10);
        nextDrafts[date] = item.content;
      }
      if (!q.trim() && nextDrafts[today] === undefined) {
        nextDrafts[today] = "";
      }
      setDrafts(nextDrafts);
      setSaveStates({});
    } catch {
      message.error("加载日记失败");
    } finally {
      setLoading(false);
    }
  }, [user, q, today]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loading || q.trim()) return;
    const t = window.setTimeout(() => {
      document.getElementById(dayDomId(today))?.scrollIntoView({ block: "center" });
      todayAreaRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(t);
  }, [loading, today, q]);

  const dayList = useMemo(() => {
    const dates = new Set<string>(Object.keys(drafts));
    for (const e of entries) {
      dates.add(e.entry_date ?? e.created_at.slice(0, 10));
    }
    if (!q.trim()) dates.add(today);
    return Array.from(dates).sort();
  }, [drafts, entries, today, q]);

  const dateNav = useMemo(() => {
    return [...dayList]
      .filter((d) => (drafts[d] ?? "").trim().length > 0 || d === today)
      .reverse();
  }, [dayList, drafts, today]);

  const persistDay = useCallback(async (dateStr: string, content: string) => {
    setSaveStates((s) => ({ ...s, [dateStr]: "saving" }));
    try {
      const res = await upsertDiaryByDate(dateStr, content);
      if ("deleted" in res && res.deleted) {
        setEntries((prev) =>
          prev.filter((e) => (e.entry_date ?? e.created_at.slice(0, 10)) !== dateStr)
        );
        if (dateStr !== today) {
          setDrafts((d) => {
            const next = { ...d };
            delete next[dateStr];
            return next;
          });
        }
      } else if ("id" in res) {
        setEntries((prev) => {
          const others = prev.filter(
            (e) => (e.entry_date ?? e.created_at.slice(0, 10)) !== dateStr
          );
          return [...others, res as DiaryEntry].sort((a, b) =>
            (a.entry_date ?? "").localeCompare(b.entry_date ?? "")
          );
        });
      }
      setSaveStates((s) => ({ ...s, [dateStr]: "saved" }));
      window.setTimeout(() => {
        setSaveStates((s) => (s[dateStr] === "saved" ? { ...s, [dateStr]: "idle" } : s));
      }, 1600);
    } catch {
      setSaveStates((s) => ({ ...s, [dateStr]: "error" }));
      message.error("保存失败，请稍后重试");
    }
  }, [today]);

  const scheduleSave = useCallback(
    (dateStr: string, content: string) => {
      setSaveStates((s) => ({ ...s, [dateStr]: "dirty" }));
      if (saveTimers.current[dateStr]) {
        clearTimeout(saveTimers.current[dateStr]);
      }
      saveTimers.current[dateStr] = setTimeout(() => {
        void persistDay(dateStr, content);
      }, 900);
    },
    [persistDay]
  );

  useEffect(() => {
    return () => {
      for (const t of Object.values(saveTimers.current)) clearTimeout(t);
    };
  }, []);

  const onDraftChange = (dateStr: string, value: string) => {
    setDrafts((d) => ({ ...d, [dateStr]: value }));
    scheduleSave(dateStr, value);
  };

  const flushSave = (dateStr: string) => {
    if (saveTimers.current[dateStr]) {
      clearTimeout(saveTimers.current[dateStr]);
      delete saveTimers.current[dateStr];
    }
    void persistDay(dateStr, draftsRef.current[dateStr] ?? "");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const active = document.activeElement as HTMLElement | null;
        const date = active?.dataset?.entryDate;
        if (date) flushSave(date);
        else flushSave(today);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [today]);

  const jumpTo = (dateStr: string) => {
    document.getElementById(dayDomId(dateStr))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const clearDay = (dateStr: string) => {
    Modal.confirm({
      title: "清空这一天？",
      content: "清空后该日内容将删除，无法恢复。",
      okText: "清空",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        setDrafts((d) => ({ ...d, [dateStr]: "" }));
        if (saveTimers.current[dateStr]) {
          clearTimeout(saveTimers.current[dateStr]);
          delete saveTimers.current[dateStr];
        }
        await persistDay(dateStr, "");
      },
    });
  };

  const saveLabel = (dateStr: string) => {
    const st = saveStates[dateStr] ?? "idle";
    if (st === "saving") return "保存中…";
    if (st === "dirty") return "编辑中";
    if (st === "saved") return "已保存";
    if (st === "error") return "保存失败";
    return "自动保存";
  };

  const onSearch = () => {
    setQ(searchInput.trim());
  };

  if (!user) return null;

  return (
    <div className="diary-stage journal-stage">
      <div className="journal-shell">
        <header className="journal-header">
          <div>
            <h1 className="diary-title">日记</h1>
            <p className="diary-sub">
              随时打开继续写。书写是连续的；回顾时可按日期跳转。写下的内容会帮助伴侣更懂你。
            </p>
          </div>
          <Input.Search
            className="journal-search"
            size="large"
            placeholder="按内容搜索…"
            allowClear
            enterButton={
              <Button type="primary" icon={<SearchOutlined />}>
                搜索
              </Button>
            }
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onSearch={onSearch}
            onClear={() => {
              setSearchInput("");
              setQ("");
            }}
          />
        </header>

        <div className="journal-body">
          <aside className="journal-dates" aria-label="按日期回顾">
            <div className="journal-dates-title">日期</div>
            {dateNav.length === 0 ? (
              <p className="journal-dates-empty">还没有记录</p>
            ) : (
              <ul className="journal-dates-list">
                {dateNav.map((d) => (
                  <li key={d}>
                    <button
                      type="button"
                      className={`journal-date-btn${d === today ? " is-today" : ""}`}
                      onClick={() => jumpTo(d)}
                    >
                      <span className="journal-date-label">
                        {d === today ? "今天" : dayjs(d).format("M/D")}
                      </span>
                      <span className="journal-date-excerpt">
                        {(drafts[d] ?? "").replace(/\s+/g, " ").trim().slice(0, 28) ||
                          "（空白）"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <div className="journal-stream" ref={streamRef}>
            {loading ? (
              <div className="journal-loading">
                <Spin />
              </div>
            ) : dayList.length === 0 ? (
              <div className="empty-stage diary-empty-card">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="没有匹配的日记"
                />
                <p className="diary-empty-lead">换个关键词，或清空搜索继续书写。</p>
                <Button
                  type="primary"
                  onClick={() => {
                    setSearchInput("");
                    setQ("");
                  }}
                >
                  回到日记
                </Button>
              </div>
            ) : (
              dayList.map((dateStr) => {
                const isToday = dateStr === today;
                const value = drafts[dateStr] ?? "";
                return (
                  <section
                    key={dateStr}
                    id={dayDomId(dateStr)}
                    className={`journal-day${isToday ? " is-today" : ""}`}
                  >
                    <div className="journal-day-head">
                      <h2 className="journal-day-title">
                        {formatDayHeading(dateStr, today)}
                      </h2>
                      <div className="journal-day-meta">
                        <span className={`journal-save is-${saveStates[dateStr] ?? "idle"}`}>
                          {saveLabel(dateStr)}
                        </span>
                        {value.trim() && (
                          <button
                            type="button"
                            className="journal-clear"
                            onClick={() => clearDay(dateStr)}
                          >
                            清空这天
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      ref={isToday ? todayAreaRef : undefined}
                      className="journal-textarea"
                      data-entry-date={dateStr}
                      value={value}
                      placeholder={
                        isToday
                          ? "今天想写点什么…随时写，会自动保存。"
                          : "这一天还可以补充或修改…"
                      }
                      rows={isToday ? 10 : 6}
                      onChange={(e) => onDraftChange(dateStr, e.target.value)}
                      onBlur={() => {
                        if ((saveStates[dateStr] ?? "idle") === "dirty") {
                          flushSave(dateStr);
                        }
                      }}
                    />
                  </section>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
