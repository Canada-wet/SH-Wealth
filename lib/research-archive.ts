export type ResearchArchive = {
  id: string;
  source: "funda";
  source_url: string;
  captured_at: string;
  prompt: string;
  response: string;
  citations: { title: string; url: string }[];
  status: "complete" | "partial";
  verification: "ai-unverified";
};
export function safeResearchUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function validResearchArchive(raw: unknown): raw is ResearchArchive {
  if (!raw || typeof raw !== "object") return false;
  const row = raw as ResearchArchive;
  return (
    typeof row.id === "string" &&
    row.source === "funda" &&
    /^https:\/\/funda\.ai\/agent-chat\?c=[A-Za-z0-9_-]+$/.test(
      row.source_url,
    ) &&
    typeof row.captured_at === "string" &&
    Number.isFinite(Date.parse(row.captured_at)) &&
    typeof row.prompt === "string" &&
    row.prompt.length > 0 &&
    row.prompt.length <= 5000 &&
    typeof row.response === "string" &&
    row.response.length > 0 &&
    row.response.length <= 50000 &&
    (row.status === "complete" || row.status === "partial") &&
    row.verification === "ai-unverified" &&
    Array.isArray(row.citations) &&
    row.citations.length <= 40 &&
    row.citations.every(
      (c) =>
        !!c &&
        typeof c.title === "string" &&
        c.title.length <= 500 &&
        safeResearchUrl(c.url),
    )
  );
}
// Funda's visible Copy message uses custom citation tags. Keep raw DB text intact.
export function researchDisplayText(raw: string) {
  return raw.replace(
    /<reference\s+url="([^"]+)">([\s\S]*?)<\/reference>/g,
    (_all, url: string, title: string) => {
      const label = title.replace(/[\[\]<>\\]/g, "");
      return safeResearchUrl(url) ? ` [${label}](<${url}>)` : ` ${label}`;
    },
  );
}
