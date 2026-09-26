/**
 * Thin fetch wrapper over the backend (../backend, docs/architecture.md §3
 * tech stack). All data-fetching must go through here so the base URL and
 * error handling stay in one place.
 */

// Where the backend lives, in order of priority:
//   1. ?api=https://xxxx.ngrok-free.app in the address bar (remembered in this browser), so a hosted UI can be pointed at whichever
//      laptop is running the backend today,
//   2. the address saved in this browser earlier (from the "Connect to backend" box),
//   3. NEXT_PUBLIC_API_BASE_URL, fixed when the site is built, or on a vercel.app address the ngrok domain named below,
//   4. the same origin (Next proxies /api and /ws to the backend, see next.config.mjs), which is what localhost and a tunnel to the UI use.
const STORE = "resolvyn.backend";

// This project's permanent ngrok address (a free account keeps one). Used only when the site is served from vercel.app and nothing
// else names a backend, so a plain deploy works with no settings. Change it if the ngrok domain changes.
const HOSTED_DEFAULT = "https://bristol-unannihilatory-terrance.ngrok-free.dev";

function clean(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

function chosenBackend(): string {
  if (typeof window === "undefined") return process.env.NEXT_PUBLIC_API_BASE_URL ? clean(process.env.NEXT_PUBLIC_API_BASE_URL) : "";
  try {
    const q = new URLSearchParams(window.location.search).get("api");
    if (q !== null) {
      if (q) localStorage.setItem(STORE, clean(q));
      else localStorage.removeItem(STORE);
    }
    const saved = localStorage.getItem(STORE);
    if (saved) return saved;
  } catch {
    /* private mode: fall through to the build-time default */
  }
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return clean(process.env.NEXT_PUBLIC_API_BASE_URL);
  return window.location.hostname.endsWith(".vercel.app") ? HOSTED_DEFAULT : "";
}

/** Point this browser at a different backend (a new ngrok address). Reloads so every connection starts fresh. */
export function setBackend(url: string): void {
  try {
    if (url.trim()) localStorage.setItem(STORE, clean(url));
    else localStorage.removeItem(STORE);
  } catch {
    /* ignored */
  }
  const u = new URL(window.location.href);
  u.searchParams.delete("api");
  window.location.replace(u.toString());
}

const remote = chosenBackend();
const origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3000";
export const ORIGIN: string = remote || origin;
export const API_BASE_URL = `${ORIGIN}/api`;
export const WS_BASE_URL = ORIGIN.replace(/^http/, "ws");
export const IS_REMOTE = Boolean(remote);

/** ngrok's free tier puts a warning page in front of browser requests; this header skips it. Harmless everywhere else. */
export const NGROK_SKIP = { "ngrok-skip-browser-warning": "1" };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: isForm ? { ...NGROK_SKIP, ...init?.headers } : { "Content-Type": "application/json", ...NGROK_SKIP, ...init?.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = `Request to ${path} failed with ${response.status}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(response.status, detail);
  }
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

export function ttsUrl(text: string, lang: string): string {
  return `${API_BASE_URL}/tts?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(text)}`;
}
