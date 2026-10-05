"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { Icon, Loading, Logo } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export const NAV = [
  ["/app", "Home", "home", "Home"],
  ["/app/learn", "Learn", "menu_book", "Learn"],
  ["/app/tutor", "Ask Tutor", "forum", "Tutor"],
  ["/app/practice", "Practice", "quiz", "Practice"],
  ["/app/study", "Study AI", "auto_awesome", "Study AI"],
  ["/app/plan", "Study Plan", "event_note", "Plan"],
  ["/app/exam", "Exam Prep", "flag", "Exams"],
  ["/app/career", "Career Explorer", "explore", "Career"],
  ["/app/progress", "My Progress", "insights", "Progress"],
  ["/app/saved", "Saved", "bookmark", "Saved"],
  ["/app/profile", "Profile", "person", "Profile"],
] as const;
const MOBILE = ["/app", "/app/learn", "/app/tutor", "/app/practice", "/app/progress"];
const AV = ["oklch(0.62 0.14 162)", "oklch(0.62 0.1 200)", "oklch(0.66 0.13 75)", "oklch(0.6 0.15 25)", "oklch(0.58 0.14 300)", "oklch(0.55 0.12 250)"];
export const avatarColor = (i: number) => AV[i % AV.length];

type Header = { name: string; nickname: string; initials: string; avatar: number; streak: number; onboarded: boolean; is_staff: boolean; reminders: { icon: string; t: string; href: string }[] };

function isOn(path: string, href: string) {
  return href === "/app" ? path === "/app" : path.startsWith(href);
}

function moduleOf(path: string) {
  if (path.startsWith("/app/study")) return "notes";
  if (path.startsWith("/app/exam")) return "exam";
  if (path.startsWith("/app/career")) return "career";
  if (path.startsWith("/app/tutor")) return "tutor";
  if (path.startsWith("/app/practice")) return "practice";
  return "learn";
}

/** Counts active minutes (tab visible + recent input) for "Learning time" and the week chart. */
function useStudyTime(path: string) {
  const last = useRef(Date.now());
  useEffect(() => {
    const bump = () => (last.current = Date.now());
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    window.addEventListener("scroll", bump, true);
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - last.current < 3 * 60_000) {
        api.post("/api/activity/time", { minutes: 1, module: moduleOf(window.location.pathname) }).catch(() => {});
      }
    }, 60_000);
    return () => {
      clearInterval(t);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("scroll", bump, true);
    };
  }, []);
  useEffect(() => {
    last.current = Date.now();
  }, [path]);
}

function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sug, setSug] = useState<{ suggestions: { t: string; m: string; icon: string; kind: string; ref: string; chapter_id?: string }[]; did_you_mean: string | null } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return setSug(null);
    const t = setTimeout(() => api.get<typeof sug>(`/api/search/suggest?q=${encodeURIComponent(q)}`).then(setSug).catch(() => {}), 180);
    return () => clearTimeout(t);
  }, [q]);

  const submit = (v: string) => {
    setOpen(false);
    if (v.trim()) router.push(`/app/search?q=${encodeURIComponent(v.trim())}`);
  };
  const openHit = (h: { kind: string; ref: string; chapter_id?: string; t: string }) => {
    setOpen(false);
    if (h.kind === "chapter") router.push(`/app/learn/chapter/${h.ref}`);
    else if (h.kind === "topic" && h.chapter_id) router.push(`/app/learn/chapter/${h.chapter_id}`);
    else if (h.kind === "exam") router.push(`/app/exam/${h.ref}`);
    else if (h.kind === "career") router.push(`/app/career?node=${h.ref}`);
    else submit(h.t);
  };

  return (
    <Popover.Root open={open && !!sug && (sug.suggestions.length > 0 || !!sug.did_you_mean)} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <label className="flex h-[42px] max-w-[560px] flex-1 items-center gap-2.5 rounded-xl border border-line bg-bg pl-3.5 pr-3">
          <Icon name="search" className="text-ink3" />
          <input
            ref={ref}
            value={q}
            onChange={(e) => (setQ(e.target.value), setOpen(true))}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => e.key === "Enter" && submit(q)}
            placeholder="Search a subject, chapter, concept, exam or career…"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
          />
          <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink3">/</span>
        </label>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} onOpenAutoFocus={(e) => e.preventDefault()} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[360px] max-w-[560px] rounded-xl border border-line bg-surface p-1.5 shadow-card">
          {sug?.did_you_mean && (
            <button onClick={() => (setQ(sug.did_you_mean!), submit(sug.did_you_mean!))} className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-[13px] hover:bg-surface2">
              <Icon name="spellcheck" size={18} className="text-pri" /> Did you mean <b>{sug.did_you_mean}</b>?
            </button>
          )}
          {sug?.suggestions.map((s, i) => (
            <button key={i} onClick={() => openHit(s)} className="flex w-full items-center gap-3 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left hover:bg-surface2">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-surface2 text-ink2">
                <Icon name={s.icon} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.t}</span>
                <span className="block truncate text-xs text-ink2">{s.m}</span>
              </span>
            </button>
          ))}
          <button onClick={() => submit(q)} className="flex w-full items-center gap-2 rounded-lg border-0 border-t border-line bg-transparent px-2.5 py-2 text-left text-[13px] font-semibold text-pri-ink hover:bg-surface2">
            <Icon name="search" size={18} /> See all results for “{q}”
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function StudentShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { data: me } = useApi<Header>("/api/me/header");
  const [collapsed, setCollapsed] = useState(false);
  useStudyTime(path);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("inn-sb") === "1");
    } catch {}
  }, []);
  useEffect(() => {
    if (me && !me.onboarded) router.replace("/onboarding");
  }, [me, router]);

  const setCol = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem("inn-sb", v ? "1" : "0");
    } catch {}
  };
  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    window.location.href = "/login";
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={cn("hidden flex-none flex-col gap-1 border-r border-line bg-surface px-3 py-4 transition-[width] md:flex", collapsed ? "w-[72px]" : "w-[72px] lg:w-[244px]")}>
        <Link href="/app" className={cn("flex items-center gap-2.5 px-1.5 pb-[18px] pt-1 text-inherit hover:no-underline", collapsed ? "justify-center" : "justify-center lg:justify-start")}>
          <span className={cn(collapsed ? "" : "lg:hidden")}>
            <Logo withText={false} />
          </span>
          <span className={cn("hidden", !collapsed && "lg:block")}>
            <Logo />
          </span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(([href, label, icon]) => {
            const on = isOn(path, href);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                className={cn("flex h-[42px] items-center gap-3 rounded-[10px] px-[11px] hover:bg-surface2 hover:text-ink hover:no-underline", collapsed ? "justify-center" : "justify-center lg:justify-start")}
                style={{ background: on ? "var(--pri-soft)" : undefined, color: on ? "var(--pri-ink)" : "var(--ink2)", fontWeight: on ? 600 : 500 }}
              >
                <Icon name={icon} size={22} fill={on} />
                <span className={cn("hidden", !collapsed && "lg:inline")}>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5">
          <button onClick={logout} title="Log out" className={cn("flex h-10 items-center gap-3 rounded-[10px] border-0 bg-transparent px-[11px] font-medium text-ink2 hover:bg-surface2", collapsed ? "justify-center" : "justify-center lg:justify-start")}>
            <Icon name="logout" />
            <span className={cn("hidden", !collapsed && "lg:inline")}>Log out</span>
          </button>
          <button onClick={() => setCol(!collapsed)} title="Collapse sidebar" className={cn("hidden h-10 items-center gap-3 rounded-[10px] border-0 bg-transparent px-[11px] font-medium text-ink2 hover:bg-surface2 lg:flex", collapsed ? "justify-center" : "justify-start")}>
            <Icon name={collapsed ? "left_panel_open" : "left_panel_close"} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-none items-center gap-2.5 border-b border-line bg-surface px-4 md:px-7">
          <div className="flex flex-1 items-center gap-2 md:hidden">
            <Logo size={30} textClass="text-lg" />
          </div>
          <Link href="/app/search" aria-label="Search" className="grid h-10 w-10 place-items-center rounded-[10px] border border-line bg-surface text-ink md:hidden">
            <Icon name="search" />
          </Link>
          <div className="hidden flex-1 md:flex">
            <HeaderSearch />
          </div>
          {!!me?.streak && (
            <div title={`${me.streak}-day study streak`} className="hidden h-9 items-center gap-1.5 rounded-full bg-surface2 px-3 text-[13px] font-semibold md:flex">
              <Icon name="local_fire_department" size={18} fill style={{ color: "var(--warn)" }} />
              {me.streak} day{me.streak > 1 ? "s" : ""}
            </div>
          )}
          <button onClick={toggle} aria-label="Toggle dark mode" className="grid h-10 w-10 place-items-center rounded-[10px] border-0 bg-transparent text-ink2 hover:bg-surface2">
            <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} />
          </button>
          <Popover.Root>
            <Popover.Trigger aria-label="Notifications" className="relative grid h-10 w-10 place-items-center rounded-[10px] border-0 bg-transparent text-ink2 hover:bg-surface2">
              <Icon name="notifications" />
              {!!me?.reminders.length && <span className="absolute right-2.5 top-[9px] h-2 w-2 rounded-full border-2 border-surface bg-err" />}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={6} className="z-50 w-[300px] rounded-xl border border-line bg-surface p-2 shadow-card">
                <div className="px-2 pb-1 pt-1 text-xs font-semibold text-ink2">Reminders</div>
                {me?.reminders.length ? (
                  me.reminders.map((r) => (
                    <Link key={r.t} href={r.href} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-ink hover:bg-surface2 hover:no-underline">
                      <Icon name={r.icon} size={19} className="text-pri" /> {r.t}
                    </Link>
                  ))
                ) : (
                  <div className="px-2 py-3 text-[13px] text-ink2">You&apos;re all caught up.</div>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Link href="/app/profile" aria-label="Profile" className="grid h-9 w-9 place-items-center rounded-full text-[13px] font-bold text-white hover:no-underline" style={{ background: avatarColor(me?.avatar || 0) }}>
            {me?.initials || ""}
          </Link>
        </header>
        <main className="min-h-0 flex-1 overflow-auto px-4 pb-24 pt-[18px] md:px-8 md:pb-14 md:pt-7">
          <div className="mx-auto max-w-[1240px]"><Suspense fallback={<Loading />}>{children}</Suspense></div>
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-line bg-surface md:hidden">
          {NAV.filter((n) => MOBILE.includes(n[0])).map(([href, , icon, short]) => {
            const on = isOn(path, href);
            return (
              <Link key={href} href={href} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold hover:no-underline" style={{ color: on ? "var(--pri)" : "var(--ink2)" }}>
                <Icon name={icon} size={22} fill={on} />
                {short}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
