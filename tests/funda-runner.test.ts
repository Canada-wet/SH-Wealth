import { expect, it } from "vitest";
const {
  session,
  promptFor,
  validExport,
  sqlFor,
} = require("../lib/funda-runner.cjs");
const now = new Date("2026-10-16T13:40:00Z");
const s = session("open", now);
const config = {
  household: "00000000-0000-4000-8000-000000000011",
  projectRef: "abcdefghijklmnopqrst",
};
const token = "00000000-0000-4000-8000-000000000012";
it("多伦多夏令时、冬令时和开盘 / 收盘分离，不在夜间补查", () => {
  expect(s).toMatchObject({
    day: "2026-10-16",
    phase: "open",
    due: true,
    trading: true,
  });
  expect(session("open", new Date("2026-10-16T13:39:00Z")).due).toBe(false);
  expect(session("open", new Date("2026-10-16T14:40:00Z")).due).toBe(false);
  expect(session("close", new Date("2026-10-16T20:15:00Z")).due).toBe(true);
  expect(session("open", new Date("2026-11-02T14:40:00Z")).due).toBe(true);
  expect(session("open", new Date("2026-10-16T03:55:00Z")).due).toBe(false);
  expect(() => session("unknown", now)).toThrow();
});
it("NYSE休市跳过，半日市13:15完成后不在16:15再次触发", () => {
  expect(session("open", new Date("2026-11-26T14:40:00Z")).trading).toBe(false);
  expect(session("open", new Date("2026-10-17T13:40:00Z")).trading).toBe(false);
  expect(session("close", new Date("2026-11-27T18:15:00Z"))).toMatchObject({
    due: true,
    earlyClose: true,
    marketClose: "13:00",
  });
  expect(session("close", new Date("2026-11-27T21:15:00Z")).due).toBe(false);
  expect(session("close", new Date("2026-10-16T17:15:00Z")).due).toBe(false);
  expect(() => session("open", new Date("2029-01-02T14:40:00Z"))).toThrow(
    /calendar/,
  );
});
const exported = () => ({
  source: "funda",
  source_url: "https://funda.ai/agent-chat?c=synthetic",
  captured_at: now.toISOString(),
  prompt: promptFor(s),
  response: "合成研究原文，不是真实行情。",
  citations: [{ title: "Synthetic source", url: "https://www.bea.gov/" }],
  status: "complete",
  verification: "ai-unverified",
});
it("只归档新鲜且完全匹配当前任务的问题与原文，旧测试文件、跨时段、伪来源均拒绝", () => {
  expect(
    validExport({ ...exported(), extra: "not persisted" }, s, now),
  ).not.toHaveProperty("extra");
  for (const patch of [
    { prompt: promptFor(session("close", now)) },
    { captured_at: "2026-10-15T03:00:00Z" },
    { verification: "verified" },
    { source_url: "https://evil.test" },
    { response: "" },
    { citations: [{ title: "bad", url: "javascript:alert(1)" }] },
  ])
    expect(() => validExport({ ...exported(), ...patch }, s, now)).toThrow();
  expect(promptFor(s)).toContain("不使用历史对话、项目文件或个人持仓");
});
it("同日时段原子认领不自动抢占；URL与完成需令牌，禁止编造历史或更换私密目标", () => {
  const claim = sqlFor("claim", s, config, { token });
  expect(claim).toContain("on conflict do nothing");
  expect(claim).toContain("Clock mismatch");
  expect(claim).not.toMatch(/delete|on conflict do update/i);
  expect(() =>
    sqlFor("claim", { ...s, due: false }, config, { token }),
  ).toThrow();
  expect(() => sqlFor("finish", s, config, { token: "bad" })).toThrow();
  expect(() =>
    sqlFor("check", s, { ...config, household: "injection'" }),
  ).toThrow();
  expect(() =>
    sqlFor("attach", s, config, { token, url: "https://evil.test" }),
  ).toThrow();
});
it("完成必须锁定同一个任务、原样读回；只写研究表，不改财富账本", () => {
  const sql = sqlFor("finish", s, config, {
    token,
    row: validExport(exported(), s, now),
  });
  expect(sql).toContain("for update");
  expect(sql).toContain("Completed run cannot be replaced");
  expect(sql).toContain("Archive readback mismatch");
  expect(sql).not.toMatch(
    /household_documents|asset_snapshots|update public\.assets/,
  );
  expect(sql).toContain("ai-unverified");
});
