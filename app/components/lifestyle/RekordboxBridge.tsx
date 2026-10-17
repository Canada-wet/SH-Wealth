"use client";
import { useRef, useState } from "react";
import { ArrowLeftRight, Upload, Download } from "lucide-react";
import {
  readRekordboxXML,
  previewRekordbox,
  exportRekordbox,
  REKORDBOX_XML_LIMIT,
  type RekordboxCatalog,
} from "@/lib/rekordbox";
import { lifestyleFingerprint } from "@/lib/dj";
import type { Lifestyle } from "@/lib/lifestyle-schema";
import { downloadText, type SaveLifestyle } from "./shared";
export default function RekordboxBridge({
  life,
  save,
  disabled,
}: {
  life: Lifestyle;
  save: SaveLifestyle;
  disabled: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [catalog, setCatalog] = useState<RekordboxCatalog | null>(null),
    [scope, setScope] = useState("all"),
    [update, setUpdate] = useState(false),
    [expected, setExpected] = useState(""),
    [reading, setReading] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<ReturnType<
      typeof previewRekordbox
    > | null>(null),
    [exportScope, setExportScope] = useState("all"),
    [notice, setNotice] = useState("");
  const compatible = life.tracks.filter((t) => t.fileLocation).length;
  return (
    <section className="card hobby-rekordbox" aria-label="rekordbox 交换中心">
      <div className="hobby-section-head">
        <div>
          <span className="hobby-kicker">PREPARE HERE · PLAY IN REKORDBOX</span>
          <h2>
            <ArrowLeftRight size={21} /> 与 rekordbox 来回编排
          </h2>
          <p>通过官方 XML 格式交换，不直接修改数据库，也不是实时自动同步。</p>
        </div>
        <span className="hobby-chip">
          {compatible} / {life.tracks.length} 首已关联路径
        </span>
      </div>
      <p className="hobby-notice">
        只读取 XML
        元数据，不上传音频、不读取音乐文件。导入后的路径、备注和拍点会随家庭空间共享给另一位成员；音乐仍须在使用
        rekordbox 的电脑上。
      </p>
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
      <div className="hobby-bridge-grid">
        <div>
          <h3>1 · 从 rekordbox 带进来</h3>
          <p>
            在 rekordbox 的 File 菜单选择 Export Collection in xml
            format，再选择该 XML（最大 12MB）。先预览，再保存。
          </p>
          <button
            className="secondary"
            disabled={disabled || reading}
            onClick={() => file.current?.click()}
          >
            <Upload size={16} />
            {reading ? "正在检查 XML…" : "选择 rekordbox XML"}
          </button>
          <input
            ref={file}
            type="file"
            hidden
            accept=".xml,application/xml,text/xml"
            aria-label="选择 rekordbox XML 文件"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setError("");
              setNotice("");
              setPreview(null);
              setCatalog(null);
              setReading(true);
              const baseline = lifestyleFingerprint(life);
              try {
                if (f.size > REKORDBOX_XML_LIMIT)
                  throw new Error("XML 不能超过 12MB。");
                const parsed = readRekordboxXML(await f.text());
                setCatalog(parsed);
                setExpected(baseline);
                setScope("all");
                setUpdate(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : "XML 无法读取。");
              } finally {
                setReading(false);
              }
            }}
          />
          {catalog && (
            <div className="hobby-bridge-import">
              <p>
                识别到 {catalog.tracks.length} 首曲目、
                {catalog.playlists.length}{" "}
                个歌单。大曲库可只选择一个歌单及其引用曲目。
              </p>
              <label>
                导入范围
                <select
                  aria-label="rekordbox 导入范围"
                  value={scope}
                  onChange={(e) => {
                    setScope(e.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="all">全部曲库与歌单</option>
                  <option value="collection">仅曲库，不建立 Set</option>
                  {catalog.playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.path.join(" / ")} · {p.keys.length} 首
                    </option>
                  ))}
                </select>
              </label>
              <label className="hobby-bridge-checkbox">
                <input
                  type="checkbox"
                  checked={update}
                  onChange={(e) => {
                    setUpdate(e.target.checked);
                    setPreview(null);
                  }}
                />
                以 XML 更新相同音乐路径的曲目和 Cue（保留本地能量）
              </label>
              <p className="hobby-caption">
                默认保留现有曲目；不按同名曲猜测合并。已导入的同路径歌单保留现有编排，不覆盖练习、Set
                转场或财富数据。
              </p>
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => {
                  setError("");
                  try {
                    setPreview(previewRekordbox(catalog, life, scope, update));
                  } catch (e) {
                    setPreview(null);
                    setError(e instanceof Error ? e.message : "预览失败。");
                  }
                }}
              >
                预览 XML 导入
              </button>
              {preview && (
                <div
                  className="hobby-import-preview"
                  role="region"
                  aria-label="rekordbox 导入预览"
                >
                  <h4>确认这次交换</h4>
                  <p>
                    所选 XML 曲目（前 5 首）：
                    {preview.sample.join(" · ") || "空歌单"}
                  </p>
                  <p>
                    新增 {preview.added} 首 · 更新 {preview.updated} 首 · 保留{" "}
                    {preview.kept} 首；新增 {preview.setsAdded} 套 Set · 保留{" "}
                    {preview.setsKept} 套。
                  </p>
                  <ul>
                    {preview.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <p>
                    歌单按原顺序导入，重复出现的曲目也保留。文件夹路径用于 Set
                    名称；导回时为平铺歌单。
                  </p>
                  <button
                    className="primary"
                    disabled={
                      disabled ||
                      !(preview.added + preview.updated + preview.setsAdded)
                    }
                    onClick={() => {
                      if (
                        save(() => preview.next, "导入 rekordbox XML", expected)
                      ) {
                        setNotice(
                          `已保存到本机：新增 ${preview.added} 首、更新 ${preview.updated} 首、${preview.setsAdded} 套 Set。云端状态见页首。`,
                        );
                        setCatalog(null);
                        setPreview(null);
                      } else
                        setError(
                          "未保存。兴趣数据已改变时不会覆盖，请重新读取 XML 后预览。",
                        );
                    }}
                  >
                    确认导入 rekordbox
                  </button>{" "}
                  <button
                    className="text-button"
                    onClick={() => {
                      setCatalog(null);
                      setPreview(null);
                    }}
                  >
                    取消导入
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <h3>2 · 把编排带回 rekordbox</h3>
          <p>
            曲目 Cue、Hot Cue A–H、Loop 与来源 BeatGrid 随 XML 导出；每套 Set
            成为一个保持顺序的歌单。
          </p>
          <label>
            导出范围
            <select
              aria-label="rekordbox 导出范围"
              value={exportScope}
              onChange={(e) => {
                setExportScope(e.target.value);
                setNotice("");
              }}
            >
              <option value="all">全部曲库与 Set</option>
              {life.sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.entries.length} 首
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={disabled || !life.tracks.length}
            onClick={() => {
              setError("");
              try {
                const result = exportRekordbox(
                  life,
                  exportScope === "all" ? undefined : exportScope,
                );
                downloadText(
                  "Together-rekordbox.xml",
                  result.xml,
                  "application/xml;charset=utf-8",
                );
                setNotice(
                  `已导出 ${result.tracks} 首、${result.sets} 套 Set。${result.warnings.join(" ")}`,
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "未生成 XML。");
              }
            }}
          >
            <Download size={16} />
            导出 rekordbox XML
          </button>
          <p className="hobby-caption">
            缺少真实路径会阻止导出，不会用曲名猜文件。可在「曲库 →
            编辑曲目」填写 Mac / Windows 绝对路径；移动电脑或磁盘后需在
            rekordbox 重新定位。网页不能检查路径是否存在。
          </p>
          <details>
            <summary>在 rekordbox 中导入：两项设置与一步复制</summary>
            <ol>
              <li>先备份 rekordbox 曲库，建议用单独测试歌单试导。</li>
              <li>
                Preferences → View → Layout → Media Browser，启用 rekordbox
                xml。
              </li>
              <li>
                Preferences → Advanced → Database → rekordbox xml → Imported
                Library，选择刚下载的 XML。
              </li>
              <li>
                在树状导航刷新 rekordbox xml，展开 Playlists，将歌单拖到自己的
                Playlists。仅打开 XML 不等于导入完成。
              </li>
            </ol>
            <p>
              先核对文件路径与
              Cue。已存在曲目的覆盖行为、自动分析与设备支持因版本和设置不同，请在
              rekordbox 确认；本 App 不控制自动分析或覆盖。
            </p>
          </details>
        </div>
      </div>
      <details className="hobby-method">
        <summary>交换范围与限制</summary>
        <p>
          支持本机文件 URI、BPM、调性、整数星级、备注、来源 BeatGrid、Cue / Hot
          Cue / Loop 与歌单顺序。每曲最多 64 个标记、512 个拍点段；每套最多 200
          项，曲目可重复。未知调性保留原始值，但不参与调性推荐。
        </p>
        <p>
          能量、目标时长、练习、Set 特有的 Cue In/Out、重叠和转场备注只属于本
          App，仍可导出兴趣 JSON / 文本计划，不会自动覆盖曲目 Cue。无来源
          BeatGrid 时不生成虚构拍点；修改 BPM 不会拉伸原有 BeatGrid。未知 XML
          扩展、波形、智能歌单规则、流媒体和云端专属文件不保证互通；不是整个
          rekordbox 数据库的无损备份。
        </p>
        <a
          href="https://rekordbox.com/en/support/developer/?lang=en"
          target="_blank"
          rel="noreferrer noopener"
        >
          官方 XML 规范 ↗
        </a>{" "}
        ·{" "}
        <a
          href="https://cdn.rekordbox.com/files/20260409151936/rekordbox7.214_manual_EN.pdf"
          target="_blank"
          rel="noreferrer noopener"
        >
          rekordbox 7 官方手册 ↗
        </a>
      </details>
    </section>
  );
}
