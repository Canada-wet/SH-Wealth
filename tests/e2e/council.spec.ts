import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { authenticate, cleanupAuthenticated } from "./auth-helper";
import {
  COUNCIL_MODELS,
  councilPlan,
  councilFollowupPlan,
  type CouncilRun,
} from "../../lib/council";
import {
  EMPTY_COUNCIL_MEMO,
  type CouncilMemo,
} from "../../lib/council-library";
async function councilFixture(
  page: Page,
  { storage = true, interrupt = false, alibaba = false } = {},
) {
  let run: CouncilRun | null = null;
  let calls = 0;
  let memo: CouncilMemo = structuredClone(EMPTY_COUNCIL_MEMO);
  await page.route("**/api/council**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === "/api/council/library") {
      const body = request.postDataJSON();
      const userId = "00000000-0000-4000-8000-000000000001";
      if (body.action === "save") {
        if (body.memo.version !== memo.version)
          return route.fulfill({
            status: 409,
            json: { error: "另一设备已修改整理信息" },
          });
        memo = { ...body.memo, version: memo.version + 1 };
        return route.fulfill({ json: { userId, id: body.id, memo } });
      }
      const text = run
        ? [
            run.question,
            ...(run.turns ?? []).map((t) => t.question),
            ...run.steps.map((s) => s.answer),
            memo.title,
            memo.note,
            ...memo.tags,
          ]
            .join("\n")
            .toLowerCase()
        : "";
      const terms = String(body.query || "")
        .trim()
        .toLowerCase()
        .split(/\s+/);
      const hit =
        body.query &&
        run?.steps.find((s) =>
          terms.some((t) => s.answer.toLowerCase().includes(t)),
        );
      return route.fulfill({
        json: {
          userId,
          items: run
            ? [
                {
                  id: run.id,
                  question: run.question,
                  status: run.status,
                  createdAt: run.created_at,
                  activityAt: run.created_at,
                  rounds: run.turns?.length ?? 0,
                  models: run.models.map((m) => m.name),
                  excerpt:
                    run.steps
                      .find((s) => s.stage === "revision")
                      ?.answer.slice(0, 400) || "",
                  matchExcerpt: hit ? hit.answer.slice(-300) : "",
                  matchRound: hit ? (hit.round ?? 0) : null,
                  matchSeq: hit ? hit.seq : null,
                  matched: terms.every((t) => text.includes(t)),
                  memo,
                },
              ]
            : [],
        },
      });
    }
    if (request.method() === "GET") {
      if (new URL(request.url()).searchParams.get("id"))
        return route.fulfill({ json: { run } });
      return route.fulfill({
        json: {
          models: COUNCIL_MODELS,
          availability: COUNCIL_MODELS.map((m) => ({
            key: m.key,
            ready: (alibaba
              ? [
                  "qwen-light",
                  "qwen-flagship",
                  "glm-flagship",
                  "moonshot-alternative",
                  "moonshot-flagship",
                ]
              : ["deepseek-light", "openai-light", "openai-flagship"]
            ).includes(m.key),
            detail: "Synthetic configured state",
            ...(alibaba
              ? {
                  connection: {
                    channel: "alibaba",
                    model: m.key === "glm-flagship" ? "ZHIPU/GLM-5.3" : m.model,
                  },
                }
              : {}),
          })),
          storageReady: storage,
          runs: run
            ? [
                {
                  id: run.id,
                  question: run.question,
                  status: run.status,
                  created_at: run.created_at,
                },
              ]
            : [],
          ...(!storage
            ? { storageError: "研讨历史尚未连接，未启动付费调用。" }
            : {}),
        },
      });
    }
    const body = request.postDataJSON();
    expect(body).not.toHaveProperty("assets");
    expect(body).not.toHaveProperty("household");
    if (body.action === "check-alibaba")
      return route.fulfill({
        json: {
          check: {
            ok: true,
            message: "百炼型号目录连接成功（合成测试，不生成回答）",
            modelKeys: ["qwen-light", "glm-flagship", "moonshot-flagship"],
          },
        },
      });
    if (body.action === "create") {
      run = {
        id: body.id,
        question: body.question,
        attachments: body.attachments,
        research: body.research,
        workflow: body.workflow,
        participants: body.participants,
        judge: body.judge,
        status: "active",
        created_at: new Date().toISOString(),
        models: COUNCIL_MODELS.filter(
          (m) => body.participants.includes(m.key) || body.judge === m.key,
        ).map((m) =>
          alibaba
            ? {
                ...m,
                connection: {
                  channel: "alibaba" as const,
                  model: m.key === "glm-flagship" ? "ZHIPU/GLM-5.3" : m.model,
                },
              }
            : m,
        ),
        steps: councilPlan(
          body.participants,
          body.judge,
          body.research?.depth,
          body.workflow,
        ).map((s) => ({
          ...s,
          status: "pending",
          answer: "",
          error: "",
          usage: { input: null, output: null },
          started_at: null,
          finished_at: null,
        })),
      };
    } else if (body.action === "followup" && run) {
      run.turns = [
        ...(run.turns || []),
        {
          id: body.turnId,
          question: body.question,
          participants: body.participants,
          judge: body.judge,
          mode: body.mode || "direct",
          research: body.research,
          workflow: body.workflow,
          created_at: new Date().toISOString(),
        },
      ];
      const round = run.turns.length;
      for (const step of councilFollowupPlan(
        body.participants,
        body.judge,
        body.mode || "direct",
        round,
        run.steps.length,
        body.research?.depth,
        body.workflow,
      ))
        run.steps.push({
          ...step,
          status: "pending",
          answer: "",
          error: "",
          usage: { input: null, output: null },
          started_at: null,
          finished_at: null,
        });
      run.status = "active";
    } else if (body.action === "advance" && run) {
      calls++;
      const s = run.steps.find((s) => s.status === "pending");
      if (s) {
        s.started_at = new Date(Date.now() - 420000).toISOString();
        if (interrupt) {
          s.status = "running";
          return route.abort();
        }
        s.status = "succeeded";
        s.answer =
          s.stage === "judge"
            ? "### 简要答案\n\n合成测试结论：先做小规模试验。\n\n### 共识\n\n- 需要核验假设\n\n### 关键分歧\n\n- 风险的取舍不同\n\n### 行动建议\n\n- 用两周验证关键条件"
            : `### 合成测试结论\n\n**阶段 ${s.stage}**：比较机会成本，保留分歧。\n\n- 核验假设\n- 先做小规模试验`;
        s.finished_at = new Date().toISOString();
        s.usage = { input: 20, output: 40 };
        if (s.stage === "investigation") {
          s.answer =
            "### 本轮核查焦点\n\n核查观点1的C1，明确计算输入只是合成假设。";
          s.tool_receipts = [
            {
              id: `T${s.seq + 1}.1`,
              tool: "calculate",
              status: "succeeded",
              input: "2+2",
              output: "2+2 = 4（仅验证算式）",
              checkedAt: new Date().toISOString(),
            },
          ];
        }
      }
      if (
        run.steps.every(
          (s) => s.status === "succeeded" || s.status === "failed",
        )
      )
        run.status = "complete";
    } else if (body.action === "pause" && run) run.status = "paused";
    else if (body.action === "resume" && run) run.status = "active";
    else if (body.action === "cancel" && run) run.status = "cancelled";
    else if (body.action === "abandon" && run) {
      run.steps[body.seq].status = "failed";
      run.steps[body.seq].error = "提交结果不确定；用户选择跳过，未重新调用。";
    } else if (body.action === "delete") {
      run = null;
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ json: { run } });
  });
  return {
    calls: () => calls,
    run: () => run,
    seed: (value: CouncilRun) => {
      run = value;
    },
    memo: () => memo,
  };
}
test.afterEach(async ({ page }) => cleanupAuthenticated(page));
test("自定义环节增删排序、专职模型、重复质询、历史重读与自定义追问闭环", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  await authenticate(page);
  const fixture = await councilFixture(page);
  await page.goto("/council");
  const composer = page.locator(".council-composer");
  await composer
    .getByLabel("问题与已知条件")
    .fill("合成问题：如何用小规模试验比较方案与停止条件？");
  await composer
    .getByLabel("研讨深度", { exact: true })
    .selectOption("standard");
  await composer.getByLabel("流程方式", { exact: true }).selectOption("custom");
  await composer.getByRole("button", { name: /添加环节/ }).click();
  const cards = composer.locator(".council-flow-stage");
  await cards
    .nth(2)
    .getByLabel("环节名称", { exact: true })
    .fill("极端情景测试");
  await cards
    .nth(2)
    .getByRole("textbox", { name: /环节任务/ })
    .fill("比较三种情景的成本、可逆性与停止条件，用表格呈现。");
  await cards
    .nth(2)
    .getByRole("checkbox", { name: /GPT-6 Luna/ })
    .uncheck();
  await composer.getByRole("button", { name: "上移环节 3" }).click();
  await expect(
    cards.nth(1).getByLabel("环节名称", { exact: true }),
  ).toHaveValue("极端情景测试");
  await composer.getByRole("button", { name: /添加环节/ }).click();
  await cards
    .nth(3)
    .getByRole("combobox", { name: "环节 4 类型" })
    .selectOption("critique");
  await cards.nth(3).getByLabel("环节名称", { exact: true }).fill("第二轮质询");
  await composer.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await cards
    .nth(3)
    .getByRole("textbox", { name: /环节任务/ })
    .fill("只质询前一环节仍未解决的关键假设");
  await expect(
    composer.getByRole("checkbox", { name: /我同意把问题/ }),
  ).not.toBeChecked();
  await expect(composer).toContainText("9 次付费调用");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({
    width: info.project.name === "desktop" ? 1440 : 390,
    height: 1000,
  });
  await composer
    .locator(".council-flow-editor")
    .screenshot({ path: `/tmp/together-custom-flow-${info.project.name}.png` });
  await composer.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await composer.getByRole("button", { name: "开始研讨", exact: true }).click();
  await expect(page.locator(".council-session")).toContainText("9/9 步已归档", {
    timeout: 18000,
  });
  expect(fixture.calls()).toBe(9);
  expect(fixture.run()?.workflow?.stages.map((p) => p.title)).toEqual([
    "独立观点",
    "极端情景测试",
    "交叉质询",
    "第二轮质询",
    "最终结论",
  ]);
  await page.reload();
  await expect(page.locator(".council-session")).toContainText(
    "自定义流程 · 已冻结保存",
  );
  expect(fixture.calls()).toBe(9);
  await page.getByRole("button", { name: "展开完整发言", exact: true }).click();
  await page
    .getByRole("navigation", { name: "研讨阶段" })
    .getByRole("button", { name: /第二轮质询/ })
    .click();
  await expect(page.locator(".council-answer")).toHaveCount(2);
  await expect(page.locator(".council-answer").first()).toContainText(
    "第二轮质询",
  );
  const form = page.getByRole("region", { name: "继续追问", exact: true });
  await expect(form.getByLabel("流程方式", { exact: true })).toHaveValue(
    "custom",
  );
  await form.getByRole("button", { name: "删除环节 4" }).click();
  await form
    .getByRole("textbox", { name: "继续追问", exact: true })
    .fill("请按新条件重新检验情景，但不要重跑旧轮。");
  await form.getByRole("checkbox", { name: /确认将本场资料/ }).check();
  await form.getByRole("button", { name: "发送追问", exact: true }).click();
  await expect(page.locator(".council-session")).toContainText(
    "16/16 步已归档",
    { timeout: 15000 },
  );
  expect(fixture.calls()).toBe(16);
  expect(fixture.run()?.turns?.[0].workflow?.stages).toHaveLength(4);
  expect(fixture.run()?.workflow?.stages).toHaveLength(5);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  expect(await readFile((await (await download).path())!, "utf8")).toContain(
    "比较三种情景的成本、可逆性与停止条件",
  );
  await page.getByRole("button", { name: "复用本轮流程", exact: true }).click();
  await expect(composer.getByLabel("问题与已知条件")).toHaveValue("");
  await expect(composer.getByLabel("流程方式", { exact: true })).toHaveValue(
    "custom",
  );
  await expect(composer.locator(".council-flow-stage")).toHaveCount(4);
  await expect(
    composer.getByRole("checkbox", { name: /我同意把问题/ }),
  ).not.toBeChecked();
  expect(fixture.calls()).toBe(16);
});
test("研讨库正文搜索、私密笔记、置顶、归档恢复、刷新与深挖草稿闭环", async ({
  page,
}, info) => {
  test.skip(
    process.env.E2E_USE_MOCK_AUTH !== "1",
    "只使用隔离身份，不写真实研讨",
  );
  await authenticate(page);
  const fixture = await councilFixture(page);
  const keys = ["openai-light", "deepseek-light"],
    id = "c3000000-0000-4000-8000-000000000001";
  fixture.seed({
    id,
    question: "合成研讨：比较职业路径与机会成本",
    status: "complete",
    created_at: "2026-10-19T16:00:00Z",
    participants: keys,
    judge: null,
    models: COUNCIL_MODELS.filter((m) => keys.includes(m.key)),
    steps: councilPlan(keys, null).map((s, i) => ({
      ...s,
      status: "succeeded",
      answer:
        s.stage === "revision"
          ? `${"这是合成证据背景。".repeat(70)}独特检索词：北极星访谈计划`
          : `阶段观点 ${i}`,
      error: "",
      usage: { input: 1, output: 1 },
      started_at: null,
      finished_at: "2026-10-19T16:00:00Z",
    })),
  });
  await page.goto("/council");
  const rail = page.getByRole("complementary", { name: "我的研讨历史" });
  const showLibrary = async () => {
    const button = rail.getByRole("button", { name: "查看历史" });
    if (await button.isVisible()) await button.click();
  };
  await showLibrary();
  await rail.getByLabel("搜索研讨历史").fill("北极星 访谈");
  const card = rail.getByRole("button", { name: /合成研讨：比较职业路径/ });
  await expect(card).toBeEnabled();
  await expect(card).toContainText("命中原始研讨正文");
  await card.click();
  await expect(page.locator("#council-step-4")).toBeVisible();
  expect(fixture.calls()).toBe(0);
  const memo = page.getByRole("region", { name: "私人决策笔记" });
  await expect(memo.getByRole("button", { name: "整理与笔记" })).toBeEnabled();
  await memo.getByRole("button", { name: "整理与笔记" }).click();
  await memo.getByLabel("自定义标题").fill("职业选择的验证路线");
  await memo.getByLabel("标签", { exact: true }).fill("职业，验证");
  await memo
    .getByLabel("我的判断与待验证假设", { exact: true })
    .fill("我先做三次访谈，再评估假设。");
  await memo.getByLabel("下次复核日期", { exact: true }).fill("2026-01-01");
  await memo.getByRole("button", { name: "保存私人笔记" }).click();
  await expect(memo.getByText(/已私密保存/)).toBeVisible();
  await memo.getByRole("button", { name: "置顶这场研讨" }).click();
  await expect(memo.getByRole("button", { name: "取消置顶" })).toBeEnabled();
  await page.reload();
  await expect(memo.getByText("我先做三次访谈，再评估假设。")).toBeVisible();
  await showLibrary();
  await rail
    .getByRole("navigation", { name: "研讨库分类" })
    .getByRole("button", { name: /待复核/ })
    .click();
  await expect(
    rail.getByRole("button", { name: /职业选择的验证路线/ }),
  ).toBeVisible();
  await memo.getByRole("button", { name: "归档研讨", exact: true }).click();
  await expect(
    rail.getByRole("button", { name: /职业选择的验证路线/ }),
  ).toHaveCount(0);
  await rail
    .getByRole("navigation", { name: "研讨库分类" })
    .getByRole("button", { name: /已归档/ })
    .click();
  await expect(
    rail.getByRole("button", { name: /职业选择的验证路线/ }),
  ).toBeVisible();
  await memo.getByRole("button", { name: "恢复到全部研讨" }).click();
  await rail
    .getByRole("navigation", { name: "研讨库分类" })
    .getByRole("button", { name: /全部/ })
    .click();
  await expect(
    rail.getByRole("button", { name: /职业选择的验证路线/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "检验关键假设", exact: true }).click();
  const followup = page.getByRole("region", { name: "继续追问" });
  await expect(followup.getByRole("textbox")).toHaveValue(/最关键的三个假设/);
  await expect(
    followup.getByRole("checkbox", { name: /确认将本场资料/ }),
  ).not.toBeChecked();
  expect(fixture.calls()).toBe(0);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
  }
  await page.setViewportSize({
    width: info.project.name === "desktop" ? 1440 : 390,
    height: 1000,
  });
  await page.screenshot({
    path: `/tmp/together-council-library-${info.project.name}.png`,
    fullPage: true,
  });
  const collapse = rail.getByRole("button", { name: "收起历史" });
  if (await collapse.isVisible()) await collapse.click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: `/tmp/together-council-library-viewport-${info.project.name}.png`,
    fullPage: false,
  });
  expect(fixture.memo().tags).toEqual(["职业", "验证"]);
});
test("深入研讨默认五阶段，公开检索需另确认，回执、答辩、追问与导出联动", async ({
  page,
}, info) => {
  test.setTimeout(55000);
  await authenticate(page);
  const fixture = await councilFixture(page);
  await page.goto("/council");
  await expect(page.getByLabel("研讨深度", { exact: true })).toHaveValue(
    "deep",
  );
  await page
    .getByLabel("问题与已知条件")
    .fill("合成问题：结合基准率和敏感性，深入比较两个方案，不能只泛泛总结。");
  await page.getByText("可选：允许查证公开资料", { exact: true }).click();
  await page
    .getByLabel("公开检索词", { exact: true })
    .fill("Bank of Canada latest official policy rate");
  await page.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await expect(
    page.getByRole("button", { name: "开始研讨", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /我确认上述检索词可发送/ }).check();
  // Research changes revoke the previous model-cost consent too.
  await expect(
    page.getByRole("checkbox", { name: /我同意把问题/ }),
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await expect(page.locator(".council-composer")).toContainText(
    "10 次付费调用",
  );
  await page.getByRole("button", { name: "开始研讨", exact: true }).click();
  await expect(page.locator(".council-session")).toContainText(
    "10/10 步已归档",
    { timeout: 20000 },
  );
  expect(fixture.calls()).toBe(10);
  expect(fixture.run()?.research?.publicQueries).toEqual([
    "Bank of Canada latest official policy rate",
  ]);
  await expect(page.getByLabel("研讨结论速览")).toContainText("证据与计算记录");
  const receipts = page.locator(".council-results .council-tool-receipts");
  await receipts.locator("summary").first().click();
  await expect(receipts).toContainText("2+2 = 4");
  await page.getByRole("button", { name: "展开完整发言", exact: true }).click();
  await page.getByRole("button", { name: /^逐项答辩/ }).click();
  await expect(page.locator(".council-answer").first()).toContainText(
    "rebuttal",
  );
  await page.reload();
  await expect(page.locator(".council-session")).toContainText(
    "10/10 步已归档",
  );
  expect(fixture.calls()).toBe(10);
  const form = page.getByRole("region", { name: "继续追问", exact: true });
  await expect(form.getByLabel("研讨深度", { exact: true })).toHaveValue(
    "deep",
  );
  await form
    .getByRole("textbox", { name: "继续追问", exact: true })
    .fill("在这些边界条件下，请继续深入质询与答辩。");
  await form.getByRole("checkbox", { name: /确认将本场资料/ }).check();
  await form.getByRole("button", { name: "发送追问" }).click();
  await expect(page.locator(".council-session")).toContainText(
    "20/20 步已归档",
    { timeout: 20000 },
  );
  expect(fixture.calls()).toBe(20);
  expect(fixture.run()?.turns?.[0].research?.depth).toBe("deep");
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  expect(await readFile((await (await exported).path())!, "utf8")).toContain(
    "工具回执",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("council-deep.png"),
    fullPage: true,
  });
});
test("浏览器真实 ReadableStream 逐段显示临时正文，只有 result 归档帧才完成", async ({
  page,
}) => {
  await authenticate(page);
  const fixture = await councilFixture(page);
  await page.addInitScript(() => {
    const native = window.fetch;
    window.fetch = async (...args) => {
      const response = await native(...args);
      const options = args[1];
      let request;
      try {
        request = JSON.parse(String(options?.body || "{}"));
      } catch {
        return response;
      }
      if (request.action !== "advance" || !response.ok) return response;
      const data = await response.json();
      const encoder = new TextEncoder();
      const seq = Math.max(
        ...data.run.steps
          .filter((s: { status: string }) => s.status === "succeeded")
          .map((s: { seq: number }) => s.seq),
      );
      return new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(
              encoder.encode(
                JSON.stringify({ type: "progress", phase: "thinking", seq }) +
                  "\n",
              ),
            );
            await new Promise((r) => setTimeout(r, 250));
            c.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "progress",
                  phase: "answering",
                  seq,
                  preview: "### 合成流式正文\n\n这还是临时内容。",
                }) + "\n",
              ),
            );
            await new Promise((r) => setTimeout(r, 650));
            c.enqueue(
              encoder.encode(
                JSON.stringify({ type: "result", run: data.run }) + "\n",
              ),
            );
            c.close();
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    };
  });
  await page.goto("/council");
  await page.getByLabel("研讨深度", { exact: true }).selectOption("standard");
  await page
    .getByLabel("问题与已知条件")
    .fill("合成流式问题：请按固定阶段比较两个方案。");
  await page.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await page.getByRole("button", { name: "开始研讨", exact: true }).click();
  await expect(page.locator(".council-stream-preview")).toContainText(
    "临时正文",
  );
  await expect(page.locator(".council-stream-preview")).toContainText(
    "合成流式正文",
  );
  await expect(page.locator(".council-session")).toContainText("6/6 步已归档", {
    timeout: 20000,
  });
  expect(fixture.calls()).toBe(6);
  await expect(page.locator(".council-stream-preview")).toHaveCount(0);
  await page.reload();
  expect(fixture.calls()).toBe(6);
});
test("圆桌完整流程、可选裁判、刷新回看与导出，桌面和手机不溢出", async ({
  page,
}, info) => {
  test.setTimeout(45000);
  await authenticate(page);
  const fixture = await councilFixture(page);
  await page.goto("/council");
  await page.getByLabel("研讨深度", { exact: true }).selectOption("standard");
  await expect(
    page.getByRole("heading", { name: "多模型研讨", exact: true }),
  ).toBeVisible();
  const start = page.getByRole("button", { name: "开始研讨", exact: true });
  await expect(start).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: /DeepSeek V4.1 Flash/ }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "查看全部 8 家服务与待配置型号" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Qwen 3.8 Flash/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "只看已配置服务" }).click();
  await page
    .getByLabel("问题与已知条件")
    .fill("合成问题：比较继续工作与低成本创业的机会成本。");
  await page.getByLabel("裁判模型").selectOption("openai-flagship");
  await expect(page.locator(".council-composer")).toContainText("7 次付费调用");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  if (info.project.name !== "desktop")
    await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("council.png"),
    fullPage: true,
  });
  await page.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await start.click();
  await expect(page.locator(".council-session")).toContainText("7/7 步已归档", {
    timeout: 20000,
  });
  expect(fixture.calls()).toBe(7);
  await expect(
    page.locator(".council-stage-nav button[aria-current=step]"),
  ).toContainText("裁判汇总");
  await expect(page.locator(".council-answer")).toContainText("合成测试结论");
  await expect(page.getByLabel("研讨结论速览")).toContainText("关键分歧");
  const costs = page.getByRole("region", { name: "研讨成本分析" });
  await expect(
    costs.getByRole("heading", { name: "这次研讨，花在哪里" }),
  ).toBeVisible();
  await expect(costs).toContainText("模型与搜索估算合计");
  await expect(
    costs.locator(".council-result-metrics > div").nth(1).locator("strong"),
  ).toHaveText("7");
  await expect(
    costs.locator(".council-result-metrics > div").nth(2).locator("strong"),
  ).toHaveText("0");
  await costs.getByText("展开费用分布与优化提示", { exact: true }).click();
  await costs.getByRole("button", { name: "按环节", exact: true }).click();
  await expect(costs.locator(".council-cost-bars")).toContainText("裁判汇总");
  await costs.getByLabel("成本统计范围").selectOption("round");
  await expect(costs.getByLabel("成本统计范围")).toHaveValue("round");
  await page.getByRole("button", { name: "展开完整发言", exact: true }).click();
  await page.getByRole("button", { name: "交叉质询" }).click();
  await expect(page.locator(".council-answer")).toHaveCount(2);
  // Simulate a saved provider response that omitted usage, without rerunning it.
  const savedRun = fixture.run()!;
  savedRun.steps[0].usage = { input: null, output: null, requested: true };
  fixture.seed(savedRun);
  await page.reload();
  await expect(page.locator(".council-session")).toContainText("7/7 步已归档");
  await expect(costs).toBeVisible();
  await expect(costs).toContainText("已知部分小计 · 不是总账单");
  await expect(
    costs.locator(".council-result-metrics > div").nth(2).locator("strong"),
  ).toHaveText("1");
  await page.waitForTimeout(1500);
  expect(fixture.calls()).toBe(7);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/Together-研讨-.*\.md/);
  const path = await download.path();
  const exportedText = await readFile(path!, "utf8");
  expect(exportedText).toContain("裁判汇总");
  expect(exportedText).toContain("研讨成本（USD · 估算，非账单）");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除历史" }).click();
  await expect(page.getByLabel("问题与已知条件")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("无法恢复");
});
test("研讨结束后只问一位模型并可选裁判，轮次与材料刷新保留，旧轮发言不重跑", async ({
  page,
}) => {
  await authenticate(page);
  const fixture = await councilFixture(page);
  await page.goto("/council");
  await page.getByLabel("研讨深度", { exact: true }).selectOption("standard");
  await page
    .getByLabel("问题与已知条件")
    .fill("合成深度问题：应该如何比较两种选择？");
  await page.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await page.getByRole("button", { name: "开始研讨", exact: true }).click();
  await expect(page.locator(".council-session")).toContainText("6/6 步已归档", {
    timeout: 20000,
  });
  const form = page.getByRole("region", { name: "继续追问", exact: true });
  await form.getByRole("radio", { name: /直接回应/ }).check();
  await form
    .getByRole("textbox", { name: "继续追问", exact: true })
    .fill("如果只能投入两周时间，结论是否改变？");
  await form.getByRole("checkbox", { name: /DeepSeek V4.1/ }).uncheck();
  await form.getByLabel("追问裁判").selectOption("openai-light");
  await expect(form).toContainText("本次 2 次新调用");
  await expect(form.getByRole("button", { name: "发送追问" })).toBeDisabled();
  await form.getByRole("checkbox", { name: /确认将本场资料/ }).check();
  await form.getByRole("button", { name: "发送追问" }).click();
  await expect(page.locator(".council-session")).toContainText("8/8 步已归档", {
    timeout: 15000,
  });
  expect(fixture.calls()).toBe(8);
  await expect(page.getByLabel("讨论轮次")).toContainText("追问 1");
  await expect(page.getByLabel("研讨结论速览")).toContainText("1/1");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: test.info().outputPath("council-results.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".council-current-question")).toContainText(
    "如果只能投入两周",
  );
  expect(fixture.calls()).toBe(8);
  await page.getByRole("button", { name: "原始研讨", exact: true }).click();
  await expect(page.getByLabel("研讨结论速览")).toContainText("2/2");
  await page.getByRole("button", { name: "追问 1", exact: true }).click();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  expect(await readFile((await (await exported).path())!, "utf8")).toContain(
    "如果只能投入两周时间",
  );
});
test("追问默认相互辩论，三阶段及裁判可回看，直接回应混合轮次保留且刷新不重跑", async ({
  page,
}, info) => {
  test.setTimeout(45000);
  await authenticate(page);
  const fixture = await councilFixture(page);
  await page.goto("/council");
  await page.getByLabel("研讨深度", { exact: true }).selectOption("standard");
  await page
    .getByLabel("问题与已知条件")
    .fill("合成研讨：比较两种学习和生活计划。");
  await page.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await page.getByRole("button", { name: "开始研讨", exact: true }).click();
  await expect(page.locator(".council-session")).toContainText("6/6 步已归档", {
    timeout: 15000,
  });
  const form = page.getByRole("region", { name: "继续追问", exact: true });
  await expect(form.getByRole("radio", { name: /相互研讨/ })).toBeChecked();
  await form.getByRole("textbox").fill("如果时间减少一半，请互相质询再修订。 ");
  await form.getByLabel("追问裁判").selectOption("openai-light");
  await expect(form).toContainText("本次 7 次新调用");
  expect(
    (await form.getByLabel("追问裁判").boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  await expect(form.getByLabel("默认研讨流程")).toContainText("交叉质询");
  await form.screenshot({
    path: info.outputPath("council-followup-debate.png"),
  });
  await form.getByRole("checkbox", { name: /确认将本场资料/ }).check();
  await form.getByRole("button", { name: "发送追问" }).click();
  await expect(page.locator(".council-session")).toContainText(
    "13/13 步已归档",
    { timeout: 20000 },
  );
  expect(fixture.calls()).toBe(13);
  expect(fixture.run()?.turns?.[0].mode).toBe("debate");
  expect(
    fixture
      .run()
      ?.steps.filter((s) => s.round === 1)
      .map((s) => s.stage),
  ).toEqual([
    "opening",
    "opening",
    "critique",
    "critique",
    "revision",
    "revision",
    "judge",
  ]);
  await expect(page.locator(".council-current-question")).toContainText(
    "相互研讨",
  );
  await expect(page.getByLabel("研讨结论速览")).toContainText("2/2");
  await page.getByRole("button", { name: "展开完整发言", exact: true }).click();
  await page.getByRole("button", { name: /^交叉质询/ }).click();
  await expect(page.locator(".council-answer")).toHaveCount(2);
  await expect(page.locator(".council-answer").first()).toContainText(
    "critique",
  );
  await page.reload();
  await expect(page.locator(".council-session")).toContainText(
    "13/13 步已归档",
  );
  await expect(
    page
      .getByLabel("研讨结论速览")
      .getByLabel("修订结论 succeeded", { exact: true }),
  ).toHaveCount(2);
  expect(fixture.calls()).toBe(13);
  await form.getByRole("radio", { name: /直接回应/ }).check();
  // Followup settings now inherit the latest round, including its explicitly selected judge.
  await expect(form.getByLabel("追问裁判")).toHaveValue("openai-light");
  await form.getByLabel("追问裁判").selectOption("");
  await form.getByRole("checkbox", { name: /DeepSeek/ }).uncheck();
  await form.getByRole("textbox").fill("最后只请一位概括执行步骤。");
  await form.getByRole("checkbox", { name: /确认将本场资料/ }).check();
  await form.getByRole("button", { name: "发送追问" }).click();
  await expect(page.locator(".council-session")).toContainText(
    "14/14 步已归档",
    { timeout: 10000 },
  );
  await expect(page.locator(".council-current-question")).toContainText(
    "直接回应",
  );
  await page.getByRole("button", { name: "追问 1", exact: true }).click();
  await expect(page.locator(".council-current-question")).toContainText(
    "时间减少一半",
  );
  await expect(page.getByLabel("研讨结论速览")).toContainText("2/2");
  await page.getByRole("button", { name: "展开完整发言", exact: true }).click();
  await page.getByRole("button", { name: /^修订结论/ }).click();
  await expect(page.locator(".council-answer").first()).toContainText(
    "revision",
  );
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const text = await readFile((await (await exported).path())!, "utf8");
  expect(text).toContain("追问 1 · 相互研讨");
  expect(text).toContain("追问 2 · 直接回应");
  await page.screenshot({
    path: info.outputPath("council-debate-results.png"),
    fullPage: true,
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  expect(fixture.calls()).toBe(14);
});
test("图片、PDF、DOCX 和文字本机预览，检查看图兼容，归档后刷新仍可回看材料", async ({
  page,
}) => {
  await authenticate(page);
  await councilFixture(page);
  await page.goto("/council");
  await page.getByLabel("研讨深度", { exact: true }).selectOption("standard");
  await page
    .getByLabel("问题与已知条件")
    .fill("合成材料测试：请比较这些研究材料，不涉及真实资产。");
  const upload = page.getByLabel("添加研讨附件");
  await upload.setInputFiles({
    name: "unsupported.xlsx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("Synthetic unsupported format"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "本批未添加" }),
  ).toBeVisible();
  const cmap = await page.request.get(
    "/vendor/pdfjs/6.4.299/cmaps/UniGB-UCS2-H.bcmap",
  );
  expect(cmap.status()).toBe(200);
  expect(cmap.headers()["content-type"]).not.toContain("text/html");
  expect((await cmap.body()).byteLength).toBeGreaterThan(1000);
  await upload.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic evidence for the council"),
  });
  await page.getByText("notes.txt", { exact: true }).click();
  await expect(page.locator(".council-attachment pre")).toContainText(
    "Synthetic evidence",
  );
  await upload.setInputFiles({
    name: "remove-me.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Remove only this synthetic fixture"),
  });
  await page.getByText("remove-me.txt", { exact: true }).click();
  await page.getByRole("button", { name: "移除 remove-me.txt" }).click();
  await expect(page.getByText("remove-me.txt", { exact: true })).toHaveCount(0);
  const docx = zipSync({
    "word/document.xml": strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic DOCX evidence</w:t></w:r></w:p></w:body></w:document>',
    ),
  });
  await upload.setInputFiles({
    name: "brief.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(docx),
  });
  await page.getByText("brief.docx", { exact: true }).click();
  await expect(
    page
      .locator(".council-attachment pre")
      .filter({ hasText: "Synthetic DOCX" }),
  ).toBeVisible();
  // Tiny synthetic PDF with computed xref offsets; no real documents leave the machine.
  const stream =
    "BT /F1 12 Tf 36 120 Td (Synthetic PDF evidence for council) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 250 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await upload.setInputFiles({
    name: "evidence.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdf),
  });
  await page.getByText("evidence.pdf", { exact: true }).click();
  await expect(
    page
      .locator(".council-attachment pre")
      .filter({ hasText: "Synthetic PDF evidence" }),
  ).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 40;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#315c50";
    c.fillRect(0, 0, 80, 40);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await upload.setInputFiles({
    name: "chart.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page.getByText("chart.png", { exact: true }).click();
  await expect(page.getByAltText("研讨附件：chart.png")).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "所有参与者及裁判均支持看图" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /DeepSeek V4.1 Flash/ }).uncheck();
  await page.getByRole("checkbox", { name: /GPT-6 Astra/ }).check();
  await page.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await page.getByRole("button", { name: "开始研讨", exact: true }).click();
  await expect(page.locator(".council-session")).toContainText("6/6 步已归档", {
    timeout: 20000,
  });
  await page.reload();
  await expect(page.locator(".council-session")).toContainText(
    "本场材料 · 已随历史私密保存",
  );
  await expect(page.locator(".council-attachment")).toHaveCount(4);
  await page.getByText("evidence.pdf", { exact: true }).click();
  await expect(
    page
      .locator(".council-attachment pre")
      .filter({ hasText: "Synthetic PDF evidence" }),
  ).toBeVisible();
});

test("中断后刷新不会重扣请求；明确跳过与无裁判结论", async ({ page }) => {
  await authenticate(page);
  const fixture = await councilFixture(page, { interrupt: true });
  await page.goto("/council");
  await page.getByLabel("研讨深度", { exact: true }).selectOption("standard");
  await page
    .getByLabel("问题与已知条件")
    .fill("合成问题：给一个可验证的比较框架。");
  await page.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await page.getByRole("button", { name: "开始研讨", exact: true }).click();
  await expect(page.locator(".council-page > [role=alert]")).toBeVisible();
  expect(fixture.calls()).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "继续研讨", exact: true }),
  ).toBeDisabled();
  await page.waitForTimeout(1800);
  expect(fixture.calls()).toBe(1);
  await expect(
    page.getByRole("button", { name: "标记中断并跳过" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "标记中断并跳过" }).click();
  await expect(
    page.getByRole("button", { name: "继续研讨", exact: true }),
  ).toBeEnabled();
  expect(fixture.calls()).toBe(1);
  await page.getByRole("button", { name: "修订结论" }).click();
  await expect(page.locator(".council-no-judge")).toContainText("不生成虚假的");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "结束本场" }).click();
  await expect(page.locator(".council-status")).toHaveText("已停止");
});
test("云端未安装时不允许启动，配置与型号解释仍可查看", async ({ page }) => {
  await authenticate(page);
  const fixture = await councilFixture(page, { storage: false });
  await page.goto("/council");
  await page.getByLabel("研讨深度", { exact: true }).selectOption("standard");
  await page
    .getByLabel("问题与已知条件")
    .fill("合成问题：不应发起真实收费请求。");
  await page.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await expect(
    page.getByRole("button", { name: "开始研讨", exact: true }),
  ).toBeDisabled();
  await page.getByText(/模型来源与连接设置/).click();
  await expect(page.locator(".council-config")).toContainText(
    "K2.6 仅作在售备选",
  );
  expect(fixture.calls()).toBe(0);
});
test("同一百炼渠道可选 Qwen / Kimi / GLM；映射、连接检查及历史渠道明确", async ({
  page,
}) => {
  await authenticate(page);
  const f = await councilFixture(page, { alibaba: true });
  await page.goto("/council");
  await page.getByLabel("研讨深度", { exact: true }).selectOption("standard");
  await expect(
    page.getByRole("checkbox", { name: /Qwen 3.8 Flash/ }),
  ).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Kimi K2.6/ })).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /GLM 5.3 Flash/ }),
  ).toBeDisabled();
  await expect(page.locator(".council-model-grid")).toContainText(
    "阿里云百炼 · API 型号 ZHIPU/GLM-5.3",
  );
  await page.getByText(/模型来源与连接设置/).click();
  await page
    .getByRole("button", { name: "检查百炼连接（不生成回答）" })
    .click();
  await expect(page.getByRole("status")).toContainText("百炼型号目录连接成功");
  expect(f.calls()).toBe(0);
  await page
    .getByLabel("问题与已知条件")
    .fill("百炼合成问题：比较两种学习方法，不涉及私人资料。");
  await page.getByRole("checkbox", { name: /我同意把问题/ }).check();
  await page.getByRole("button", { name: "开始研讨", exact: true }).click();
  await expect(page.locator(".council-session")).toContainText("6/6 步已归档", {
    timeout: 15000,
  });
  await expect(page.locator(".council-answer").first()).toContainText(
    "阿里云百炼 · API 型号 qwen3.8-flash",
  );
});
