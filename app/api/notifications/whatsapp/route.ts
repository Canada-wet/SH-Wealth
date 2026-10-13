import { after, NextResponse } from "next/server";
import { safeEqual, validWhatsAppSignature } from "@/lib/channels";
import { processChannelEvent, whatsappEvents } from "@/lib/channel-webhooks";
export const maxDuration = 60;
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams,
    token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (
    query.get("hub.mode") !== "subscribe" ||
    !token ||
    !safeEqual(query.get("hub.verify_token") || "", token)
  )
    return new Response("Unauthorized", { status: 401 });
  return new Response(query.get("hub.challenge") || "", {
    headers: { "Content-Type": "text/plain" },
  });
}
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 100000)
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  if (!validWhatsAppSignature(raw, request.headers.get("X-Hub-Signature-256")))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const events = whatsappEvents(JSON.parse(raw));
    for (const event of events) {
      const job = await processChannelEvent(event);
      if (job)
        after(async () => {
          try {
            await job();
          } catch {
            console.error(
              "WhatsApp event processing failed; no secrets or message contents logged.",
            );
          }
        });
    }
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
