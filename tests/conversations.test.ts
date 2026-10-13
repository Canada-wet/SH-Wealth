import { it, expect } from "vitest";
import { emptyState, validateState } from "../lib/wealth";
import {
  activeChat,
  allChats,
  appendChat,
  newChat,
  openChat,
  mergeChatHistory,
  chatContext,
} from "../lib/conversations";
import { connectionPlan, sameData } from "../lib/cloud-plan";
it("旧消息原样保留，新建、回看、继续提问与备份恢复", () => {
  const legacy = {
    ...emptyState(),
    messages: [{ id: "old", role: "user" as const, text: "旧问题" }],
  };
  let state = newChat(legacy);
  expect(state.chatArchives?.[0].messages).toEqual(legacy.messages);
  state = appendChat(state, { id: "new", role: "user", text: "新问题" });
  state = openChat(state, "legacy-chat");
  state = appendChat(state, { id: "follow", role: "user", text: "继续旧问题" });
  const restored = JSON.parse(JSON.stringify(state));
  validateState(restored);
  expect(restored.messages.map((row) => row.text)).toEqual([
    "旧问题",
    "继续旧问题",
  ]);
  expect(allChats(restored)).toHaveLength(2);
});
it("另一个设备切换会话期间，回复仍保存到原会话", () => {
  const original = appendChat(emptyState(), {
    id: "q",
    role: "user",
    text: "问题",
  });
  const target = activeChat(original).id;
  const switched = appendChat(newChat(original), {
    id: "other",
    role: "user",
    text: "另一话题",
  });
  const result = appendChat(
    switched,
    { id: "a", role: "assistant", text: "原问题回复" },
    target,
  );
  expect(result.messages).toEqual(switched.messages);
  expect(result.chatArchives?.[0].messages.at(-1)?.text).toBe("原问题回复");
});
it("无效或重复会话不允许进入持久存储", () => {
  expect(() =>
    validateState({
      ...emptyState(),
      chatArchives: [
        {
          id: "x",
          title: "坏",
          messages: [{ id: "m", role: "bad", text: "t" }],
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    validateState({
      ...emptyState(),
      chatCurrent: { id: "x", title: "t" },
      chatArchives: [{ id: "x", title: "t", messages: [] }],
    }),
  ).toThrow();
});
it("本机聊天迁入云端时保留两边历史且不重复导入", () => {
  const base = appendChat(emptyState(), {
    id: "cloud",
    role: "user",
    text: "云端问题",
  });
  const local = appendChat(emptyState(), {
    id: "local",
    role: "user",
    text: "本机问题",
  });
  const once = mergeChatHistory(base, local);
  const twice = mergeChatHistory(once, local);
  expect(allChats(twice)).toHaveLength(2);
  expect(base.messages).toEqual(once.messages);
  const extended = appendChat(local, {
    id: "later",
    role: "user",
    text: "本机新增追问",
  });
  expect(
    mergeChatHistory(once, extended).chatArchives?.[0].messages.at(-1)?.text,
  ).toBe("本机新增追问");
});
it("较长会话仍包含原始问题和最新上下文，长度受控", () => {
  const state = {
    ...emptyState(),
    messages: Array.from({ length: 30 }, (_, index) => ({
      id: String(index),
      role: "user" as const,
      text: `问题${index} ` + "x".repeat(3000),
    })),
  };
  const context = chatContext(state);
  expect(context).toContain("问题0 ");
  expect(context).toContain("问题29 ");
  expect(context.length).toBeLessThan(18500);
});
it("新域名空数据自动加载云端；两份财务数据冲突需选择", () => {
  const cloud = {
    ...emptyState(),
    assets: [
      {
        id: "a",
        name: "现金",
        category: "现金",
        owner: "joint",
        value: 500,
        annualReturn: null,
      },
    ],
  };
  expect(connectionPlan(emptyState(), cloud)).toBe("load");
  expect(connectionPlan(cloud, null)).toBe("upload");
  expect(
    connectionPlan(
      { ...cloud, assets: [{ ...cloud.assets[0], value: 600 }] },
      cloud,
    ),
  ).toBe("choice");
  expect(
    connectionPlan(
      appendChat(emptyState(), { id: "m", role: "user", text: "本机聊天" }),
      cloud,
    ),
  ).toBe("merge-chat");
  expect(sameData(cloud, JSON.parse(JSON.stringify(cloud)))).toBe(true);
});
