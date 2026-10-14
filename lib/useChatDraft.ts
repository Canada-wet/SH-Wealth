"use client";
import { useCallback, useEffect, useState } from "react";

export default function useChatDraft(chatId: string) {
  const key = `together-chat-draft:${chatId}`;
  const [input, setValue] = useState("");
  useEffect(() => {
    try {
      setValue(localStorage.getItem(key)?.slice(0, 6000) || "");
    } catch {
      setValue("");
    }
  }, [key]);
  const setInput = useCallback(
    (value: string) => {
      const bounded = value.slice(0, 6000);
      setValue(bounded);
      try {
        if (bounded) localStorage.setItem(key, bounded);
        else localStorage.removeItem(key);
      } catch {
        /* Drafts never block durable chat or financial saves. */
      }
    },
    [key],
  );
  return [input, setInput] as const;
}
