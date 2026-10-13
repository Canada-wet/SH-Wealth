import { after, NextResponse } from "next/server";
import { safeEqual } from "@/lib/channels";
import { processChannelEvent, telegramEvent } from "@/lib/channel-webhooks";
export const maxDuration = 60;
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (
    !secret ||
    !safeEqual(
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "",
      secret,
    )
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const raw = await request.text();
  if (raw.length > 100000)
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  try {
    const event = telegramEvent(JSON.parse(raw));
    const job = event ? await processChannelEvent(event) : undefined;
    if (job)
      after(async () => {
        try {
          await job();
        } catch {
          console.error(
            "Telegram event processing failed; no secrets or message contents logged.",
          );
        }
      });
    return NextResponse.json({ ok: true });
  } catch (reason) {
    if (!(reason instanceof SyntaxError))
      return NextResponse.json(
        { error: "Event processing unavailable" },
        { status: 503 },
      );
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
}
