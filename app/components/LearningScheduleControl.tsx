"use client";
import { useState } from "react";
import { PauseCircle, PlayCircle } from "lucide-react";
import type { WealthState } from "@/lib/wealth";
import {
  changeLearningSchedule,
  DEFAULT_LEARNING_SCHEDULE,
  learningDisplayDay,
} from "@/lib/learning-schedule";

export default function LearningScheduleControl({
  state,
  ready,
  syncStatus,
  error,
  onChange,
  onChanged,
}: {
  state: WealthState;
  ready: boolean;
  syncStatus: string;
  error?: string;
  onChange: (
    fn: (state: WealthState) => WealthState,
    reason: string,
  ) => unknown;
  onChanged?: () => void;
}) {
  const p = state.preferences.learningSchedule ?? DEFAULT_LEARNING_SCHEDULE;
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const synced = syncStatus === "已同步 Supabase";
  return (
    <section
      className="card learning-schedule"
      id="learning-schedule"
      aria-label="每日卡片自动更新设置"
    >
      <div className="learning-schedule-heading">
        <div>
          <p className="eyebrow">家庭共用 · DAILY CARDS</p>
          <h2>{p.enabled ? "每日卡片自动更新中" : "每日卡片自动更新已暂停"}</h2>
        </div>
        <button
          type="button"
          className={p.enabled ? "secondary" : "primary"}
          disabled={!ready || !synced || !!error}
          onClick={() => {
            setNotice("");
            setFailure("");
            try {
              const expected = JSON.stringify(
                state.preferences.learningSchedule,
              );
              onChange(
                (s) => changeLearningSchedule(s, !p.enabled, expected),
                p.enabled ? "暂停每日学习卡片" : "重新开启每日学习卡片",
              );
              setNotice(
                "设置已保存于本机；云端同步确认后，定时任务才会采用新设置。",
              );
              onChanged?.();
            } catch (e) {
              setFailure(
                e instanceof Error ? e.message : "设置未保存，请重试。",
              );
            }
          }}
        >
          {p.enabled ? <PauseCircle size={17} /> : <PlayCircle size={17} />}{" "}
          {p.enabled ? "暂停每日更新" : "重新开启每日更新"}
        </button>
      </div>
      <p>
        {p.enabled
          ? "按多伦多日期轮换投资、工作与生活心理学卡片。"
          : `当前保留 ${learningDisplayDay(p)} 的卡片，不再自动换到次日内容，也暂停这组卡片的每日提醒。`}
      </p>
      <p>
        两位家庭成员共用此开关；已有卡片、收藏和历史不删除，仍可手动回看。重新开启后从当日继续，不补发暂停期间的通知。
      </p>
      <small>
        通知仍需本人单独订阅及启用渠道；此开关不会替你订阅。市场日报、行情、Funda研究和其他周报不受影响。
      </small>
      <p className="muted" role="status">
        同步状态：{syncStatus}
        {notice ? `。${synced ? "当前设置已同步云端。" : notice}` : ""}
      </p>
      {(failure || error) && (
        <p className="form-error" role="alert">
          {failure || error}{" "}
          请到财富工作台「数据与同步」核对，不会显示为云端保存成功。
        </p>
      )}
    </section>
  );
}
