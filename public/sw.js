function safePath(value) {
  if (typeof value !== "string") return "/#overview";
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin &&
      ["/", "/learn", "/markets"].includes(url.pathname)
      ? url.pathname + url.search + url.hash
      : "/#overview";
  } catch {
    return "/#overview";
  }
}
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(
      payload.title ?? "Together · 家庭财富提醒",
      {
        body: payload.body ?? "打开私密家庭空间查看。",
        tag:
          payload.tag === "together-learning" ? payload.tag : "together-wealth",
        data: { url: safePath(payload.url) },
      },
    ),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data?.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        for (const client of clients) {
          if (new URL(client.url).origin === self.location.origin) {
            await client.navigate(path);
            return client.focus();
          }
        }
        return self.clients.openWindow(path);
      }),
  );
});
