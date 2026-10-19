#!/usr/bin/env node
// Offline verification only: never imports database clients, env files, or SQL.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function verifyMigrationManifest(root = path.resolve(__dirname, "..")) {
  const errors = [],
    migrations = [];
  const fail = (code, message) => errors.push({ code, message });
  let manifest;
  try {
    manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, "supabase/migrations/manifest.json"),
        "utf8",
      ),
    );
  } catch {
    fail("manifest_unreadable", "迁移清单不存在或不是有效 JSON。");
  }
  if (
    !errors.length &&
    (!manifest ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      manifest.manifestVersion !== 1 ||
      manifest.mode !== "verification-only" ||
      manifest.existingDatabasePolicy !== "manual-baseline-required" ||
      !Array.isArray(manifest.migrations) ||
      !manifest.migrations.length)
  )
    fail(
      "manifest_invalid",
      "清单版本、只校验模式、人工 baseline 策略或迁移列表无效。",
    );
  const ids = new Set(),
    files = new Set();
  if (!errors.length) {
    manifest.migrations.forEach((item, index) => {
      const row = { id: item?.id, path: item?.path, valid: true, issues: [] };
      const issue = (code, message) => {
        row.valid = false;
        row.issues.push({ code, message });
      };
      if (
        !item ||
        typeof item !== "object" ||
        item.id !==
          `${String(index + 1).padStart(3, "0")}-${String(item.path || "")
            .replace(/^supabase\//, "")
            .replace(/\.sql$/, "")}` ||
        ids.has(item.id)
      )
        issue(
          "order_or_id",
          "迁移 ID 必须唯一，按 001 开始连续编号并与固定 SQL 文件名对应。",
        );
      if (
        typeof item?.path !== "string" ||
        !/^supabase\/[a-z][a-z0-9-]*\.sql$/.test(item.path) ||
        files.has(item.path)
      )
        issue(
          "path_invalid",
          "SQL 路径必须是唯一固定的 supabase/*.sql，不接受绝对路径、遍历或任意脚本。",
        );
      if (
        !Array.isArray(item?.dependsOn) ||
        new Set(item.dependsOn).size !== item.dependsOn.length ||
        item.dependsOn.some((id) => typeof id !== "string" || !ids.has(id))
      )
        issue(
          "dependency_order",
          "依赖必须唯一且已在此前声明；未知、前向或循环依赖均拒绝。",
        );
      if (!/^[a-f0-9]{64}$/.test(String(item?.sha256 || "")))
        issue("checksum_invalid", "sha256 必须是 64 位小写十六进制。");
      if (
        !["bootstrap", "additive"].includes(item?.kind) ||
        (index === 0 && item.kind !== "bootstrap") ||
        (index > 0 && item.kind !== "additive")
      )
        issue(
          "kind_invalid",
          "首个 schema 是 bootstrap，其余为显式依赖的增量脚本。",
        );
      if (row.valid) {
        try {
          const absolute = path.join(root, item.path);
          const real = fs.realpathSync(absolute);
          if (!real.startsWith(fs.realpathSync(root) + path.sep)) throw Error();
          const actual = createHash("sha256")
            .update(fs.readFileSync(real))
            .digest("hex");
          row.sha256 = actual;
          if (actual !== item.sha256)
            issue(
              "checksum_mismatch",
              "文件内容与清单不符；需人工审阅变更，不能假称已迁移。",
            );
        } catch {
          issue("file_unreadable", "固定 SQL 文件缺失、越界或无法读取。");
        }
      }
      ids.add(item?.id);
      files.add(item?.path);
      migrations.push(row);
    });
    try {
      const actual = fs
        .readdirSync(path.join(root, "supabase"), { withFileTypes: true })
        .filter((file) => file.isFile() && file.name.endsWith(".sql"))
        .map((file) => `supabase/${file.name}`);
      for (const file of actual)
        if (!files.has(file))
          fail("unlisted_sql", `现有 SQL 未列入清单：${file}`);
    } catch {
      fail("sql_inventory_unreadable", "无法核对 supabase SQL 清单。");
    }
  }
  return {
    manifestVersion: 1,
    mode: "verification-only",
    status: errors.length || migrations.some((m) => !m.valid) ? "failed" : "ok",
    appliesSql: false,
    checksRemoteHistory: false,
    existingDatabasePolicy: "manual-baseline-required",
    errors,
    migrations,
  };
}
function main(args = process.argv.slice(2)) {
  if (
    args.some((arg) => arg !== "--json") ||
    new Set(args).size !== args.length
  ) {
    process.stdout.write(
      JSON.stringify({
        status: "failed",
        errors: [
          {
            code: "arguments_invalid",
            message: "仅支持不带参数或 --json；不会执行 SQL。",
          },
        ],
      }) + "\n",
    );
    process.exitCode = 1;
    return;
  }
  const result = verifyMigrationManifest();
  if (args.includes("--json"))
    process.stdout.write(JSON.stringify(result) + "\n");
  else {
    process.stdout.write(
      `迁移清单${result.status === "ok" ? "校验通过" : "校验失败"}；仅检查本地文件、顺序、依赖和 SHA-256，不执行数据库操作。\n`,
    );
    for (const issue of result.errors)
      process.stdout.write(`${issue.code}: ${issue.message}\n`);
    for (const row of result.migrations)
      process.stdout.write(
        `${row.valid ? "✓" : "!"} ${row.id} ${row.path}${row.issues.length ? " — " + row.issues.map((issue) => issue.code).join(", ") : ""}\n`,
      );
    process.stdout.write(
      "已有数据库必须核对真实历史并人工 baseline；不要直接重跑 schema.sql。\n",
    );
  }
  if (result.status !== "ok") process.exitCode = 1;
}
module.exports = { verifyMigrationManifest };
if (require.main === module) main();
