export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const MAX_SPOKEN_CHARS = 1200;
export const AUDIO_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
};
export function spokenText(text: string) {
  return text
    .replace(/\n\n(?:openai|deepseek|anthropic|本地助手)[\s\S]*$/, "")
    .replace(/\n\n### 联网查证[\s\S]*$/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*#`>|]/g, "")
    .trim()
    .slice(0, MAX_SPOKEN_CHARS);
}
// Allow thinking pauses instead of submitting between every few words.
export class VoiceActivity {
  private lastVoice = 0;
  private voicedMs = 0;
  private previous: number;
  constructor(private startedAt: number) {
    this.previous = startedAt;
  }
  sample(rms: number, now: number): "listen" | "submit" | "idle" {
    const elapsed = Math.min(100, Math.max(0, now - this.previous));
    this.previous = now;
    if (rms >= 0.018) {
      this.voicedMs += elapsed;
      this.lastVoice = now;
    }
    if (
      this.voicedMs >= 240 &&
      (now - this.lastVoice >= 1200 || now - this.startedAt >= 30000)
    )
      return "submit";
    if (now - this.startedAt >= 30000) return "idle";
    return "listen";
  }
}
export type VoiceReply = { reply: string; pending: boolean };
export function readSpokenAnswer(raw: string, answer: string): string {
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    if (
      typeof parsed.spokenAnswer === "string" &&
      parsed.spokenAnswer.trim() &&
      parsed.spokenAnswer.length <= 450
    )
      return parsed.spokenAnswer.trim();
  } catch {}
  const first = answer.split(/\n\s*\n/)[0];
  return first.length <= 450
    ? first
    : `${first.slice(0, 400)}。完整说明请查看聊天。`;
}
