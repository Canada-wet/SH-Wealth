"use client";
import { useEffect, useRef, useState } from "react";
import {
  Headphones,
  Music2,
  Heart,
  Disc3,
  Download,
  Upload,
  Eye,
  EyeOff,
  ArrowLeftRight,
} from "lucide-react";
import MarketNavigator from "@/app/components/MarketNavigator";
import TrackLibrary from "@/app/components/lifestyle/TrackLibrary";
import SetBuilder from "@/app/components/lifestyle/SetBuilder";
import PracticeJournal from "@/app/components/lifestyle/PracticeJournal";
import RekordboxBridge from "@/app/components/lifestyle/RekordboxBridge";
import Dialog from "@/app/components/Dialog";
import {
  downloadText,
  type SaveLifestyle,
} from "@/app/components/lifestyle/shared";
import useWealth from "@/lib/useWealth";
import {
  EMPTY_LIFESTYLE,
  changeLifestyle,
  lifestyleFingerprint,
} from "@/lib/dj";
import { readLifestyleBackup } from "@/lib/dj-import";
import type { Lifestyle } from "@/lib/lifestyle-schema";
import "./lifestyle.css";

type View = "library" | "sets" | "practice" | "rekordbox";
export default function LifestylePage() {
  const store = useWealth(),
    life = store.state.preferences.lifestyle ?? EMPTY_LIFESTYLE;
  const [view, setView] = useState<View>("library"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [privacy, setPrivacy] = useState(false),
    [preferredSet, setPreferredSet] = useState("");
  const [restore, setRestore] = useState<{
      life: Lifestyle;
      expected: string;
    } | null>(null),
    [reading, setReading] = useState(false),
    [restoringError, setRestoringError] = useState("");
  const backupInput = useRef<HTMLInputElement>(null);
  const editable = store.ready && !store.cloudLoading && !store.cloudChoice;
  useEffect(() => {
    setPrivacy(sessionStorage.getItem("together-privacy") === "on");
    const update = () => {
      const hash = location.hash.slice(1);
      if (["library", "sets", "practice", "rekordbox"].includes(hash))
        setView(hash as View);
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const navigate = (v: View) => {
    setView(v);
    history.replaceState(null, "", `#${v}`);
    setError("");
  };
  const save: SaveLifestyle = (update, reason, expected) => {
    if (!editable) {
      setError("仍在载入或有版本冲突，请先处理同步。");
      return false;
    }
    try {
      store.commit(
        (s) =>
          changeLifestyle(s, expected ?? lifestyleFingerprint(life), update),
        reason,
        false,
      );
      setError("");
      setNotice("已保存到本机；云端状态见上方。兴趣操作不改变财富余额。");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "尚未保存。");
      return false;
    }
  };
  return (
    <main className="market-shell hobby-shell">
      <MarketNavigator active="lifestyle" />
      <div className="markets-page hobby-page">
        <header className="markets-header hobby-page-header">
          <div>
            <p className="eyebrow">TOGETHER · OFF THE CLOCK</p>
            <h1>
              <Headphones size={28} /> 兴趣与生活
            </h1>
            <p>
              财富让生活有余地，兴趣让余地有意思。先从一套属于你们的 DJ Set
              开始。
            </p>
          </div>
          <div className="hobby-header-tools">
            <span className="hobby-cloud-status" role="status">
              {store.cloudStatus}
            </span>
            <button
              className="icon-button"
              aria-label={privacy ? "显示兴趣空间" : "隐藏兴趣空间"}
              onClick={() => {
                setPrivacy(!privacy);
                try {
                  sessionStorage.setItem(
                    "together-privacy",
                    privacy ? "off" : "on",
                  );
                } catch {}
              }}
            >
              {privacy ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
        </header>
        {(error || store.error) && (
          <p role="alert" className="form-error">
            {error || store.error}
          </p>
        )}
        {store.cloudChoice && (
          <div className="hobby-notice">
            本机与云端都有不同内容，编辑已暂停。
            <a href="/">返回家庭首页选择要保留的版本 →</a>
          </div>
        )}
        {store.ready &&
          !store.cloudLoading &&
          store.cloudStatus.includes("失败") && (
            <div className="hobby-notice">
              本机记录保留，但未确认云端保存。
              <button
                className="secondary"
                onClick={() =>
                  void store
                    .connectCloud(store.cloudHousehold, "auto")
                    .catch((e) => setError(e.message))
                }
              >
                重新连接同步
              </button>
            </div>
          )}
        {!store.ready || store.cloudLoading ? (
          <div className="card hobby-empty" role="status">
            正在读取你们的兴趣空间…
          </div>
        ) : privacy ? (
          <div className="card hobby-empty">
            <EyeOff size={30} />
            <h2>兴趣空间已隐藏</h2>
            <p>点击右上角眼睛恢复；隐藏不是退出登录。</p>
          </div>
        ) : (
          <>
            <section className="hobby-hero" aria-label="兴趣空间概览">
              <div>
                <span className="hobby-kicker">
                  ONE DEEP HOBBY + ONE SMALL RITUAL
                </span>
                <h2>
                  把今晚的氛围，
                  <br />
                  <em>慢慢混成你喜欢的样子。</em>
                </h2>
                <p>
                  整理曲目 → 试听 Cue → 编排一套氛围。
                  <br />
                  不需要把快乐也做成待办清单。
                </p>
                <div className="hobby-hero-actions">
                  <button
                    className="primary"
                    onClick={() =>
                      navigate(life.tracks.length ? "sets" : "library")
                    }
                  >
                    {life.tracks.length ? "去编排一套 Set" : "从我的曲库开始"}{" "}
                    <Music2 size={15} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => navigate("practice")}
                  >
                    留下一次好玩的练习 ↗
                  </button>
                </div>
              </div>
              <div className="hobby-vinyl" aria-hidden="true">
                <div className="hobby-record">
                  <i />
                  <b>
                    TOGETHER
                    <br />
                    <span>SIDE A · YOUR TIME</span>
                  </b>
                </div>
                <span className="hobby-vinyl-caption">
                  NO RUSH. FIND YOUR GROOVE.
                </span>
              </div>
              <div className="hobby-hero-stats">
                <span>
                  <b>{life.tracks.length}</b> 首自己的曲目
                </span>
                <span>
                  <b>{life.sets.length}</b> 套氛围计划
                </span>
                <span>
                  <b>{life.practices.length}</b> 次兴趣记忆
                </span>
              </div>
            </section>
            <div className="hobby-navigation">
              <div role="tablist" aria-label="兴趣空间视图">
                {(
                  [
                    ["library", "曲库", Music2],
                    ["sets", "Set Builder", Disc3],
                    ["practice", "练习与快乐", Heart],
                    ["rekordbox", "rekordbox", ArrowLeftRight],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    role="tab"
                    key={key}
                    aria-selected={view === key}
                    aria-controls={`hobby-${key}`}
                    id={`hobby-tab-${key}`}
                    onClick={() => navigate(key)}
                  >
                    <Icon size={17} />
                    {label}
                  </button>
                ))}
              </div>
              <details className="hobby-backup">
                <summary>备份与数据</summary>
                <div>
                  <p>
                    与当前家庭共用同步和访问权限。单独备份只包含兴趣元数据，不包含财富或聊天；两位成员均可管理。
                  </p>
                  <button
                    className="text-button"
                    disabled={!editable}
                    onClick={() =>
                      downloadText(
                        "Together-lifestyle-backup.json",
                        JSON.stringify(life, null, 2),
                      )
                    }
                  >
                    <Download size={14} />
                    导出兴趣备份
                  </button>
                  <button
                    className="text-button"
                    disabled={!editable || reading}
                    onClick={() => backupInput.current?.click()}
                  >
                    <Upload size={14} />
                    {reading ? "正在检查…" : "恢复兴趣备份"}
                  </button>
                  <input
                    type="file"
                    hidden
                    aria-label="选择兴趣备份"
                    accept=".json,application/json"
                    ref={backupInput}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      setError("");
                      if (f.size > 3 * 1024 * 1024) {
                        setError("备份不能超过 3MB。");
                        return;
                      }
                      const expected = lifestyleFingerprint(life);
                      setReading(true);
                      try {
                        setRestore({
                          life: readLifestyleBackup(await f.text()),
                          expected,
                        });
                        setRestoringError("");
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : "备份读取失败。",
                        );
                      } finally {
                        setReading(false);
                      }
                    }}
                  />
                  <p>
                    首次版容量：1,000 首曲目 / 60 套 Set / 300
                    则练习。曲目、评分、备注和练习在两位家庭成员之间共享，不是个人私密收藏。
                    音频与专业 DJ 软件工程不存入家庭文档。
                  </p>
                </div>
              </details>
            </div>
            {notice && (
              <p className="hobby-save-note" role="status">
                {notice}
              </p>
            )}
            <div
              role="tabpanel"
              id={`hobby-${view}`}
              aria-labelledby={`hobby-tab-${view}`}
            >
              {view === "library" && (
                <TrackLibrary
                  life={life}
                  save={save}
                  disabled={!editable}
                  onBuild={() => navigate("sets")}
                />
              )}
              {view === "sets" && (
                <SetBuilder
                  life={life}
                  save={save}
                  disabled={!editable}
                  members={store.state.members}
                  onPractice={(id) => {
                    setPreferredSet(id);
                    navigate("practice");
                  }}
                />
              )}
              {view === "practice" && (
                <PracticeJournal
                  life={life}
                  save={save}
                  disabled={!editable}
                  members={store.state.members}
                  preferredSet={preferredSet}
                />
              )}
              {view === "rekordbox" && (
                <RekordboxBridge
                  life={life}
                  save={save}
                  disabled={!editable}
                  household={store.cloudHousehold}
                />
              )}
            </div>
            <footer className="hobby-footer">
              <Headphones size={18} />
              <p>
                这里只管理合法元数据与手动计划，不提供音乐下载、Spotify
                曲库抓取、音频分析或播放器控制。评分是可调整的启发式工具；最终过渡要用耳朵判断。
              </p>
              <a href="/#quarterly-review">回到共同生活与财富计划 ↗</a>
            </footer>
          </>
        )}
        {restore && (
          <Dialog
            title="恢复兴趣空间备份"
            error={restoringError}
            onClose={() => setRestore(null)}
            onSubmit={(e) => {
              e.preventDefault();
              if (
                save(() => restore.life, "恢复兴趣空间备份", restore.expected)
              ) {
                setRestore(null);
                navigate("library");
                setPreferredSet("");
              } else
                setRestoringError(
                  "恢复未完成，请查看页面提示。不会覆盖有冲突的更新。",
                );
            }}
          >
            <p>
              将用此文件替换当前兴趣空间：{restore.life.tracks.length} 首曲目、
              {restore.life.sets.length} 套 Set、{restore.life.practices.length}{" "}
              则练习。此操作也会同步给伴侣。
            </p>
            <p>不会替换财富、季度复盘或聊天。建议先导出当前兴趣备份。</p>
            <div className="dialog-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => setRestore(null)}
              >
                取消
              </button>
              <button className="primary" type="submit" disabled={!editable}>
                确认替换兴趣空间
              </button>
            </div>
          </Dialog>
        )}
      </div>
    </main>
  );
}
