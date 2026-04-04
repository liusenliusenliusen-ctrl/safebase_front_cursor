import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Space,
  Typography,
  message,
} from "antd";
import {
  BookOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { createDiary, deleteDiary, listDiaries, updateDiary } from "@/api/diary";
import type { DiaryEntry } from "@/types";

const { Text, Paragraph } = Typography;
const PAGE_SIZE = 10;

function excerpt(text: string, max = 140) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function DiaryPage() {
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDiaries({
        q: q.trim() || undefined,
        page,
        page_size: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch {
      message.error("加载日记失败");
    } finally {
      setLoading(false);
    }
  }, [page, q]);

  useEffect(() => {
    load();
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
        await updateDiary(editing.id, { title, content });
        message.success("已保存");
      } else {
        await createDiary({ title, content });
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

  const handleDelete = (row: DiaryEntry) => {
    Modal.confirm({
      title: "删除这篇日记？",
      content: "删除后无法恢复。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteDiary(row.id);
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

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(165deg, #faf7f2 0%, #ebe6df 42%, #d4e3e1 100%)",
        overflow: "auto",
      }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "20px 20px 28px", width: "100%" }}>
        <div
          style={{
            marginBottom: 22,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <BookOutlined style={{ fontSize: 26, color: "#6a8e8f" }} />
              <Text style={{ fontSize: 22, fontWeight: 600, color: "#2c3e3e" }}>我的日记</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 14 }}>
              记录心情与片段，随时搜索回顾。
            </Text>
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
          style={{ marginBottom: 20, maxWidth: 480 }}
        />

        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "#888" }}>加载中…</div>
        ) : items.length === 0 ? (
          <Card
            style={{
              borderRadius: 16,
              border: "none",
              boxShadow: "0 8px 32px rgba(0,0,0,0.06)",
              background: "rgba(255,255,255,0.75)",
            }}
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ color: "#888" }}>
                  {q.trim() ? "没有匹配的日记，换个关键词试试" : "还没有日记，点右上角「写日记」开始吧"}
                </span>
              }
            />
          </Card>
        ) : (
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            {items.map((row) => (
              <Card
                key={row.id}
                hoverable
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(0,0,0,0.04)",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
                  background: "rgba(255,255,255,0.88)",
                }}
                styles={{ body: { padding: "16px 18px" } }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 16, color: "#2c3e3e" }}>
                      {row.title?.trim() || "无标题"}
                    </Text>
                    <div style={{ marginTop: 6 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(row.updated_at).format("YYYY-MM-DD HH:mm")} 更新
                      </Text>
                    </div>
                    <Paragraph
                      ellipsis={{ rows: 3 }}
                      style={{ marginTop: 10, marginBottom: 0, color: "#555", fontSize: 14 }}
                    >
                      {excerpt(row.content)}
                    </Paragraph>
                  </div>
                  <Space>
                    <Button icon={<EditOutlined />} onClick={() => openEdit(row)}>
                      编辑
                    </Button>
                    <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(row)}>
                      删除
                    </Button>
                  </Space>
                </div>
              </Card>
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
        width={Math.min(520, typeof window !== "undefined" ? window.innerWidth - 24 : 520)}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditing(null);
        }}
        destroyOnClose
        styles={{ body: { paddingBottom: 80 } }}
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item label="标题（可选）" name="title">
            <Input placeholder="一句话标题" maxLength={256} showCount />
          </Form.Item>
          <Form.Item
            label="正文"
            name="content"
            rules={[{ required: true, message: "请填写正文" }]}
          >
            <Input.TextArea
              placeholder="写下今天想说的…"
              autoSize={{ minRows: 14, maxRows: 28 }}
              style={{ fontSize: 15, lineHeight: 1.75 }}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
