import { create } from "zustand";
import { streamChatCompletion } from "@/api/chatStream";
import {
  deleteLastUserMessage,
  fetchMessagesPage,
  insertChatMessage,
} from "@/lib/chatDb";
const STREAM_CHAR_MS = 28;

const CHAT_SYSTEM = `你是 CPTSD 疗愈中的陪伴者「北极星」：温情承接情绪、给予具体认可与安全感；可 gently 梳理困扰，避免说教与空洞口号。回复使用自然中文，段落简洁。`;

interface ChatState {
  sessionId: string | null;
  sending: boolean;
  draft: string;
  streamingContent: string | undefined;
  lastSentText: string;
  optimisticUserMsgId: string | null;
  needsSync: boolean;
  errorMessage: string | null;
  setSessionId: (id: string | null) => void;
  setDraft: (value: string) => void;
  setOptimisticUserMsgId: (id: string | null) => void;
  streamReply: (sessionId: string, subjectUserId: string, userPlain: string) => Promise<void>;
  stopMessage: () => Promise<void>;
  markSynced: () => void;
  clearError: () => void;
}

let streamReceived = "";
let streamDisplayedLen = 0;
let streamEnded = false;
let cancelStream: (() => void) | null = null;
let tickerId: number | null = null;

function clearTicker() {
  if (tickerId != null) {
    window.clearInterval(tickerId);
    tickerId = null;
  }
}

function resetStreamRuntime() {
  streamReceived = "";
  streamDisplayedLen = 0;
  streamEnded = false;
}

async function buildOpenAiMessages(
  sessionId: string,
  subjectUserId: string
): Promise<{ role: string; content: string }[]> {
  const { messages: hist } = await fetchMessagesPage({
    sessionId,
    subjectUserId,
    limit: 30,
    skipAudit: true,
  });
  return [
    { role: "system", content: CHAT_SYSTEM },
    ...hist.map((m) => ({ role: m.role, content: m.content })),
  ];
}

function startTicker(
  set: (patch: Partial<ChatState>) => void,
  get: () => ChatState,
  finalizeAssistant: () => void
) {
  if (tickerId != null) return;
  tickerId = window.setInterval(() => {
    const full = streamReceived;
    const len = streamDisplayedLen;
    if (len < full.length) {
      streamDisplayedLen = len + 1;
      set({ streamingContent: full.slice(0, streamDisplayedLen) });
      return;
    }
    if (streamEnded) {
      clearTicker();
      finalizeAssistant();
      return;
    }
    if (!get().sending && full.length === 0) {
      clearTicker();
    }
  }, STREAM_CHAR_MS);
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessionId: null,
  sending: false,
  draft: "",
  streamingContent: undefined,
  lastSentText: "",
  optimisticUserMsgId: null,
  needsSync: false,
  errorMessage: null,
  setSessionId: (id) => set({ sessionId: id }),
  setDraft: (value) => set({ draft: value }),
  setOptimisticUserMsgId: (id) => set({ optimisticUserMsgId: id }),
  markSynced: () => set({ needsSync: false }),
  clearError: () => set({ errorMessage: null }),

  streamReply: async (sessionId: string, subjectUserId: string, userPlain: string) => {
    set({
      sessionId,
      lastSentText: userPlain,
      draft: "",
      sending: true,
      streamingContent: "",
      needsSync: false,
      errorMessage: null,
    });
    resetStreamRuntime();
    clearTicker();

    const finalizeAssistant = () => {
      const text = streamReceived;
      resetStreamRuntime();
      cancelStream = null;
      if (text.trim()) {
        void insertChatMessage(sessionId, "assistant", text.trim())
          .catch(() => {
            set({ errorMessage: "保存助手回复失败" });
          })
          .finally(() => {
            set({
              sending: false,
              streamingContent: undefined,
              optimisticUserMsgId: null,
              needsSync: true,
            });
          });
      } else {
        set({
          sending: false,
          streamingContent: undefined,
          optimisticUserMsgId: null,
          needsSync: true,
        });
      }
    };

    startTicker(set, get, finalizeAssistant);

    try {
      const messages = await buildOpenAiMessages(sessionId, subjectUserId);
      const stop = await streamChatCompletion(messages, {
        onChunk: (chunk) => {
          streamReceived += chunk;
        },
        onEnd: () => {
          streamEnded = true;
        },
        onError: (err) => {
          clearTicker();
          resetStreamRuntime();
          cancelStream = null;
          set({
            sending: false,
            streamingContent: undefined,
            optimisticUserMsgId: null,
            errorMessage: err.message || "对话失败",
            needsSync: true,
          });
        },
      });
      cancelStream = stop;
    } catch (err) {
      clearTicker();
      resetStreamRuntime();
      cancelStream = null;
      set({
        sending: false,
        streamingContent: undefined,
        optimisticUserMsgId: null,
        errorMessage: err instanceof Error ? err.message : "对话失败",
        needsSync: true,
      });
    }
  },

  stopMessage: async () => {
    cancelStream?.();
    cancelStream = null;
    clearTicker();
    resetStreamRuntime();

    const text = get().lastSentText;
    const sid = get().sessionId;
    set({
      sending: false,
      streamingContent: undefined,
      draft: text,
      optimisticUserMsgId: null,
    });

    if (sid) {
      try {
        await deleteLastUserMessage(sid);
      } catch {
        set({ errorMessage: "撤销本轮输入失败，请刷新后同步", needsSync: true });
      }
    }
  },
}));
