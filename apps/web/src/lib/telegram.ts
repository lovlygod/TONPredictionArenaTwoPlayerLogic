import WebApp from "@twa-dev/sdk";

export function getInitDataRaw(): string {
  try {
    if (WebApp.initData) return WebApp.initData;
  } catch {
    // ignore
  }
  return "";
}

export function safeTelegramReady(): void {
  try {
    WebApp.ready();
    WebApp.expand();
  } catch {
    // non-telegram env
  }
}

export function openExternalLink(url: string): void {
  try {
    WebApp.openLink(url);
    return;
  } catch {
    // non-telegram env
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
