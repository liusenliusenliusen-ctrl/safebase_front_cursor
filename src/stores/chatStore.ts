import { create } from "zustand";
import { streamChatCompletion } from "@/api/chatStream";
import { deleteLastUserMessage } from "@/lib/chatDb";

const STREAM_CHAR_MS = 28;

interface ChatState {
  sending: boolean;
  draft: string;
  streamingContent: string | undefined;
  lastSentText: string;
  optimisticUserMsgId: string | null;
  needsSync: boolean;
  errorMessage: string | null;
  setDraft: (value: string) => void;
  setOptimisticUserMsgId: (id: string | null) => void;
  streamReply: (
    userId: string,
    userPlain: string,
    userMessageId: string
  ) => Promise<void>;
  stopMessage: (userId: string | undefined) => Promise<void>;
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

function startTicker(
  set: (patch: Partial<ChatState>) => void,
  get: () => ChatState,
  onStreamDone: () => void
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
      onStreamDone();
      return;
    }
    if (!get().sending && full.length === 0) {
      clearTicker();
    }
  }, STREAM_CHAR_MS);
}

export const useChatStore = create<ChatState>((set, get) => ({
  sending: false,
  draft: "",
  streamingContent: undefined,
  lastSentText: "",
  optimisticUserMsgId: null,
  needsSync: false,
  errorMessage: null,
  setDraft: (value) => set({ draft: value }),
  setOptimisticUserMsgId: (id) => set({ optimisticUserMsgId: id }),
  markSynced: () => set({ needsSync: false }),
  clearError: () => set({ errorMessage: null }),

  streamReply: async (userId, userPlain, userMessageId) => {
    set({
      lastSentText: userPlain,
      draft: "",
      sending: true,
      streamingContent: "",
      needsSync: false,
      errorMessage: null,
    });
    resetStreamRuntime();
    clearTicker();

    const onStreamDone = () => {
      resetStreamRuntime();
      cancelStream = null;
      set({
        sending: false,
        streamingContent: undefined,
        optimisticUserMsgId: null,
        needsSync: true,
      });
    };

    startTicker(set, get, onStreamDone);

    try {
      const stop = await streamChatCompletion(
        [{ role: "user", content: userPlain }],
        { userMessageId },
        {
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
        }
      );
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

  stopMessage: async (userId) => {
    cancelStream?.();
    cancelStream = null;
    clearTicker();
    resetStreamRuntime();

    const text = get().lastSentText;
    set({
      sending: false,
      streamingContent: undefined,
      draft: text,
      optimisticUserMsgId: null,
    });

    if (userId) {
      try {
        await deleteLastUserMessage(userId);
      } catch {
        set({
          errorMessage: "撤销本轮输入失败，请刷新后同步",
          needsSync: true,
        });
      }
    }
  },
}));
