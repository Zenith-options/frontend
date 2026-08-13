// Thin wrapper around the browser Notification API. Isolated here so callers
// don't need to worry about SSR (no `Notification` global) or unsupported
// browsers — every function is a safe no-op in those cases.

export function requestNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

export function notificationsEnabled(): boolean {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

export function sendNotification(title: string, body: string) {
  if (!notificationsEnabled()) return;
  new Notification(title, { body });
}
