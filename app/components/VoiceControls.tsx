"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import {
  MAX_AUDIO_BYTES,
  spokenText,
  VoiceActivity,
  type VoiceReply,
} from "@/lib/voice";
type Phase =
  | "off"
  | "connecting"
  | "listening"
  | "recognizing"
  | "thinking"
  | "preparing"
  | "speaking"
  | "paused";
type Session = {
  abort: AbortController;
  stream?: MediaStream;
  context?: AudioContext;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>;
  expiry?: ReturnType<typeof setTimeout>;
  source?: AudioBufferSourceNode;
  finishPlayback?: () => void;
  turns: number;
};
export default function VoiceControls({
  onTurn,
  onListeningChange,
  disabled,
  active,
  pending,
}: {
  onTurn: (
    text: string,
    signal: AbortSignal,
  ) => Promise<VoiceReply | undefined>;
  onListeningChange?: (active: boolean) => void;
  disabled: boolean;
  active: boolean;
  pending: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>("off");
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  const session = useRef<Session | null>(null);
  const props = useRef({ onTurn, onListeningChange, pending });
  props.current = { onTurn, onListeningChange, pending };
  const live = (s: Session) => session.current === s && !s.abort.signal.aborted;
  const end = (message = "") => {
    const s = session.current;
    session.current = null;
    s?.abort.abort();
    if (s?.timer) clearInterval(s.timer);
    if (s?.expiry) clearTimeout(s.expiry);
    if (s?.recorder?.state === "recording") s.recorder.stop();
    s?.stream?.getTracks().forEach((track) => track.stop());
    s?.source?.stop();
    s?.finishPlayback?.();
    void s?.context?.close();
    props.current.onListeningChange?.(false);
    setPhase("off");
    setError(message);
  };
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => {
    setSupported(
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof window.MediaRecorder === "function" &&
        (typeof window.AudioContext === "function" ||
          typeof (window as unknown as { webkitAudioContext?: unknown })
            .webkitAudioContext === "function"),
    );
    const hidden = () => {
      if (document.hidden) endRef.current();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      endRef.current();
    };
  }, []);
  useEffect(() => {
    if (!active || disabled) endRef.current();
  }, [active, disabled]);
  useEffect(() => {
    if (!pending && phase === "paused" && session.current) {
      try {
        listen(session.current);
      } catch {
        endRef.current("麦克风无法恢复，请重新开始对话。");
      }
    }
  }, [pending, phase]);
  const speak = async (s: Session, text: string) => {
    const input = spokenText(text);
    if (!input || !s.context) return;
    setPhase("preparing");
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input }),
      signal: AbortSignal.any([s.abort.signal, AbortSignal.timeout(40000)]),
    });
    if (!response.ok)
      throw new Error(
        (await response.json()).error ||
          "语音回复暂不可用。文字已保存，可在聊天中查看。",
      );
    const audio = await response.arrayBuffer();
    if (!live(s)) return;
    const buffer = await s.context.decodeAudioData(audio);
    if (!live(s)) return;
    if (s.context.state === "suspended")
      throw new Error("浏览器暂停了声音播放。请重新开始对话；回复文字已保存。");
    await new Promise<void>((resolve) => {
      const source = s.context!.createBufferSource();
      s.source = source;
      source.buffer = buffer;
      source.connect(s.context!.destination);
      s.finishPlayback = resolve;
      source.onended = () => {
        source.disconnect();
        s.source = undefined;
        s.finishPlayback = undefined;
        resolve();
      };
      setPhase("speaking");
      source.start();
    });
  };
  const process = async (s: Session, blob: Blob) => {
    try {
      setPhase("recognizing");
      if (blob.size > MAX_AUDIO_BYTES)
        throw new Error("这一句话太长，请缩短后重试。");
      const form = new FormData();
      form.set(
        "audio",
        blob,
        blob.type.startsWith("audio/mp4") ? "utterance.mp4" : "utterance.webm",
      );
      const response = await fetch("/api/voice", {
        method: "POST",
        body: form,
        signal: AbortSignal.any([s.abort.signal, AbortSignal.timeout(40000)]),
      });
      const result = await response.json();
      if (!live(s)) return;
      if (!response.ok)
        throw new Error(result.error || "未能听清，请重新开始。");
      if (typeof result.text !== "string" || !result.text.trim())
        throw new Error("没有听清这一句，请再说一次。");
      setCaption(result.text);
      setPhase("thinking");
      const answer = await props.current.onTurn(result.text, s.abort.signal);
      if (!live(s)) return;
      if (!answer) {
        end("这一句未完成。问题保留在聊天或草稿中，可用文字重试。");
        return;
      }
      await speak(s, answer.reply);
      if (!live(s)) return;
      s.turns++;
      if (s.turns >= 10) {
        end("这轮语音对话已结束，点击开始可以继续。聊天已保留。");
        return;
      }
      if (answer.pending || props.current.pending) setPhase("paused");
      else listen(s);
    } catch (reason) {
      if (live(s))
        end(
          reason instanceof Error
            ? reason.message
            : "语音服务暂不可用，请使用文字。",
        );
    }
  };
  const listen = (s: Session) => {
    if (!live(s) || !s.stream || !s.context) return;
    if (props.current.pending) {
      setPhase("paused");
      return;
    }
    s.stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    const recorder = new MediaRecorder(s.stream, {
      ...(mime ? { mimeType: mime } : {}),
      audioBitsPerSecond: 32000,
    });
    s.recorder = recorder;
    const chunks: Blob[] = [];
    const analyser = s.context.createAnalyser();
    analyser.fftSize = 2048;
    const input = s.context.createMediaStreamSource(s.stream);
    input.connect(analyser);
    const values = new Float32Array(analyser.fftSize);
    const detector = new VoiceActivity(Date.now());
    let submit = false;
    recorder.ondataavailable = (event) => {
      if (live(s) && event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => {
      if (live(s)) end("录音中断，请重新开始或使用文字。");
    };
    recorder.onstop = () => {
      input.disconnect();
      analyser.disconnect();
      if (s.timer) clearInterval(s.timer);
      s.stream?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      if (!live(s)) return;
      if (submit)
        void process(s, new Blob(chunks, { type: recorder.mimeType }));
      else end("暂时没有听到说话，麦克风已关闭。想继续时点开始即可。");
    };
    recorder.start();
    setPhase("listening");
    s.timer = setInterval(() => {
      if (!live(s) || recorder.state !== "recording") return;
      analyser.getFloatTimeDomainData(values);
      const rms = Math.sqrt(
        values.reduce((sum, value) => sum + value * value, 0) / values.length,
      );
      const decision = detector.sample(rms, Date.now());
      if (decision !== "listen") {
        submit = decision === "submit";
        recorder.stop();
      }
    }, 60);
  };
  const start = async () => {
    if (session.current) {
      end();
      return;
    }
    setError("");
    setCaption("");
    setPhase("connecting");
    const s: Session = { abort: new AbortController(), turns: 0 };
    session.current = s;
    props.current.onListeningChange?.(true);
    try {
      // Unlock playback within the user gesture, including mobile browsers.
      const Constructor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      s.context = new Constructor();
      await s.context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!live(s)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      s.stream = stream;
      s.expiry = setTimeout(() => {
        if (live(s))
          end("语音已满 5 分钟，麦克风已关闭。聊天已保存，可继续新一轮。");
      }, 300000);
      listen(s);
    } catch (reason) {
      if (live(s))
        end(
          reason instanceof DOMException && reason.name === "NotAllowedError"
            ? "麦克风权限被拒绝，请在浏览器设置中允许。"
            : "无法开启麦克风，请使用 HTTPS、检查设备，或改用文字。",
        );
    }
  };
  const labels: Record<Phase, string> = {
    off: "直接说，无需选择语种或手动发送",
    connecting: "正在开启麦克风…",
    listening: "我在听 · 说完停顿一下就好",
    recognizing: "正在听懂这一句…",
    thinking: "顾问正在查看家庭数据…",
    preparing: "正在准备自然语音…",
    speaking: "顾问正在回答 · 可点击打断",
    paused: "请核对上方修改预览，确认或取消后继续听",
  };
  return (
    <section className="voice-controls natural-voice" aria-label="自然语音对话">
      <div className="voice-toolbar">
        <button
          type="button"
          className={phase !== "off" ? "voice-live" : ""}
          aria-label={phase === "off" ? "开始语音对话" : "结束语音对话"}
          disabled={!supported || disabled || (pending && phase === "off")}
          onClick={() => void start()}
        >
          {phase === "off" ? <Mic size={16} /> : <Square size={15} />}
          {phase === "off" ? "开始对话" : "结束对话"}
        </button>
        <span role="status" className={`voice-phase voice-${phase}`}>
          {labels[phase]}
        </span>
        {phase === "speaking" && (
          <button
            type="button"
            aria-label="打断语音回复"
            onClick={() => {
              const s = session.current;
              if (s?.source) s.source.stop();
            }}
          >
            <Volume2 size={14} />
            打断
          </button>
        )}
      </div>
      {caption && phase !== "off" && (
        <div className="voice-caption" aria-label="本句字幕">
          {caption}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!supported && (
        <p>
          当前浏览器不支持录音。请使用支持版本的 Chrome / Safari，或文字输入。
        </p>
      )}
      <details className="voice-info">
        <summary>自动识别语种 · OpenAI 处理语音 · AI 声音 · 另计费</summary>
        <small className="voice-privacy">
          点击开始即同意 OpenAI 处理语音；App 不保存录音，只保存聊天文字。
          语音识别与合成另计费，分析沿用所选模型。回复时暂停收音，修改需核对确认。
          静默 30 秒、满 5 分钟或切走页面会关闭麦克风。
        </small>
      </details>
    </section>
  );
}
