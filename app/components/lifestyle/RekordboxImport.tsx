"use client";
import { useEffect, useRef, useState } from "react";
import { FolderSync, Upload, FileCheck2 } from "lucide-react";
import {
  readRekordboxXML,
  previewRekordboxSmart,
  suggestedRekordboxScope,
  REKORDBOX_XML_LIMIT,
  type RekordboxCatalog,
} from "@/lib/rekordbox";
import { lifestyleFingerprint } from "@/lib/dj";
import type { Lifestyle } from "@/lib/lifestyle-schema";
import { downloadText, type SaveLifestyle } from "./shared";
import { useRekordboxSource } from "./useRekordboxSource";

type Draft = {
  catalog: RekordboxCatalog;
  scope: string;
  update: boolean;
  expected: string;
  filename: string;
  note: string;
  hash?: string;
  token?: number;
};
type Preview = ReturnType<typeof previewRekordboxSmart>;
export default function RekordboxImport({
  life,
  save,
  disabled,
  household,
}: {
  life: Lifestyle;
  save: SaveLifestyle;
  disabled: boolean;
  household: string | null;
}) {
  const input = useRef<HTMLInputElement>(null),
    version = useRef(0),
    lifeRef = useRef(life);
  lifeRef.current = life;
  const [draft, setDraft] = useState<Draft | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [reading, setReading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dragging, setDragging] = useState(false);
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );
  useEffect(() => {
    version.current++;
    setDraft(null);
    setPreview(null);
    setError("");
    setReading(false);
  }, [household]);
  const load = async (
    file: File,
    content?: string,
    hash?: string,
    token?: number,
    current = () => true,
  ) => {
    if (disabled) return false;
    const n = ++version.current,
      baseline = lifeRef.current;
    setReading(true);
    setError("");
    setNotice("");
    setDraft(null);
    setPreview(null);
    try {
      if (!/\.xml$/i.test(file.name))
        throw new Error(
          "请提供 rekordbox 导出的 .xml 文件，不需要音频文件或音乐文件夹。",
        );
      if (file.size > REKORDBOX_XML_LIMIT)
        throw new Error("XML 不能超过 12MB，请在 rekordbox 缩小导出范围。");
      const text = content ?? (await file.text());
      if (n !== version.current || !current()) return false;
      const catalog = readRekordboxXML(text),
        suggested = suggestedRekordboxScope(catalog, baseline);
      const next: Draft = {
        catalog,
        scope: suggested.scope,
        update: false,
        expected: lifestyleFingerprint(baseline),
        filename: file.name,
        note: suggested.note,
        hash,
        token,
      };
      setDraft(next);
      try {
        setPreview(previewRekordboxSmart(catalog, baseline, next.scope));
      } catch (e) {
        setError(e instanceof Error ? e.message : "无法预览，请调整导入范围。");
      }
      return true;
    } catch (e) {
      if (n === version.current && current())
        setError(e instanceof Error ? e.message : "XML 无法读取。");
      return false;
    } finally {
      if (n === version.current) setReading(false);
    }
  };
  const source = useRekordboxSource(
    household,
    disabled || reading || !!draft,
    (data, token, current) =>
      load(data.file, data.text, data.hash, token, current),
  );
  const repreview = (next: Draft) => {
    setError("");
    setDraft(next);
    setPreview(null);
    try {
      setPreview(
        previewRekordboxSmart(
          next.catalog,
          lifeRef.current,
          next.scope,
          next.update,
        ),
      );
      setDraft({ ...next, expected: lifestyleFingerprint(lifeRef.current) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览失败。");
    }
  };
  return (
    <div>
      <h3>导入曲库，不再逐项填写</h3>
      <p>从 rekordbox 导出一次 XML，拖进来就会自动识别曲目、Cue 和歌单。</p>
      <div
        className={`hobby-xml-drop ${dragging ? "is-dragging" : ""}`}
        role="region"
        aria-label="拖入 rekordbox XML"
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !reading) {
            e.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled || reading) return;
          if (e.dataTransfer.files.length !== 1) {
            setError("请一次拖入一个 XML 文件，不需要音乐文件夹。");
            return;
          }
          void load(e.dataTransfer.files[0]);
        }}
      >
        <Upload size={26} />
        <strong>
          {reading ? "正在自动检查曲库…" : "拖入 XML，或选择文件"}
        </strong>
        <span>自动预览 → 确认入库 · 不上传音频 · 最大 12MB</span>
        <button
          className="primary"
          disabled={disabled || reading || source.working}
          onClick={() => input.current?.click()}
        >
          选择 rekordbox XML
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".xml,application/xml,text/xml"
          aria-label="选择 rekordbox XML 文件"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void load(file);
          }}
        />
      </div>
      {source.supported && (
        <div className="hobby-xml-source">
          <div className="hobby-inline-actions">
            {source.source ? (
              <>
                <span>
                  <FolderSync size={16} /> 已连接：{source.source.handle.name}
                </span>
                <button
                  className="secondary"
                  disabled={disabled || source.working || reading || !!draft}
                  onClick={() => void source.check()}
                >
                  {source.working ? "检查中…" : "检查 XML 更新"}
                </button>
                <button
                  className="text-button"
                  disabled={source.working}
                  onClick={() => {
                    version.current++;
                    setReading(false);
                    setDraft(null);
                    setPreview(null);
                    void source.disconnect();
                  }}
                >
                  忘记文件
                </button>
              </>
            ) : (
              <button
                className="secondary"
                disabled={
                  disabled || !source.ready || source.working || reading
                }
                onClick={() => void source.connect()}
              >
                <FolderSync size={16} /> 连接并记住 XML
              </button>
            )}
          </div>
          <p className="hobby-caption">
            仅此浏览器、此账号与家庭记住文件。页面打开时每分钟检查一次；rekordbox
            修改后仍需重新导出到同一 XML，发现变化只生成预览。
          </p>
        </div>
      )}
      {!source.supported && (
        <p className="hobby-caption">
          当前浏览器可直接选文件导入。桌面 Chrome / Edge 支持记住
          XML，减少重复选文件。
        </p>
      )}
      {source.status && (
        <p role="status" className="hobby-caption">
          {source.status}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="hobby-notice">
          {notice}
        </p>
      )}
      {draft && (
        <div className="hobby-bridge-import">
          <p className="hobby-xml-file">
            <FileCheck2 size={18} /> {draft.filename} · 识别{" "}
            {draft.catalog.tracks.length} 首 / {draft.catalog.playlists.length}{" "}
            张歌单
          </p>
          <p className="hobby-caption">{draft.note}</p>
          <label>
            导入范围
            <select
              aria-label="rekordbox 导入范围"
              value={draft.scope}
              onChange={(e) =>
                repreview({
                  ...draft,
                  scope: e.target.value,
                  note: "已按你的选择重新预览；未保存。",
                })
              }
            >
              <option value="all">全部曲库与歌单</option>
              <option value="collection">仅曲库，不建立 Set</option>
              {draft.catalog.playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.path.join(" / ")} · {p.keys.length} 首
                </option>
              ))}
            </select>
          </label>
          <details>
            <summary>同路径匹配与更新选项</summary>
            <label className="hobby-bridge-checkbox">
              <input
                type="checkbox"
                checked={draft.update}
                onChange={(e) =>
                  repreview({ ...draft, update: e.target.checked })
                }
              />
              以 XML 更新相同音乐路径的曲目和 Cue（保留本地能量）
            </label>
            <p className="hobby-caption">
              默认保留现有曲目，不按曲名猜测合并。现有 Set
              编排、练习和财富数据都不覆盖。
            </p>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => repreview(draft)}
            >
              预览 XML 导入
            </button>
          </details>
          {preview && (
            <div
              className="hobby-import-preview"
              role="region"
              aria-label="rekordbox 导入预览"
            >
              <h4>已准备好，确认后才保存</h4>
              <p>
                新增 {preview.added} 首 · 更新 {preview.updated} 首 · 保留{" "}
                {preview.kept} 首；新增 {preview.setsAdded} 套 Set · 保留{" "}
                {preview.setsKept} 套。
              </p>
              <p className="hobby-caption">
                前 5 首：{preview.sample.join(" · ") || "没有可导入的曲目"}
              </p>
              {!!preview.issues.length && (
                <div className="hobby-xml-issues">
                  <strong>
                    跳过 {preview.skippedTracks} 首 / {preview.skippedPlaylists}{" "}
                    张歌单 · {preview.issues.length} 项检查提示
                  </strong>
                  <p>
                    以下内容不会导入，确认即保存其余有效内容。歌单可能移除不支持的曲目位置，请核对。
                  </p>
                  <details>
                    <summary>查看跳过原因与歌单变化</summary>
                    <ul>
                      {preview.issues.slice(0, 20).map((i, n) => (
                        <li key={n}>
                          {i.name}：{i.reason}
                        </li>
                      ))}
                    </ul>
                    {preview.issues.length > 20 && (
                      <p>仅展示前 20 项，完整清单可下载。</p>
                    )}
                  </details>
                  <button
                    className="text-button"
                    onClick={() =>
                      downloadText(
                        "rekordbox-import-report.json",
                        JSON.stringify(
                          {
                            file: draft.filename,
                            scope: draft.scope,
                            issues: preview.issues,
                          },
                          null,
                          2,
                        ),
                        "application/json",
                      )
                    }
                  >
                    下载完整检查清单
                  </button>
                </div>
              )}
              {!!preview.warnings.length && (
                <details>
                  <summary>导入说明（{preview.warnings.length}）</summary>
                  <ul>
                    {preview.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="hobby-inline-actions">
                <button
                  className="primary"
                  disabled={
                    disabled ||
                    !(preview.added + preview.updated + preview.setsAdded)
                  }
                  onClick={() => {
                    if (
                      save(
                        () => preview.next,
                        "导入 rekordbox XML",
                        draft.expected,
                      )
                    ) {
                      setNotice(
                        `已保存到本机：新增 ${preview.added} 首、更新 ${preview.updated} 首、${preview.setsAdded} 套 Set。云端状态见页首。`,
                      );
                      if (draft.hash && draft.token !== undefined)
                        void source.markImported(draft.hash, draft.token);
                      setDraft(null);
                      setPreview(null);
                    } else
                      setError(
                        "未保存：兴趣数据已改变，请重新预览后再确认，不会覆盖新的编辑。",
                      );
                  }}
                >
                  确认导入 rekordbox
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    version.current++;
                    setDraft(null);
                    setPreview(null);
                    setError("");
                  }}
                >
                  取消导入
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <details className="hobby-method">
        <summary>首次使用：如何从 rekordbox 导出？</summary>
        <ol>
          <li>电脑打开 rekordbox，File → Export Collection in xml format。</li>
          <li>
            保存到固定位置，例如 Documents /
            rekordbox.xml。不需要音乐文件或填写路径。
          </li>
          <li>
            将 XML 拖到这里；支持的浏览器可点“连接并记住
            XML”，以后更新这个文件即可。
          </li>
        </ol>
        <p>
          不是后台读取 rekordbox 数据库。首次建议用测试歌单核对；路径、备注与
          Cue 元数据会同步到你的私密家庭空间，文件授权本身仅留在此设备。
        </p>
      </details>
    </div>
  );
}
