import { id, type Message, type WealthState } from "./wealth";
export type ChatMeta = {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
};
export type Conversation = ChatMeta & { messages: Message[] };
const titleFor = (messages: Message[]) =>
  messages
    .find((row) => row.role === "user")
    ?.text.trim()
    .slice(0, 36) || "新对话";
export function activeChat(state: WealthState): Conversation {
  return {
    ...(state.chatCurrent ?? {
      id: "legacy-chat",
      title: titleFor(state.messages),
    }),
    messages: state.messages,
  };
}
export function allChats(state: WealthState) {
  return [activeChat(state), ...(state.chatArchives ?? [])].filter(
    (row) => row.messages.length,
  );
}
export function newChat(state: WealthState, now = new Date()): WealthState {
  const previous = activeChat(state);
  return {
    ...state,
    messages: [],
    chatCurrent: {
      id: id(),
      title: "新对话",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    chatArchives: previous.messages.length
      ? [previous, ...(state.chatArchives ?? [])]
      : (state.chatArchives ?? []),
  };
}
export function openChat(state: WealthState, chatId: string): WealthState {
  const current = activeChat(state);
  if (current.id === chatId) return state;
  const selected = state.chatArchives?.find((row) => row.id === chatId);
  if (!selected) throw new Error("这段会话已变化，请刷新历史列表。");
  const { messages, ...meta } = selected;
  return {
    ...state,
    messages,
    chatCurrent: meta,
    chatArchives: [
      ...(current.messages.length ? [current] : []),
      ...(state.chatArchives ?? []).filter((row) => row.id !== chatId),
    ],
  };
}
export function appendChat(
  state: WealthState,
  message: Message,
  targetId = activeChat(state).id,
  now = new Date(),
): WealthState {
  const current = activeChat(state);
  const timestamp = now.toISOString();
  if (current.id === targetId) {
    const messages = [
      ...state.messages,
      { ...message, createdAt: message.createdAt ?? timestamp },
    ];
    return {
      ...state,
      messages,
      chatCurrent: {
        id: current.id,
        title: titleFor(messages),
        createdAt:
          current.createdAt ?? (state.messages.length ? undefined : timestamp),
        updatedAt: timestamp,
      },
    };
  }
  if (!state.chatArchives?.some((row) => row.id === targetId))
    throw new Error("原会话无法找到，回复尚未保存，请重试。");
  return {
    ...state,
    chatArchives: state.chatArchives.map((row) =>
      row.id === targetId
        ? {
            ...row,
            updatedAt: timestamp,
            messages: [
              ...row.messages,
              { ...message, createdAt: message.createdAt ?? timestamp },
            ],
          }
        : row,
    ),
  };
}
export function mergeChatHistory(
  base: WealthState,
  incoming: WealthState,
): WealthState {
  const existing = allChats(base);
  const archives = [...(base.chatArchives ?? [])];
  const signature = (messages: Message[]) =>
    JSON.stringify(
      messages.map((row) => [
        row.id,
        row.role,
        row.text,
        row.createdAt ?? null,
      ]),
    );
  for (const chat of allChats(incoming)) {
    if (
      existing.some(
        (row) => signature(row.messages) === signature(chat.messages),
      )
    )
      continue;
    const imported = {
      ...chat,
      id: `imported-${chat.messages[0].id}`,
      title: `本机 · ${chat.title}`,
    };
    const previous = archives.findIndex((row) => row.id === imported.id);
    if (previous >= 0) {
      const prior = archives[previous];
      if (
        prior.messages.every(
          (row, index) =>
            row.id === chat.messages[index]?.id &&
            row.role === chat.messages[index]?.role &&
            row.text === chat.messages[index]?.text,
        )
      )
        archives[previous] = imported;
      else if (
        !chat.messages.every(
          (row, index) =>
            row.id === prior.messages[index]?.id &&
            row.text === prior.messages[index]?.text,
        )
      )
        archives.push({
          ...imported,
          id: `${imported.id}-${chat.messages.at(-1)!.id}`,
        });
      continue;
    }
    archives.push(imported);
  }
  return { ...base, chatArchives: archives };
}
export function chatContext(state: WealthState) {
  const messages =
    state.messages.length <= 20
      ? state.messages
      : [...state.messages.slice(0, 2), ...state.messages.slice(-18)];
  const limit = Math.min(
    3000,
    Math.floor(18000 / Math.max(1, messages.length)),
  );
  return messages
    .map((row) => `${row.role}: ${row.text.slice(0, limit)}`)
    .join("\n");
}
