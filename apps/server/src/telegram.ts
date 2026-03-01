import crypto from "node:crypto";

type TgUser = {
  tgUserId: string;
  username: string | null;
  firstName: string;
  avatarUrl: string | null;
};

function parseInitData(initData: string): Record<string, string> {
  const params = new URLSearchParams(initData);
  const data: Record<string, string> = {};
  for (const [key, value] of params.entries()) data[key] = value;
  return data;
}

export function validateTelegramInitData(initData: string, botToken: string): (TgUser & { startParam?: string | null }) | null {
  const data = parseInitData(initData);
  const hash = data.hash;
  if (!hash) return null;

  const checkString = Object.entries(data)
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hex = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  if (hex !== hash) return null;

  const userRaw = data.user;
  if (!userRaw) return null;
  const user = JSON.parse(userRaw) as {
    id: number;
    username?: string;
    first_name?: string;
    photo_url?: string;
  };
  return {
    tgUserId: String(user.id),
    username: user.username ?? null,
    firstName: user.first_name ?? "Player",
    avatarUrl: user.photo_url ?? null,
    startParam: data.start_param ?? null,
  };
}
