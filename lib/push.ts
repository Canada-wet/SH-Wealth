import webpush from "web-push";
export function pushReady() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT,
  );
}
export async function sendPush(
  subscription: webpush.PushSubscription,
  payload: { title: string; body: string; url?: string; tag?: string },
) {
  if (!pushReady()) throw new Error("Web Push 未配置。");
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  return webpush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: 86400,
    timeout: 10000,
  });
}
