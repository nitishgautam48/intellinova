"use client";

import * as React from "react";

import { Icon, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, toneOf } from "@/lib/utils";

export type Structure = { id: string; label: string; class_level: string; chapters: { id: string; name: string; topics: { id: string; name: string }[] }[] }[];
export const LANGS = ["English", "Hindi", "Hinglish", "Marathi", "Tamil", "Telugu", "Bengali", "Kannada", "Gujarati"];

/** Small building blocks shared by the admin console pages (tables, filter chips, bar lists). */

export function StatusPill({ s, className }: { s: string; className?: string }) {
  return <Pill tone={toneOf(s)} className={cn("text-[11px] font-bold", className)}>{s}</Pill>;
}

export function Panel({ title, sub, right, children, className, pad = true }: { title?: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-[14px] border border-line bg-surface", pad && "p-[18px]", className)}>
      {(title || right) && (
        <div className={cn("flex flex-wrap items-center justify-between gap-2.5", pad ? "mb-2.5" : "px-4 py-3.5")}>
          <div className="min-w-0">
            {title && <div className="font-display text-[15px] font-semibold">{title}</div>}
            {sub && <div className="text-xs text-ink2">{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Kicker({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("font-mono text-[11px] font-semibold tracking-[0.06em] text-ink3", className)}>{children}</div>;
}

export function FilterChips<T extends string>({ options, value, onChange, size = "md" }: { options: { v: T; l?: React.ReactNode; n?: number }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            aria-pressed={on}
            className={cn("flex items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold", size === "sm" ? "h-[30px]" : "h-8")}
            style={{ borderColor: on ? "var(--ink)" : "var(--line)", background: on ? "var(--ink)" : "var(--surface)", color: on ? "var(--bg)" : "var(--ink)" }}
          >
            {o.l ?? o.v}
            {o.n !== undefined && <span className="font-mono text-[11px] font-medium opacity-70">{o.n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Grid table inside a scrollable card. `cols` is a CSS grid-template-columns value. */
export function Table({ cols, minWidth = 720, headers, children, title, sub, right, empty }: { cols: string; minWidth?: number; headers: React.ReactNode[]; children: React.ReactNode; title?: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; empty?: React.ReactNode }) {
  const hasRows = React.Children.toArray(children).length > 0;
  return (
    <div className="min-w-0 overflow-auto rounded-[14px] border border-line bg-surface">
      <div style={{ minWidth }}>
        {(title || right) && (
          <div className="flex items-center justify-between gap-2.5 px-4 py-3.5">
            <div className="min-w-0">
              {title && <div className="font-display text-[15px] font-semibold">{title}</div>}
              {sub && <div className="text-xs text-ink2">{sub}</div>}
            </div>
            {right}
          </div>
        )}
        <div className="grid gap-2.5 bg-surface2 px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.04em] text-ink2" style={{ gridTemplateColumns: cols }}>
          {headers.map((h, i) => <span key={i}>{h}</span>)}
        </div>
        {hasRows ? children : empty && <div className="border-t border-line px-4 py-8 text-center text-ink2">{empty}</div>}
      </div>
    </div>
  );
}

export function Row({ cols, onClick, active, children, className }: { cols: string; onClick?: () => void; active?: boolean; children: React.ReactNode; className?: string }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn("grid w-full items-center gap-2.5 border-0 border-t border-line px-4 py-3 text-left text-[13px]", onClick && "cursor-pointer hover:bg-bg", className)}
      style={{ gridTemplateColumns: cols, background: active ? "var(--pri-soft)" : undefined }}
    >
      {children}
    </Comp>
  );
}

export function BarList({ items, color = "var(--pri)", mono = true }: { items: { t: string; n: number | string; s?: string; w?: string }[]; color?: string; mono?: boolean }) {
  const max = Math.max(1, ...items.map((i) => Number(i.n) || 0));
  return (
    <div>
      {items.map((p, i) => (
        <div key={i} className="py-1.5">
          <div className="mb-1 flex justify-between gap-2 text-[13px]">
            <span className={cn("min-w-0 truncate", mono && "font-mono")}>{p.t}</span>
            <span className="text-ink2">{p.n}</span>
          </div>
          <div className="h-1.5 rounded-[3px] bg-surface2">
            <div className="h-full rounded-[3px]" style={{ width: p.w || `${Math.round((100 * (Number(p.n) || 0)) / max)}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RowBars({ items }: { items: { t: string; s: string; w: string; n?: number }[] }) {
  return (
    <div>
      {items.map((p, i) => (
        <div key={i} className="flex items-center gap-3 py-1.5">
          <div className="min-w-0 flex-[0_0_150px]">
            <div className="truncate text-[13px] font-semibold">{p.t}</div>
            <div className="text-[11px] text-ink2">{p.s}</div>
          </div>
          <div className="h-2.5 flex-1 rounded-[5px] bg-surface2">
            <div className="h-full rounded-[5px] bg-teal" style={{ width: p.w }} />
          </div>
          {p.n !== undefined && <span className="w-12 text-right font-mono text-[11px] text-ink2">{p.n}</span>}
        </div>
      ))}
    </div>
  );
}

export function StatCard({ l, v, d, icon }: { l: string; v: React.ReactNode; d?: React.ReactNode; icon?: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-[18px]">
      <div className="flex justify-between text-[13px] text-ink2">
        {l}
        {icon && <Icon name={icon} size={18} />}
      </div>
      <div className="mt-2 font-display text-[28px] font-semibold leading-[1.1]">{v}</div>
      {d && <div className="mt-1 text-xs text-ink2">{d}</div>}
    </div>
  );
}

export function StatGrid({ children, min = 200 }: { children: React.ReactNode; min?: number }) {
  return <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))` }}>{children}</div>;
}

export function Chips({ items, tone = "mute" }: { items: string[]; tone?: "mute" | "pri" | "teal" }) {
  const st = { mute: ["var(--surface2)", "var(--ink)"], pri: ["var(--pri-soft)", "var(--pri-ink)"], teal: ["var(--teal-soft)", "var(--teal-ink)"] }[tone];
  if (!items.length) return <span className="text-xs text-ink2">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((x) => (
        <span key={x} className="rounded-lg px-2.5 py-1 text-xs font-semibold" style={{ background: st[0], color: st[1] }}>{x}</span>
      ))}
    </div>
  );
}

/** Multi-select picker over a list of {id, name, hint}: removable chips plus a search box. */
export function MultiPick({ value, onChange, options, placeholder = "Search…", exclude = [] }: { value: string[]; onChange: (v: string[]) => void; options: { id: string; name: string; hint?: string }[]; placeholder?: string; exclude?: string[] }) {
  const [q, setQ] = React.useState("");
  const byId = React.useMemo(() => Object.fromEntries(options.map((o) => [o.id, o])), [options]);
  const hits = q.trim()
    ? options.filter((o) => !value.includes(o.id) && !exclude.includes(o.id) && `${o.name} ${o.hint || ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8)
    : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((id) => (
          <span key={id} className="flex items-center gap-1 rounded-full bg-pri-soft py-1 pl-2.5 pr-1.5 text-xs font-semibold text-pri-ink">
            {byId[id]?.name || "Unknown"}
            <button onClick={() => onChange(value.filter((x) => x !== id))} className="grid border-0 bg-transparent p-0 text-inherit" aria-label="Remove">
              <Icon name="close" size={14} />
            </button>
          </span>
        ))}
        {!value.length && <span className="text-xs text-ink2">None selected</span>}
      </div>
      <div className="relative">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-9 w-full rounded-[9px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-pri" />
        {hits.length > 0 && (
          <div className="absolute left-0 right-0 top-10 z-10 max-h-64 overflow-auto rounded-[10px] border border-line bg-surface p-1 shadow-card">
            {hits.map((o) => (
              <button key={o.id} onClick={() => (onChange([...value, o.id]), setQ(""))} className="block w-full rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-left hover:bg-surface2">
                <span className="block text-[13px] font-semibold">{o.name}</span>
                {o.hint && <span className="block text-[11px] text-ink2">{o.hint}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export type TopicHit = { id: string; name: string; chapter: string; subject: string };

/** Async search over curriculum topics (GET /api/admin/topics/lookup). */
export function TopicSearch({ onPick, placeholder = "Search topics…", exclude = [] }: { onPick: (t: TopicHit) => void; placeholder?: string; exclude?: string[] }) {
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<TopicHit[]>([]);
  React.useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => {
      api.get<TopicHit[]>(`/api/admin/topics/lookup?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const shown = hits.filter((h) => !exclude.includes(h.id));
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-9 w-full rounded-[9px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-pri" />
      {shown.length > 0 && (
        <div className="absolute left-0 right-0 top-10 z-10 max-h-64 overflow-auto rounded-[10px] border border-line bg-surface p-1 shadow-card">
          {shown.map((o) => (
            <button key={o.id} onClick={() => (onPick(o), setQ(""), setHits([]))} className="block w-full rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-left hover:bg-surface2">
              <span className="block text-[13px] font-semibold">{o.name}</span>
              <span className="block text-[11px] text-ink2">{o.chapter} · {o.subject}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pipeline progress dots for a source or material. */
export function StageDots({ stages, stage, status }: { stages: string[]; stage: number; status: string }) {
  return (
    <span className="flex gap-[3px]">
      {stages.map((t, i) => {
        const done = status === "Ready" || status === "Needs Review" || i < stage;
        const cur = !done && i === stage && status === "Processing";
        const bad = status === "Failed" && i === stage;
        const bg = bad ? "var(--err)" : done ? "var(--pri)" : cur ? "var(--warn)" : "var(--surface2)";
        return <span key={t} title={t} className={cn("h-1.5 flex-1 rounded-[3px]", cur && "animate-pulse")} style={{ background: bg }} />;
      })}
    </span>
  );
}
