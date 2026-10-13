import { describe, it, expect } from "vitest";
import {
  BACKUP_KEY,
  parseBackup,
  readState,
  STATE_KEY,
  writeState,
} from "../lib/storage";
import { emptyState, finishChange, saveAsset } from "../lib/wealth";
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}
describe("持久化与迁移", () => {
  it("完整数据往返，资产、回报、贡献、规划、聊天与偏好都持久化", () => {
    const db = storage();
    const state = saveAsset(emptyState(), {
      id: "a",
      name: "股票",
      category: "自定义",
      owner: "first",
      value: 100.25,
      annualReturn: -8.5,
    });
    state.contributions = [
      {
        id: "c",
        member: "first",
        assetId: null,
        amount: 20,
        kind: "deposit",
        date: "2026-10-12",
        note: "历史出资",
      },
    ];
    state.messages = [{ id: "m", role: "user", text: "你好" }];
    state.plan = {
      values: { essential_monthly: "4000" },
      checks: { done: true },
    };
    state.preferences.model = "deepseek-chat";
    writeState(db, state);
    expect(readState(db)).toEqual(state);
    expect(parseBackup(JSON.stringify(state))).toEqual(state);
  });
  it("旧资产和回报迁移保留，成员归属映射为固定ID", () => {
    const db = storage();
    db.setItem(
      "together-assets",
      JSON.stringify([["RRSP", "Han", "$93,420.50", "-2.5%", "退休"]]),
    );
    const next = readState(db);
    expect(next.assets[0]).toMatchObject({
      owner: "second",
      value: 93420.5,
      annualReturn: -2.5,
    });
  });
  it("删除所有资产后重新打开仍为空", () => {
    const db = storage();
    db.setItem("together-assets", "[]");
    expect(readState(db).assets).toEqual([]);
    writeState(db, emptyState());
    expect(readState(db).assets).toEqual([]);
  });
  it("写失败抛错，不声称已保存；原数据保留", () => {
    const db = storage();
    const state = emptyState();
    writeState(db, state);
    const blocked = {
      getItem: db.getItem,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeState(blocked, { ...state, revision: 1 }, 0)).toThrow();
    expect(readState(db).revision).toBe(0);
  });
  it("跨页版本冲突拒绝覆盖", () => {
    const db = storage();
    writeState(db, { ...emptyState(), revision: 2 });
    expect(() => writeState(db, { ...emptyState(), revision: 1 }, 0)).toThrow(
      /另一个页面/,
    );
    expect(readState(db).revision).toBe(2);
  });
  it("保留上一版本备份；无效导入不会改变当前数据", () => {
    const db = storage();
    writeState(db, emptyState());
    writeState(db, finishChange(emptyState(), emptyState(), "更新"), 0);
    expect(JSON.parse(db.getItem(BACKUP_KEY)!).revision).toBe(0);
    expect(() => parseBackup('{"version":3}')).toThrow();
    expect(readState(db).revision).toBe(1);
  });
  it("坏JSON不被静默改为空白家庭", () => {
    const db = storage();
    db.setItem(STATE_KEY, "broken");
    expect(() => readState(db)).toThrow();
    expect(db.getItem(STATE_KEY)).toBe("broken");
  });
});
