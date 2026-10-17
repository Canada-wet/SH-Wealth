"use client";
import { useState } from "react";
import { ArrowLeftRight, Download } from "lucide-react";
import { exportRekordbox } from "@/lib/rekordbox";
import type { Lifestyle } from "@/lib/lifestyle-schema";
import { downloadText, type SaveLifestyle } from "./shared";
import RekordboxImport from "./RekordboxImport";
export default function RekordboxBridge({
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
  const [exportScope, setExportScope] = useState("all"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]);
  const compatible = life.tracks.filter((t) => t.fileLocation).length;
  return (
    <section className="card hobby-rekordbox" aria-label="rekordbox 交换中心">
      <div className="hobby-section-head">
        <div>
          <span className="hobby-kicker">LESS INPUT · MORE MUSIC</span>
          <h2>
            <ArrowLeftRight size={21} /> 与 rekordbox 来回编排
          </h2>
          <p>把曲库带进来，编好 Set，再带回去播放。</p>
        </div>
        <span className="hobby-chip">
          {compatible} / {life.tracks.length} 首已关联路径
        </span>
      </div>
      <div className="hobby-bridge-grid">
        <RekordboxImport
          life={life}
          save={save}
          disabled={disabled}
          household={household}
        />
        <div>
          <h3>把编排带回 rekordbox</h3>
          <p>
            每套 Set 成为保持曲序的歌单，曲目 Cue、Hot Cue A–H、Loop 与来源
            BeatGrid 一起带走。
          </p>
          <label>
            导出范围
            <select
              aria-label="rekordbox 导出范围"
              value={exportScope}
              onChange={(e) => {
                setExportScope(e.target.value);
                setNotice("");
                setWarnings([]);
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
              setWarnings([]);
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
                  `已导出 ${result.tracks} 首、${result.sets} 套 Set。`,
                );
                setWarnings(result.warnings);
              } catch (e) {
                setError(e instanceof Error ? e.message : "未生成 XML。");
              }
            }}
          >
            <Download size={16} /> 导出 rekordbox XML
          </button>
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
          {!!warnings.length && (
            <details>
              <summary>本次导出说明（{warnings.length}）</summary>
              <ul>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <p className="hobby-caption">
            导出的 XML 不含音频，网页不能检查文件存在。来源 XML
            会自动带入路径；手动录入的曲目需在编辑中补充真实音乐路径。
          </p>
          <details>
            <summary>在 rekordbox 导入：首次设置与操作</summary>
            <ol>
              <li>先备份 rekordbox 曲库，用单独测试歌单核对路径和 Cue。</li>
              <li>
                Preferences → View → Layout → Media Browser，启用 rekordbox
                xml。
              </li>
              <li>
                Preferences → Advanced → Database → rekordbox xml → Imported
                Library，选择刚下载的 XML。
              </li>
              <li>
                刷新 rekordbox xml，展开 Playlists，将歌单拖到自己的
                Playlists。仅打开 XML 不等于导入完成。
              </li>
            </ol>
            <p>
              音乐仍需在电脑相同路径。已存在曲目的覆盖、自动分析和设备支持因版本及设置不同，请在
              rekordbox 确认。
            </p>
          </details>
        </div>
      </div>
      <details className="hobby-method">
        <summary>隐私与交换范围</summary>
        <p>
          仅读取 XML 元数据，不上传音频、不读取音乐文件或 rekordbox
          数据库。路径、备注与拍点在家庭空间共享；浏览器文件授权仅留本机、绑定当前账号和家庭，不进入云端或备份。
        </p>
        <p>
          每曲最多 64 Cue、512 BeatGrid 段；曲库 1000 首、60 套 Set、每套 200
          项。个别不支持记录先列明再跳过，不会静默截断。文件交换不是完整数据库备份或实时同步。
        </p>
        <p>
          Set 的重叠 / 转场 / 片段、能量与练习留在本 App。无来源 BeatGrid
          不伪造拍点；修改 BPM 不拉伸原
          BeatGrid。未知扩展、流媒体、波形和智能歌单规则不保证互通。
        </p>
        <a
          href="https://rekordbox.com/en/support/developer/?lang=en"
          target="_blank"
          rel="noreferrer noopener"
        >
          官方 XML 规范 ↗
        </a>
      </details>
    </section>
  );
}
