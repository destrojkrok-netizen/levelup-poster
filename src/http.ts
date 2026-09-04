export class HttpError extends Error {
  constructor(public status: number, public body: string, public url: string) {
    super(`${status} ${url}\n${body.slice(0, 800)}`);
  }
}

export async function json<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, url);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export function form(data: Record<string, string | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) if (v !== undefined) p.set(k, v);
  return p;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (see .env.example)`);
  return v;
}

export function logRequest(label: string, payload: unknown) {
  console.log(`  [dry-run] ${label}`);
  console.log("  " + JSON.stringify(payload, null, 2).split("\n").join("\n  "));
}
