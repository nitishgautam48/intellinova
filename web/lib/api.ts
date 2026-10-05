"use client";

import useSWR, { type SWRConfiguration, mutate as globalMutate } from "swr";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The student app and the admin console keep separate sessions; every API call says which app it's from. */
export const PORTAL_HEADER = "X-IntelliNova-Portal";
export function portal(): "admin" | "student" {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/admin") ? "admin" : "student";
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch("/api/auth/refresh", { method: "POST", credentials: "include", headers: { [PORTAL_HEADER]: portal() } })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

const AUTH_PAGES = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth", "/admin/login", "/admin/signup", "/admin/reset-password"];
export const isAuthPage = (path: string) => AUTH_PAGES.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));

/** Where to go back to after logging in: only real app pages, never another login page (that loops). */
export function safeNext(next: string | null | undefined, admin = false): string {
  const fallback = admin ? "/admin" : "/app";
  if (!next || !next.startsWith("/") || next.startsWith("//") || isAuthPage(next.split("?")[0])) return fallback;
  if (admin !== next.startsWith("/admin")) return fallback;
  return next;
}

function loginPath(): string | null {
  if (typeof window === "undefined") return "/login";
  const { pathname, search } = window.location;
  if (isAuthPage(pathname)) return null; // already on a login page: never redirect to itself
  const admin = pathname.startsWith("/admin");
  const next = encodeURIComponent(pathname + search);
  return admin ? `/admin/login?next=${next}` : `/login?next=${next}`;
}

type Opts = { method?: string; body?: unknown; form?: FormData; noRedirect?: boolean };

export async function request<T = unknown>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  const init: RequestInit = { method: opts.method || "GET", credentials: "include", headers: { [PORTAL_HEADER]: portal() } };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "You seem to be offline. Check your connection and try again.");
  }
  if (res.status === 401 && !path.startsWith("/api/auth/") && !retried) {
    if (await refreshSession()) return request<T>(path, opts, true);
    const to = opts.noRedirect ? null : loginPath();
    if (to) window.location.href = to;
    throw new ApiError(401, "Please log in again.");
  }
  if (res.status === 403 && res.headers.get("x-intellinova-portal") === "admin" && portal() === "student" && !opts.noRedirect) {
    // A staff account's session in the student app (left over from before the two apps had separate
    // sessions). The student app is for student accounts: clear it and ask for a student login.
    await fetch("/api/auth/logout", { method: "POST", credentials: "include", headers: { [PORTAL_HEADER]: "student" } }).catch(() => {});
    const to = loginPath();
    if (to) window.location.replace(to);
    throw new ApiError(403, "This is an admin account. Log in with a student account.");
  }
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof data === "object" && data && "detail" in data ? String((data as { detail: unknown }).detail) : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  get: <T = unknown>(p: string) => request<T>(p),
  post: <T = unknown>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: body ?? {} }),
  put: <T = unknown>(p: string, body?: unknown) => request<T>(p, { method: "PUT", body: body ?? {} }),
  patch: <T = unknown>(p: string, body?: unknown) => request<T>(p, { method: "PATCH", body: body ?? {} }),
  del: <T = unknown>(p: string) => request<T>(p, { method: "DELETE" }),
  upload: <T = unknown>(p: string, form: FormData) => request<T>(p, { method: "POST", form }),
};

export function useApi<T = any>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, (p: string) => request<T>(p), { revalidateOnFocus: false, ...config });
}

export const refresh = (key: string | ((k: string) => boolean)) =>
  typeof key === "string" ? globalMutate(key) : globalMutate((k) => typeof k === "string" && key(k));

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
