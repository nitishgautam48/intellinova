"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Button, Icon, Loading } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export const ANAV = [
  ["/admin", "Overview", "space_dashboard"],
  ["/admin/kb", "Knowledge base", "database"],
  ["/admin/eval", "Evaluation", "query_stats"],
  ["/admin/curriculum", "Curriculum", "account_tree"],
  ["/admin/resources", "Resources", "video_library"],
  ["/admin/exams", "Exams", "flag"],
  ["/admin/careers", "Career Data", "route"],
  ["/admin/generated", "Generated Content", "auto_awesome"],
  ["/admin/users", "Users", "group"],
  ["/admin/analytics", "Analytics", "monitoring"],
] as const;

type Me = { id: string; name: string | null; email: string | null; role: string; is_staff: boolean };

const isOn = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { data: me, error } = useApi<Me>("/api/auth/me");
  const [collapsed, setCollapsed] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("inn-asb") === "1");
    } catch {}
  }, []);
  const setCol = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem("inn-asb", v ? "1" : "0");
    } catch {}
  };
  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    window.location.href = "/admin/login";
  };

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="text-center text-ink2">
          Couldn&apos;t reach the server. <Button size="sm" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }
  if (!me) return <Loading className="min-h-screen" />;
  if (!me.is_staff) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="flex max-w-[420px] flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-err-soft text-err-ink"><Icon name="lock" /></span>
          <div className="font-display text-xl font-semibold">This account can&apos;t use the admin console</div>
          <div className="text-ink2">You&apos;re signed in as {me.email}, a student account. Staff access is by invitation from an admin.</div>
          <Button variant="primary" onClick={logout}>Log in with an admin account</Button>
        </div>
      </div>
    );
  }

  const title = [...ANAV].reverse().find(([h]) => isOn(path, h))?.[1] || "Admin";
  const name = me.name || me.email || "Admin";
  const labels = collapsed ? "hidden" : "hidden lg:block";

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={cn("hidden flex-none flex-col gap-0.5 bg-side px-3 py-4 text-side-ink transition-[width] md:flex", collapsed ? "w-[68px]" : "w-[68px] lg:w-[240px]")}>
        <Link href="/admin" className={cn("flex items-center gap-2.5 px-1.5 pb-[18px] pt-1 text-inherit hover:no-underline", collapsed ? "justify-center" : "justify-center lg:justify-start")}>
          <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] font-display text-lg font-bold text-on-pri" style={{ background: "var(--grad)" }}>I</span>
          <span className={labels}>
            <span className="block font-display text-[17px] font-bold leading-none">IntelliNova</span>
            <span className="mt-[3px] block font-mono text-[10px] font-medium tracking-[0.08em] text-side-ink2">ADMIN CONSOLE</span>
          </span>
        </Link>
        <nav className="flex flex-col gap-0.5 overflow-y-auto">
          {ANAV.map(([href, l, icon]) => {
            const on = isOn(path, href);
            return (
              <Link
                key={href}
                href={href}
                title={l}
                className={cn("flex h-10 flex-none items-center gap-3 rounded-[10px] px-[11px] font-semibold hover:bg-side2 hover:text-white hover:no-underline", collapsed ? "justify-center" : "justify-center lg:justify-start")}
                style={{ background: on ? "var(--side2)" : undefined, color: on ? "#fff" : "var(--side-ink2)" }}
              >
                <Icon name={icon} />
                <span className={cn(collapsed ? "hidden" : "hidden lg:inline")}>{l}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5 border-t border-side2 pt-2">
          <button onClick={() => setCol(!collapsed)} title="Collapse sidebar" className={cn("hidden h-9 items-center gap-3 rounded-[10px] border-0 bg-transparent px-[11px] text-[13px] font-semibold text-side-ink2 hover:bg-side2 hover:text-white lg:flex", collapsed ? "justify-center" : "justify-start")}>
            <Icon name={collapsed ? "left_panel_open" : "left_panel_close"} size={19} />
            {!collapsed && <span>Collapse</span>}
          </button>
          <div className={cn("flex items-center gap-2.5 px-2 pt-2", collapsed ? "justify-center" : "justify-center lg:justify-start")}>
            <div className="grid h-8 w-8 flex-none place-items-center rounded-full bg-side2 text-xs font-bold text-white" title={name}>{initials(name)}</div>
            <div className={cn("min-w-0 flex-1", labels)}>
              <div className="truncate text-[13px] font-semibold text-white">{name}</div>
              <div className="text-[11px] capitalize text-side-ink2">{me.role}</div>
            </div>
            <button onClick={logout} aria-label="Sign out" title="Sign out" className={cn("h-[30px] w-[30px] place-items-center rounded-lg border-0 bg-transparent text-side-ink2 hover:bg-side2 hover:text-white", collapsed ? "hidden" : "hidden lg:grid")}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-none items-center gap-3 border-b border-line bg-surface px-4 md:px-6">
          <div className="flex-none font-display text-lg font-semibold">{title}</div>
          <form
            className="ml-3 hidden h-[38px] max-w-[420px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-bg px-3 md:flex"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) router.push(`/admin/resources?q=${encodeURIComponent(q.trim())}`);
            }}
          >
            <Icon name="search" size={18} className="text-ink3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search resources by title…" className="min-w-0 flex-1 border-0 bg-transparent outline-none" />
          </form>
          <div className="flex-1" />
          <button onClick={toggle} aria-label="Toggle dark mode" className="grid h-[38px] w-[38px] place-items-center rounded-[10px] border-0 bg-transparent text-ink2 hover:bg-surface2">
            <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} />
          </button>
          <button onClick={logout} aria-label="Sign out" className="grid h-[38px] w-[38px] place-items-center rounded-[10px] border-0 bg-transparent text-ink2 hover:bg-surface2 md:hidden">
            <Icon name="logout" />
          </button>
        </header>
        <div className="no-scrollbar flex flex-none gap-1.5 overflow-x-auto border-b border-line bg-surface px-4 py-2.5 md:hidden">
          {ANAV.map(([href, l]) => {
            const on = isOn(path, href);
            return (
              <Link key={href} href={href} className="flex h-8 flex-none items-center rounded-full border border-line px-3 text-[13px] font-semibold hover:no-underline" style={{ background: on ? "var(--ink)" : "var(--surface)", color: on ? "var(--bg)" : "var(--ink)" }}>
                {l}
              </Link>
            );
          })}
        </div>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="mx-auto max-w-[1280px]"><Suspense fallback={<Loading />}>{children}</Suspense></div>
        </main>
      </div>
    </div>
  );
}
