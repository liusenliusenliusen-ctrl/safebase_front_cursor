import { create } from "zustand";
import { streamChatCompletion } from "@/api/chatStream";
import { deleteLastUserMessage, insertChatMessage } from "@/lib/chatDb";
import type { Message } from "@/types";

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
  sendChatMessage: (
    userId: string,
    text: string
  ) => Promise<Message | null>;
  stopMessage: (userId: string | undefined) => Promise<void>;
  markSynced: () => void;
  clearError: () => void;
}

let cancelStream: (() => void) | null = null;
let streamFinished = false;

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

  sendChatMessage: async (userId, text) => {
    const plain = text.trim();
    if (!plain || get().sending) return null;

    streamFinished = false;
    set({
      lastSentText: plain,
      draft: "",
      sending: true,
      streamingContent: "",
      needsSync: false,
      errorMessage: null,
    });

    let userMsg: Message;
    try {
      userMsg = await insertChatMessage(userId, "user", plain);
    } catch (err) {
      set({
        sending: false,
        streamingContent: undefined,
        errorMessage: err instanceof Error ? err.message : "发送失败",
      });
      return null;
    }

    set({ optimisticUserMsgId: userMsg.id });

    const finishStream = () => {
      if (streamFinished) return;
      streamFinished = true;
      cancelStream = null;
      set({
        sending: false,
        streamingContent: undefined,
        optimisticUserMsgId: null,
        needsSync: true,
      });
    };

    try {
      const stop = await streamChatCompletion(
        [{ role: "user", content: plain }],
        { userMessageId: userMsg.id },
        {
          onChunk: (chunk) => {
            set((state) => ({
              streamingContent: (state.streamingContent ?? "") + chunk,
            }));
          },
          onEnd: () => {
            finishStream();
          },
          onError: (err) => {
            streamFinished = true;
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
      streamFinished = true;
      cancelStream = null;
      set({
        sending: false,
        streamingContent: undefined,
        optimisticUserMsgId: null,
        errorMessage: err instanceof Error ? err.message : "对话失败",
        needsSync: true,
      });
    }

    return userMsg;
  },

  stopMessage: async (userId) => {
    cancelStream?.();
    cancelStream = null;
    streamFinished = true;

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
