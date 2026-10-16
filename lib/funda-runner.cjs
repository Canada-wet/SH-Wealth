// Local task helper only. Does not drive browsers, fetch Funda, or store credentials.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const HOLIDAYS = {
  2026: [
    "01-01",
    "01-19",
    "02-16",
    "04-03",
    "05-25",
    "06-19",
    "07-03",
    "09-07",
    "11-26",
    "12-25",
  ],
  2027: [
    "01-01",
    "01-18",
    "02-15",
    "03-26",
    "05-31",
    "06-18",
    "07-05",
    "09-06",
    "11-25",
    "12-24",
  ],
  2028: [
    "01-17",
    "02-21",
    "04-14",
    "05-29",
    "06-19",
    "07-04",
    "09-04",
    "11-23",
    "12-25",
  ],
};
const EARLY = new Set([
  "2026-11-27",
  "2026-12-24",
  "2027-11-26",
  "2028-07-03",
  "2028-11-24",
]);
const uuid = (s) =>
  typeof s === "string" &&
  /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(s);
const quote = (s) => "'" + String(s).replaceAll("'", "''") + "'";
function session(phase, now = new Date()) {
  if (!["open", "close"].includes(phase))
    throw Error("Phase must be open or close.");
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = `${p.year}-${p.month}-${p.day}`;
  if (!HOLIDAYS[p.year])
    throw Error("NYSE calendar needs an update before running.");
  const trading =
    !["Sat", "Sun"].includes(p.weekday) &&
    !HOLIDAYS[p.year].includes(`${p.month}-${p.day}`);
  const closeMinute = EARLY.has(day) ? 13 * 60 : 16 * 60;
  const scheduled = phase === "open" ? 9 * 60 + 40 : closeMinute + 15;
  const minute = Number(p.hour) * 60 + Number(p.minute);
  return {
    day,
    phase,
    trading,
    earlyClose: EARLY.has(day),
    due: trading && minute >= scheduled && minute < scheduled + 60,
    key: `[SH-WEALTH ${day} ${phase}]`,
    marketClose: EARLY.has(day) ? "13:00" : "16:00",
  };
}
function promptFor(s) {
  return `${s.key} 请仅根据公开信息生成一份${s.phase === "open" ? "美股开盘后市场快照，明确区分昨日收盘、盘前和当前盘中" : "美股收盘复盘，区分常规时段收盘与盘后"}，供已获授权的私密内部研究归档。不使用历史对话、项目文件或个人持仓。不自动执行或建议具体交易。日期为 ${s.day}，时区 America/Toronto，当日常规收盘 ${s.marketClose}。请注明实际查询截至时间，不把尚未公布或更新的数据当成今日数据。包括：大盘和半导体/AI；VIX、2年和10年美债收益率及利差；1 CAD兑换USD/CNY/JPY；最新CPI/GDP/非农的统计期间、发布日期和修订；AI产业供需的可核实代理信号，明确不是直接供需指数；接下来3个重要事件。每个数值附观察日期和来源，缺失则明确写缺失。事实与AI判断分开，列出限制，附3至8个可点击来源。控制在约1000中文字，不估造数值。`;
}
function validExport(raw, s, now = new Date()) {
  if (!raw || typeof raw !== "object") throw Error("Invalid export.");
  const fields = [
    "source",
    "source_url",
    "captured_at",
    "prompt",
    "response",
    "citations",
    "status",
    "verification",
  ];
  const row = Object.fromEntries(fields.map((k) => [k, raw[k]]));
  const age = now.getTime() - Date.parse(row.captured_at);
  const safe = (u) => {
    try {
      const x = new URL(u);
      return (
        typeof u === "string" &&
        u.length <= 4000 &&
        x.protocol === "https:" &&
        !x.username &&
        !x.password
      );
    } catch {
      return false;
    }
  };
  if (
    row.source !== "funda" ||
    !/^https:\/\/funda\.ai\/agent-chat\?c=[A-Za-z0-9_-]+$/.test(
      row.source_url,
    ) ||
    row.verification !== "ai-unverified" ||
    !["complete", "partial"].includes(row.status) ||
    !Number.isFinite(age) ||
    age < -300000 ||
    age > 3600000 ||
    typeof row.prompt !== "string" ||
    row.prompt !== promptFor(s) ||
    typeof row.response !== "string" ||
    !row.response.trim() ||
    row.response.length > 50000 ||
    !Array.isArray(row.citations) ||
    row.citations.length > 40 ||
    !row.citations.every(
      (c) =>
        c &&
        typeof c.title === "string" &&
        c.title.length <= 500 &&
        safe(c.url),
    )
  )
    throw Error(
      "Export is stale, belongs to another session, or has invalid fields.",
    );
  return row;
}
function identitySql(config) {
  if (!uuid(config.household) || !/^[a-z0-9]{20}$/.test(config.projectRef))
    throw Error("Invalid local target configuration.");
  return `do $$ begin
    if (select string_agg(lower(u.email),',' order by lower(u.email)) from public.household_members m join auth.users u on u.id=m.user_id where m.household_id=${quote(config.household)}::uuid and u.email_confirmed_at is not null) is distinct from 'henrywhy233@gmail.com,sallyxie0378@gmail.com' then raise exception 'Unexpected household membership'; end if;
  end; $$;`;
}
function sqlFor(command, s, config, options = {}) {
  const h = quote(config.household),
    d = quote(s.day),
    p = quote(s.phase);
  const where = `household_id=${h}::uuid and day=${d}::date and phase=${p}`;
  const prefix = `begin; ${identitySql(config)}`;
  if (command === "check")
    return `${prefix} select day,phase,token,source_url,report_id from public.wealth_research_runs where ${where}; commit;`;
  if (!["claim", "attach", "finish"].includes(command) || !uuid(options.token))
    throw Error("Invalid command or run token.");
  const token = quote(options.token);
  if (command === "claim") {
    if (!s.due)
      throw Error(
        "Outside current trading-session window; do not backfill missed queries.",
      );
    return `${prefix} do $$ begin if ${d}::date<>(now() at time zone 'America/Toronto')::date then raise exception 'Clock mismatch'; end if; end; $$;
      with claimed as (insert into public.wealth_research_runs(household_id,day,phase,token) values(${h}::uuid,${d}::date,${p},${token}::uuid) on conflict do nothing returning 1) select exists(select 1 from claimed) as claimed; commit;`;
  }
  const locked = `${where} and token=${token}::uuid`;
  if (command === "attach") {
    if (
      !/^https:\/\/funda\.ai\/agent-chat\?c=[A-Za-z0-9_-]+$/.test(options.url)
    )
      throw Error("Invalid visible conversation URL.");
    return `${prefix} with attached as(update public.wealth_research_runs set source_url=${quote(options.url)} where ${locked} and report_id is null and (source_url is null or source_url=${quote(options.url)}) returning 1) select exists(select 1 from attached) as attached; commit;`;
  }
  const row = options.row;
  const payload = Buffer.from(JSON.stringify(row)).toString("base64");
  const hash = crypto
    .createHash("sha256")
    .update(row.prompt + "\n" + row.response)
    .digest("hex");
  return `${prefix}
    do $$ declare v jsonb:=convert_from(decode('${payload}','base64'),'utf8')::jsonb; run public.wealth_research_runs%rowtype; found_id uuid;
    begin
      select * into strict run from public.wealth_research_runs where ${locked} for update;
      if run.source_url is not null and run.source_url<>v->>'source_url' then raise exception 'Source URL changed'; end if;
      if run.report_id is not null then
        if not exists(select 1 from public.wealth_research_archive where id=run.report_id and household_id=${h}::uuid and content_hash='${hash}') then raise exception 'Completed run cannot be replaced'; end if;
      else
        insert into public.wealth_research_archive(household_id,source,source_url,captured_at,prompt,response,citations,status,verification,content_hash)
        values(${h}::uuid,'funda',v->>'source_url',(v->>'captured_at')::timestamptz,v->>'prompt',v->>'response',v->'citations',v->>'status','ai-unverified','${hash}') returning id into found_id;
        update public.wealth_research_runs set report_id=found_id,source_url=v->>'source_url' where ${locked};
      end if;
      if not exists(select 1 from public.wealth_research_archive a join public.wealth_research_runs r on r.report_id=a.id where r.household_id=${h}::uuid and r.day=${d}::date and r.phase=${p} and a.household_id=r.household_id and a.response=v->>'response' and a.prompt=v->>'prompt' and a.citations=v->'citations') then raise exception 'Archive readback mismatch'; end if;
    end; $$;
    select true as archived,true as exact_readback; commit;`;
}
function main() {
  const [command, phase, token, arg] = process.argv.slice(2);
  const s = session(phase);
  if (command === "due") {
    console.log(JSON.stringify(s));
    return;
  }
  if (command === "prompt") {
    console.log(promptFor(s));
    return;
  }
  const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".local/funda/config.json"), "utf8"),
  );
  const linked = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "supabase/.temp/linked-project.json"),
      "utf8",
    ),
  );
  if (
    linked.ref !== config.projectRef ||
    !path.isAbsolute(config.cli) ||
    !fs.existsSync(config.cli)
  )
    throw Error(
      "Local Supabase runtime or project link unavailable; ask the user, do not change permissions.",
    );
  const options = { token: command === "claim" ? crypto.randomUUID() : token };
  if (command === "attach") options.url = arg;
  if (command === "finish")
    options.row = validExport(JSON.parse(fs.readFileSync(arg, "utf8")), s);
  const sql = sqlFor(command, s, config, options);
  const result = cp.spawnSync(
    config.cli,
    [
      "db",
      "query",
      "--linked",
      "--project-ref",
      config.projectRef,
      sql,
      "--output",
      "json",
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.status !== 0)
    throw Error(
      "Private database operation failed; verify existing login and retry only the same saved response.",
    );
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw Error(
      "Unrecognized database response; do not repeat a Funda submission.",
    );
  }
  if (!Array.isArray(parsed.rows))
    throw Error("Database response missing rows.");
  console.log(
    JSON.stringify({
      command,
      day: s.day,
      phase,
      ...(command === "claim" ? { token: options.token } : {}),
      rows: parsed.rows,
    }),
  );
}
module.exports = { session, promptFor, validExport, sqlFor };
if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
