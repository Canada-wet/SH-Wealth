import {
  validateBacktestConfig,
  validateBacktestData,
  type BacktestConfig,
  type BacktestData,
} from "./backtest-schema";
export type BacktestDraft = {
  config: BacktestConfig;
  data: BacktestData | null;
  conversation?: {
    config: BacktestConfig;
    capturedAt: string;
    householdIncluded: boolean;
    messages: { role: "user" | "assistant"; text: string }[];
  };
};
export function validateBacktestDraft(value: BacktestDraft) {
  validateBacktestConfig(value.config);
  if (value.data) validateBacktestData(value.data);
  if (value.conversation) {
    const c = value.conversation;
    validateBacktestConfig(c.config);
    if (
      typeof c.householdIncluded !== "boolean" ||
      typeof c.capturedAt !== "string" ||
      !Array.isArray(c.messages) ||
      c.messages.length > 40 ||
      c.messages.some(
        (m) =>
          !m ||
          !["user", "assistant"].includes(m.role) ||
          typeof m.text !== "string" ||
          m.text.length > 16000,
      )
    )
      throw Error("回测对话缓存无效。");
  }
}
// Large historical prices stay outside the shared wealth document. Household
// scope prevents another signed-in household from receiving this cached draft.
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("together-backtest-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("drafts");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(Error("无法打开本机回测缓存。"));
  });
}
export async function backtestCache(
  scope: string,
  value?: BacktestDraft,
): Promise<BacktestDraft | null> {
  if (!scope) throw Error("缺少家庭空间，未读取缓存。");
  const connection = await db();
  try {
    return await new Promise((resolve, reject) => {
      const tx = connection.transaction(
          "drafts",
          value ? "readwrite" : "readonly",
        ),
        s = tx.objectStore("drafts");
      let result: BacktestDraft | null = null;
      if (value) {
        validateBacktestDraft(value);
        s.put(value, scope);
        result = value;
      } else {
        const r = s.get(scope);
        r.onsuccess = () => {
          try {
            if (r.result) {
              validateBacktestDraft(r.result);
              result = r.result;
            }
          } catch {
            result = null;
          }
        };
      }
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(Error("回测未缓存到本机；请导出研究包，避免丢失。"));
    });
  } finally {
    connection.close();
  }
}
