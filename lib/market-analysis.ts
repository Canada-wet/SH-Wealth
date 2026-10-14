import { TREASURIES, type MarketReading } from "./market";

export function previousPeriod(date: string, months: number) {
  if (!/^\d{4}-\d{2}-01$/.test(date)) return null;
  const d = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(d.getTime()) || !Number.isInteger(months) || months < 1)
    return null;
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
export function readingChange(row: MarketReading) {
  if (row.value === null || !Number.isFinite(row.value) || !row.date)
    return null;
  const date = row.date;
  const observations = row.trend
    .filter((p) => Number.isFinite(p.value) && p.date < date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const previous =
    row.frequency === "daily"
      ? observations.at(-1)
      : observations.find(
          (p) =>
            p.date ===
            previousPeriod(row.date!, row.frequency === "quarterly" ? 3 : 1),
        );
  if (!previous) return null;
  const fx = row.unit.includes("CAD");
  if (fx && previous.value <= 0) return null;
  return {
    value: fx
      ? (row.value / previous.value - 1) * 100
      : row.value - previous.value,
    unit: fx ? "%" : row.unit === "%" ? "百分点" : row.unit,
    label:
      row.frequency === "daily"
        ? "较前一观测日"
        : row.frequency === "monthly"
          ? "较上月"
          : "较上季",
    date: previous.date,
  };
}
export function alignedSpread(
  rows: MarketReading[],
  longId: string,
  shortId: string,
) {
  const long = rows.find((r) => r.id === longId),
    short = rows.find((r) => r.id === shortId);
  return long?.value != null &&
    short?.value != null &&
    Number.isFinite(long.value) &&
    Number.isFinite(short.value) &&
    long.date &&
    long.date === short.date
    ? { value: (long.value - short.value) * 100, date: long.date }
    : null;
}
export function commonCurve(rows: MarketReading[], offset = 0) {
  if (rows.length !== 6 || offset < 0 || !Number.isInteger(offset)) return null;
  if (
    new Set(rows.map((row) => row.id)).size !== 6 ||
    TREASURIES.some(([id]) => !rows.some((row) => row.id === id))
  )
    return null;
  const ordered = TREASURIES.map(([id]) => rows.find((row) => row.id === id)!);
  const histories = ordered.map((row) => {
    const map = new Map(
      row.trend
        .filter((p) => Number.isFinite(p.value))
        .map((p) => [p.date, p.value]),
    );
    if (row.value !== null && Number.isFinite(row.value) && row.date)
      map.set(row.date, row.value);
    return map;
  });
  const dates = [...histories[0].keys()]
    .filter((date) => histories.every((history) => history.has(date)))
    .sort();
  const date = dates.at(-1 - offset);
  return date
    ? {
        date,
        points: ordered.map((row, i) => ({
          label: row.label,
          value: histories[i].get(date)!,
        })),
      }
    : null;
}
export function payrollAverage(row?: MarketReading) {
  if (!row || row.id !== "PAYEMS" || row.value === null || !row.date)
    return null;
  const values = [row.value];
  for (const months of [1, 2]) {
    const observation = row.trend.find(
      (p) => p.date === previousPeriod(row.date!, months),
    );
    if (!observation || !Number.isFinite(observation.value)) return null;
    values.push(observation.value);
  }
  return values.every(Number.isFinite)
    ? values.reduce((sum, value) => sum + value, 0) / 3
    : null;
}
export function alignedHistory(
  rows: MarketReading[],
  months: number,
): { date: string; values: number[] }[] {
  if (!rows.length || ![6, 12, 24].includes(months)) return [];
  const histories = rows.map(
    (row) =>
      new Map(
        row.trend
          .filter((p) => Number.isFinite(p.value))
          .map((p) => [p.date, p.value]),
      ),
  );
  return [...histories[0].keys()]
    .filter((date) => histories.every((history) => history.has(date)))
    .sort()
    .slice(-months)
    .map((date) => ({
      date,
      values: histories.map((history) => history.get(date)!),
    }));
}
export function formatPeriod(row: Pick<MarketReading, "date" | "frequency">) {
  if (!row.date) return "期间未知";
  return row.frequency === "quarterly"
    ? `${row.date.slice(0, 4)} Q${Math.floor((Number(row.date.slice(5, 7)) - 1) / 3) + 1}`
    : row.frequency === "monthly"
      ? row.date.slice(0, 7)
      : row.date;
}
export function signed(value: number, digits = 2) {
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("en-CA", { maximumFractionDigits: digits }).format(Object.is(value, -0) ? 0 : value)}`;
}
