import type { Platform, PlatformClient } from "../types.ts";
import { threads } from "./threads.ts";
import { x } from "./x.ts";
import { tiktok } from "./tiktok.ts";
import { instagram } from "./instagram.ts";

export const clients: Record<Platform, PlatformClient> = { threads, x, tiktok, instagram };

export function client(p: string): PlatformClient {
  const c = clients[p as Platform];
  if (!c) throw new Error(`Unknown platform "${p}". Use: ${Object.keys(clients).join(", ")}`);
  return c;
}
