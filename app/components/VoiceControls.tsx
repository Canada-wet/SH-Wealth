"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Volume2 } from "lucide-react";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export default function VoiceControls({
  input,
  onTranscript,
  reply,
  disabled,
  active,
  onListeningChange,
}: {
  input: string;
  onTranscript: (text: string) => void;
  reply: string;
  disabled: boolean;
  active: boolean;
  onListeningChange?: (listening: boolean) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [language, setLanguage] = useState("zh-CN");
  const [consent, setConsent] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    onListeningChange?.(listening);
  }, [listening, onListeningChange]);
  useEffect(() => {
    alive.current = true;
    const browser = window as VoiceWindow;
    setSupported(
      Boolean(browser.SpeechRecognition || browser.webkitSpeechRecognition),
    );
    try {
      setLanguage(localStorage.getItem("together-voice-language") || "zh-CN");
    } catch {}
    return () => {
      alive.current = false;
      recognition.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);
  useEffect(() => {
    if (!active || disabled) {
      recognition.current?.abort();
      window.speechSynthesis?.cancel();
      setListening(false);
      setSpeaking(false);
      setInterim("");
    }
  }, [active, disabled]);
  const start = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    if (!consent) {
      setError("请先同意语音识别说明，再开启麦克风。");
      return;
    }
    const browser = window as VoiceWindow;
    const Constructor =
      browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Constructor) return;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setError("");
    const session = new Constructor();
    recognition.current = session;
    session.lang = language;
    session.continuous = false;
    session.interimResults = true;
    session.onresult = (event) => {
      if (!alive.current || recognition.current !== session) return;
      const results = Array.from(event.results);
      const final = results
        .filter((row) => row.isFinal)
        .map((row) => row[0].transcript)
        .join("");
      setInterim(
        results
          .filter((row) => !row.isFinal)
          .map((row) => row[0].transcript)
          .join(""),
      );
      if (final)
        onTranscript(`${input}${input ? "\n" : ""}${final}`.slice(0, 6000));
    };
    session.onerror = (event) => {
      if (!alive.current || recognition.current !== session) return;
      setListening(false);
      setError(
        event.error === "not-allowed"
          ? "麦克风权限被拒绝，请在浏览器设置中允许。"
          : event.error === "aborted"
            ? ""
            : "未能识别语音，请重试或输入文字。",
      );
    };
    session.onend = () => {
      if (alive.current && recognition.current === session) {
        setListening(false);
        setInterim("");
      }
    };
    try {
      setListening(true);
      session.start();
    } catch {
      setListening(false);
      setError("无法启动麦克风，请重试。");
    }
  };
  const speak = () => {
    if (
      !window.speechSynthesis ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      setError("当前浏览器不支持朗读。");
      return;
    }
    window.speechSynthesis.cancel();
    if (speaking) {
      setSpeaking(false);
      return;
    }
    const text = reply
      .replace(/\n\n(?:openai|deepseek|anthropic|本地助手)[\s\S]*$/, "")
      .replace(/[*#`>|]/g, "")
      .slice(0, 3000);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.onend = utterance.onerror = () => {
      if (alive.current) setSpeaking(false);
    };
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };
  return (
    <details className="voice-controls">
      <summary>
        <Mic size={14} /> 语音对话 <span>先核对文字，再发送</span>
      </summary>
      <div className="voice-toolbar">
        <select
          aria-label="语音识别语言"
          value={language}
          disabled={listening}
          onChange={(event) => {
            setLanguage(event.target.value);
            try {
              localStorage.setItem(
                "together-voice-language",
                event.target.value,
              );
            } catch {}
          }}
        >
          <option value="zh-CN">普通话</option>
          <option value="en-CA">English</option>
          <option value="zh-HK">粤语（依浏览器支持）</option>
        </select>
        <button
          type="button"
          disabled={!supported || disabled}
          aria-label={listening ? "停止语音输入" : "开始语音输入"}
          onClick={start}
        >
          {listening ? <Square size={15} /> : <Mic size={15} />}{" "}
          {listening ? "停止" : "说话"}
        </button>
        <button
          type="button"
          disabled={!reply || listening}
          aria-label={speaking ? "停止朗读" : "朗读最新回复"}
          onClick={speak}
        >
          <Volume2 size={15} /> {speaking ? "停止朗读" : "朗读回复"}
        </button>
      </div>
      {supported ? (
        <label className="voice-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            disabled={listening}
          />
          我同意使用浏览器语音服务；音频可能由浏览器服务商处理。App
          不保存录音，识别文字会进入聊天。
        </label>
      ) : (
        <p>
          当前浏览器不支持语音识别。可使用 Chrome / Safari
          的支持版本，或系统键盘听写。
        </p>
      )}
      <p role="status">
        {listening
          ? interim || "正在聆听…请清楚说出账户名、金额与成员。"
          : "语音不会自动发送，也不会自动修改财务数据。"}
      </p>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
