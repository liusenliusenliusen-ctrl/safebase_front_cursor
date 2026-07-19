import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Space,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useAuthStore } from "@/stores/authStore";
import {
  createDiary,
  deleteDiaryRow,
  listDiaries,
  listDiariesBatch,
  updateDiary,
} from "@/lib/diaryDb";
import type { DiaryEntry } from "@/types";

const PAGE_SIZE = 10;

function excerpt(text: string, max = 140) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function DiaryPage() {
  const { user } = useAuthStore();
  const [items, setItems] = useState<DiaryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ title: string; content: string }>();
  const contentWatch = Form.useWatch("content", form) ?? "";
  const titleWatch = Form.useWatch("title", form) ?? "";

  const charCount = useMemo(() => String(contentWatch).trim().length, [contentWatch]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const qq = q.trim().toLowerCase();
      if (qq) {
        const all = await listDiariesBatch(user.id, 400);
        const filtered = all.filter(
          (row) =>
            row.title.toLowerCase().includes(qq) || row.content.toLowerCase().includes(qq)
        );
        setTotal(filtered.length);
        const from = (page - 1) * PAGE_SIZE;
        setItems(filtered.slice(from, from + PAGE_SIZE));
      } else {
        const res = await listDiaries(user.id, {
          page,
          pageSize: PAGE_SIZE,
        });
        setItems(res.items);
        setTotal(res.total);
      }
    } catch {
      message.error("加载日记失败");
    } finally {
      setLoading(false);
    }
  }, [user, page, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ title: "", content: "" });
    setDrawerOpen(true);
  };

  const openEdit = (row: DiaryEntry) => {
    setEditing(row);
    form.setFieldsValue({ title: row.title, content: row.content });
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    if (!user) return;
    try {
      const v = await form.validateFields();
      const title = (v.title ?? "").trim();
      const content = (v.content ?? "").trim();
      if (!content) {
        message.warning("请填写正文");
        return;
      }
      setSaving(true);
      if (editing) {
        await updateDiary(editing.id, title, content);
        message.success("已保存");
      } else {
        await createDiary(user.id, title, content);
        message.success("日记已创建");
      }
      setDrawerOpen(false);
      setEditing(null);
      await load();
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bind while drawer open
  }, [drawerOpen, editing, saving]);

  const handleDelete = (row: DiaryEntry, e?: React.MouseEvent) => {
    e?.stopPropagation();
    Modal.confirm({
      title: "删除这篇日记？",
      content: "删除后无法恢复。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteDiaryRow(row.id);
          message.success("已删除");
          if (items.length === 1 && page > 1) {
            setPage((p) => p - 1);
          } else {
            await load();
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  const onSearch = () => {
    setQ(searchInput);
    setPage(1);
  };

  const drawerWidth =
    typeof window !== "undefined" ? Math.min(640, window.innerWidth - 16) : 640;

  return (
    <div className="diary-stage">
      <div className="content-column">
        <div className="diary-toolbar">
          <div>
            <h1 className="diary-title">日记</h1>
            <p className="diary-sub">
              留给自己的安静角落。写下的内容会帮助伴侣更懂你——对话与日记仍是分开的两个空间。
            </p>
          </div>
          <Button type="primary" icon={<PlusOutlined />} size="large" onClick={openCreate}>
            写日记
          </Button>
        </div>

        <Input.Search
          size="large"
          placeholder="搜索标题或正文…"
          allowClear
          enterButton={
            <Button type="primary" icon={<SearchOutlined />}>
              搜索
            </Button>
          }
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={onSearch}
          style={{ marginBottom: 20, maxWidth: 440 }}
        />

        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--ink-muted)" }}>
            加载中…
          </div>
        ) : items.length === 0 ? (
          <div className="empty-stage diary-empty-card">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                q.trim() ? "没有匹配的日记，换个关键词试试" : "还没有日记"
              }
            />
            {!q.trim() && (
              <>
                <p className="diary-empty-lead">
                  把今天的一点感受留下来，哪怕只有几行。写在这里的内容，会温柔地帮助伴侣理解你。
                </p>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  写第一篇
                </Button>
              </>
            )}
          </div>
        ) : (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {items.map((row) => (
              <article
                key={row.id}
                className="diary-item"
                role="button"
                tabIndex={0}
                onClick={() => openEdit(row)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openEdit(row);
                  }
                }}
              >
                <h2 className="diary-item-title">{row.title?.trim() || "无标题"}</h2>
                <div className="diary-item-meta">
                  {dayjs(row.updated_at).format("YYYY年M月D日 HH:mm")} 更新
                </div>
                <p className="diary-item-excerpt">{excerpt(row.content)}</p>
                <div className="diary-item-actions" onClick={(e) => e.stopPropagation()}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
                    编辑
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => handleDelete(row, e)}
                  >
                    删除
                  </Button>
                </div>
              </article>
            ))}
          </Space>
        )}

        {total > PAGE_SIZE && (
          <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
            <Pagination
              current={page}
              pageSize={PAGE_SIZE}
              total={total}
              onChange={(p) => setPage(p)}
              showSizeChanger={false}
            />
          </div>
        )}
      </div>

      <Drawer
        title={editing ? "编辑日记" : "写日记"}
        width={drawerWidth}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditing(null);
        }}
        destroyOnClose
        className="diary-drawer"
        styles={{
          body: { paddingTop: 8, paddingBottom: 28, background: "var(--paper)" },
          header: {
            borderBottom: "1px solid var(--line)",
            background: "var(--paper)",
          },
        }}
        extra={
          <Space>
            <Button
              onClick={() => {
                setDrawerOpen(false);
                setEditing(null);
              }}
            >
              取消
            </Button>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" requiredMark={false} className="diary-form">
          <Form.Item label="标题（可选）" name="title">
            <Input
              className="diary-title-input"
              placeholder="一句话标题，也可以留空"
              maxLength={256}
              showCount
              size="large"
              variant="borderless"
            />
          </Form.Item>
          <Form.Item
            label="正文"
            name="content"
            rules={[{ required: true, message: "请填写正文" }]}
          >
            <Input.TextArea
              className="diary-body-input"
              placeholder="写下今天想说的…不必完美。"
              autoSize={{ minRows: 18, maxRows: 36 }}
              variant="borderless"
              autoFocus
            />
          </Form.Item>
        </Form>
        <div className="diary-editor-meta">
          <span>
            {titleWatch.trim() ? "有标题" : "无标题"} · {charCount} 字
          </span>
          <span>⌘/Ctrl + S 保存</span>
        </div>
      </Drawer>
    </div>
  );
}
