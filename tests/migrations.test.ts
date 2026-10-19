import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
type Result = {
  status: string;
  appliesSql: boolean;
  checksRemoteHistory: boolean;
  errors: { code: string }[];
  migrations: { valid: boolean; issues: { code: string }[] }[];
};
const {
  verifyMigrationManifest,
}: { verifyMigrationManifest: (root?: string) => Result } = createRequire(
  import.meta.url,
)("../scripts/check-migrations.cjs");
const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "together-migration-test-"));
  temporary.push(root);
  mkdirSync(join(root, "supabase/migrations"), { recursive: true });
  const sql = "-- Synthetic SQL. This test must never execute it.\nselect 1;\n";
  const manifest = {
    manifestVersion: 1,
    mode: "verification-only",
    existingDatabasePolicy: "manual-baseline-required",
    migrations: ["schema", "persistence"].map((name, i) => ({
      id: `${String(i + 1).padStart(3, "0")}-${name}`,
      path: `supabase/${name}.sql`,
      sha256: createHash("sha256").update(sql).digest("hex"),
      dependsOn: i ? ["001-schema"] : [],
      kind: i ? "additive" : "bootstrap",
    })),
  };
  for (const item of manifest.migrations)
    writeFileSync(join(root, item.path), sql);
  const save = () =>
    writeFileSync(
      join(root, "supabase/migrations/manifest.json"),
      JSON.stringify(manifest),
    );
  save();
  return { root, manifest, save };
}
it("实际清单覆盖全部固定SQL，校验仅本地顺序/hash，不执行SQL或读取远端历史", () => {
  const result = verifyMigrationManifest();
  expect(result).toMatchObject({
    status: "ok",
    appliesSql: false,
    checksRemoteHistory: false,
  });
  expect(result.migrations.length).toBeGreaterThanOrEqual(14);
  const text = readFileSync("scripts/check-migrations.cjs", "utf8");
  expect(text).not.toMatch(/require\(["'](?:dotenv|@supabase|pg)[^"']*["']\)/);
  expect(text).not.toContain("process.env");
});
it("--json输出机器可读结果且明确不是自动迁移器", () => {
  const result = JSON.parse(
    execFileSync(process.execPath, ["scripts/check-migrations.cjs", "--json"], {
      encoding: "utf8",
    }),
  );
  expect(result).toMatchObject({
    status: "ok",
    mode: "verification-only",
    appliesSql: false,
    existingDatabasePolicy: "manual-baseline-required",
  });
});
it("SQL内容变化、缺文件和未列SQL均失败，不自动刷新hash", () => {
  const a = fixture();
  writeFileSync(join(a.root, "supabase/schema.sql"), "select 2;");
  expect(verifyMigrationManifest(a.root).migrations[0].issues[0].code).toBe(
    "checksum_mismatch",
  );
  const b = fixture();
  rmSync(join(b.root, "supabase/persistence.sql"));
  expect(verifyMigrationManifest(b.root).migrations[1].issues[0].code).toBe(
    "file_unreadable",
  );
  const c = fixture();
  writeFileSync(join(c.root, "supabase/unlisted.sql"), "select 3;");
  expect(verifyMigrationManifest(c.root).errors[0].code).toBe("unlisted_sql");
});
it.each(["unknown", "forward", "duplicate"])(
  "依赖%s失败，不接受未安装或循环前向依赖",
  (kind) => {
    const f = fixture();
    if (kind === "unknown")
      f.manifest.migrations[1].dependsOn = ["000-missing"];
    else if (kind === "forward")
      f.manifest.migrations[0].dependsOn = ["002-persistence"];
    else f.manifest.migrations[1].dependsOn = ["001-schema", "001-schema"];
    f.save();
    expect(
      verifyMigrationManifest(f.root).migrations.some((m) =>
        m.issues.some((e) => e.code === "dependency_order"),
      ),
    ).toBe(true);
  },
);
it.each(["../escape.sql", "/etc/passwd", "supabase/../../escape.sql"])(
  "拒绝路径越界%s",
  (bad) => {
    const f = fixture();
    f.manifest.migrations[1].path = bad;
    f.save();
    expect(
      verifyMigrationManifest(f.root).migrations[1].issues.some(
        (e) => e.code === "path_invalid",
      ),
    ).toBe(true);
  },
);
it("拒绝重复迁移、错误顺序与篡改只校验策略", () => {
  const f = fixture();
  f.manifest.migrations[1] = { ...f.manifest.migrations[0] };
  f.save();
  expect(verifyMigrationManifest(f.root).status).toBe("failed");
  f.manifest.mode = "execute-all";
  f.save();
  expect(verifyMigrationManifest(f.root).errors[0].code).toBe(
    "manifest_invalid",
  );
});
it.each([null, false, 0, "", []])(
  "无效的清单根值 %j 返回结构化失败而非崩溃或通过",
  (value) => {
    const f = fixture();
    writeFileSync(
      join(f.root, "supabase/migrations/manifest.json"),
      JSON.stringify(value),
    );
    expect(verifyMigrationManifest(f.root)).toMatchObject({
      status: "failed",
      appliesSql: false,
      errors: [{ code: "manifest_invalid" }],
    });
  },
);
