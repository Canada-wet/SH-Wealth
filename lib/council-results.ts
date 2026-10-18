import type { CouncilRun } from "./council";
export function councilRound(run: CouncilRun, round: number) {
  const mode =
    !round || run.turns?.[round - 1]?.mode === "debate" ? "debate" : "direct";
  return {
    mode,
    firstStage:
      mode === "debate" ? ("opening" as const) : ("followup" as const),
    finalStage:
      mode === "debate" ? ("revision" as const) : ("followup" as const),
    question: round
      ? (run.turns?.[round - 1]?.question ?? "追问")
      : run.question,
    participants: round
      ? (run.turns?.[round - 1]?.participants ?? [])
      : run.participants,
    judge: round ? (run.turns?.[round - 1]?.judge ?? null) : run.judge,
    steps: run.steps.filter((s) => (s.round ?? 0) === round),
  };
}
export function councilExcerpt(text: string, limit = 220) {
  const plain = text
    .replace(/```[\s\S]*?```/g, "[代码片段]")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(^|\n)\s*#{1,6}\s+/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
  return plain.length > limit ? plain.slice(0, limit) + "…" : plain;
}
export function councilSections(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sections: { title: string; text: string }[] = [];
  let title = "简要答案",
    content: string[] = [];
  for (const line of lines) {
    const heading =
      /^#{1,4}\s+(.{1,70})$/.exec(line) ||
      /^\*\*([^*]{1,40})\*\*\s*[:：]?\s*$/.exec(line);
    if (heading) {
      if (content.join("\n").trim())
        sections.push({ title, text: content.join("\n").trim() });
      title = heading[1];
      content = [];
    } else content.push(line);
  }
  if (content.join("\n").trim())
    sections.push({ title, text: content.join("\n").trim() });
  return sections.slice(0, 12);
}
