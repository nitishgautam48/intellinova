"use client";

import { useMemo, useState } from "react";

import { Icon } from "@/components/ui";

export type FlowNode = {
  id: string; name: string; chapter_id: string; col: number; row: number; level: number; published: boolean; subtopics: string[];
  state: "done" | "current" | "todo" | "external"; mastery: number | null; status: string; due: boolean; external?: string;
};
export type FlowMapT = { subject: { id: string; name: string }; chapters: { id: string; name: string; col: number }[]; nodes: FlowNode[]; edges: { from: string; to: string }[]; has_external: boolean };

const COL_W = 212, NODE_H = 66, GAP_X = 64, GAP_Y = 14, HEAD = 44, PAD = 16;
const TONE: Record<string, [string, string]> = {
  Mastered: ["var(--ok-soft)", "var(--ok)"],
  Developing: ["var(--warn-soft)", "var(--warn)"],
  Weak: ["var(--err-soft)", "var(--err)"],
  "Not assessed": ["var(--surface)", "var(--line)"],
  "Other subject": ["var(--surface2)", "var(--line)"],
};

/** Course flow map: chapters as columns in teaching order, prerequisite arrows between topics,
 *  nodes coloured by mastery. Hovering a topic highlights everything it depends on. */
export function FlowMap({ data, onPick, admin }: { data: FlowMapT; onPick?: (n: FlowNode) => void; admin?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const shift = data.has_external ? 1 : 0;
  const byId = useMemo(() => Object.fromEntries(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const parents = useMemo(() => {
    const m: Record<string, string[]> = {};
    data.edges.forEach((e) => (m[e.to] = [...(m[e.to] || []), e.from]));
    return m;
  }, [data.edges]);
  const chain = useMemo(() => {
    if (!hover) return null;
    const out = new Set<string>([hover]);
    const walk = (id: string) => (parents[id] || []).forEach((p) => !out.has(p) && (out.add(p), walk(p)));
    walk(hover);
    return out;
  }, [hover, parents]);

  const pos = (n: FlowNode) => ({ x: PAD + (n.col + shift) * (COL_W + GAP_X), y: HEAD + PAD + n.row * (NODE_H + GAP_Y) });
  const cols = data.chapters.length + shift;
  const rows = Math.max(1, ...data.nodes.map((n) => n.row + 1));
  const W = PAD * 2 + cols * COL_W + (cols - 1) * GAP_X + GAP_X; // room on the right for same-chapter links
  const H = HEAD + PAD * 2 + rows * (NODE_H + GAP_Y);

  if (!data.nodes.length) return <div className="py-10 text-center text-[13px] text-ink2">No topics published in this subject yet.</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-auto rounded-2xl border border-line bg-bg">
        <div className="relative" style={{ width: W, height: H }}>
          {data.has_external && (
            <div className="absolute font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-ink3" style={{ left: PAD, top: PAD, width: COL_W }}>From other subjects</div>
          )}
          {data.chapters.map((c) => (
            <div key={c.id} className="absolute truncate font-display text-[14px] font-semibold" style={{ left: PAD + (c.col + shift) * (COL_W + GAP_X), top: PAD, width: COL_W }} title={c.name}>
              <span className="mr-1.5 font-mono text-[11px] text-ink3">{String(c.col + 1).padStart(2, "0")}</span>
              {c.name}
            </div>
          ))}
          <svg className="pointer-events-none absolute inset-0" width={W} height={H}>
            <defs>
              <marker id="fm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--ink3)" />
              </marker>
              <marker id="fm-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--pri)" />
              </marker>
            </defs>
            {data.edges.map((e) => {
              const a = byId[e.from], b = byId[e.to];
              if (!a || !b) return null;
              const pa = pos(a), pb = pos(b);
              const on = !!chain && chain.has(e.to) && chain.has(e.from);
              let d: string;
              if (a.col === b.col) {
                // Same chapter: loop out to the right, into the gap between columns.
                const x = pa.x + COL_W, y1 = pa.y + NODE_H / 2, y2 = pb.y + NODE_H / 2, bend = Math.min(GAP_X - 10, 26 + Math.abs(b.row - a.row) * 8);
                d = `M${x},${y1} C${x + bend},${y1} ${x + bend},${y2} ${x},${y2}`;
              } else {
                const back = b.col < a.col;
                const x1 = back ? pa.x : pa.x + COL_W, y1 = pa.y + NODE_H / 2, x2 = back ? pb.x + COL_W : pb.x, y2 = pb.y + NODE_H / 2;
                const mid = (x1 + x2) / 2;
                d = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
              }
              return <path key={e.from + e.to} d={d} fill="none" strokeWidth={on ? 2.4 : 1.4} markerEnd={on ? "url(#fm-arrow-on)" : "url(#fm-arrow)"}
                style={{ stroke: on ? "var(--pri)" : "var(--ink3)", opacity: chain && !on ? 0.15 : on ? 1 : 0.55 }} />;
            })}
          </svg>
          {data.nodes.map((n) => {
            const p = pos(n);
            const [bg, bd] = TONE[n.status] || TONE["Not assessed"];
            const ready = !admin && n.state !== "done" && n.state !== "external" && (parents[n.id] || []).every((x) => byId[x]?.state === "done" || byId[x]?.state === "external");
            const dim = chain && !chain.has(n.id);
            return (
              <button
                key={n.id}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(n.id)}
                onBlur={() => setHover(null)}
                onClick={() => onPick?.(n)}
                title={[n.name, n.external, n.subtopics.length ? `Subtopics: ${n.subtopics.join(", ")}` : ""].filter(Boolean).join("\n")}
                className="absolute flex flex-col justify-center gap-0.5 rounded-xl px-3 text-left transition-opacity"
                style={{
                  left: p.x, top: p.y, width: COL_W, height: NODE_H, background: bg, opacity: dim ? 0.35 : 1,
                  border: `1.5px ${!n.published && admin ? "dashed" : "solid"} ${n.state === "current" ? "var(--pri)" : bd}`,
                  boxShadow: n.state === "current" ? "0 0 0 3px var(--pri-soft)" : undefined,
                }}
              >
                <span className="flex items-center gap-1.5">
                  {n.state === "done" && <Icon name="check_circle" size={15} fill style={{ color: "var(--ok)" }} />}
                  {n.state === "current" && <Icon name="play_circle" size={15} fill style={{ color: "var(--pri)" }} />}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{n.name}</span>
                </span>
                <span className="flex items-center gap-1.5 truncate text-[11px] text-ink2">
                  {n.external ? n.external : admin ? (n.published ? (n.subtopics.length ? `${n.subtopics.length} subtopic${n.subtopics.length === 1 ? "" : "s"}` : "No subtopics yet") : "Draft") : n.mastery !== null ? `${n.status} · ${n.mastery.toFixed(2)}` : "Not assessed yet"}
                  {n.due && <span className="rounded bg-warn-soft px-1 font-semibold text-warn-ink">Review due</span>}
                  {ready && n.state !== "current" && <span className="rounded bg-pri-soft px-1 font-semibold text-pri-ink">Ready</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink2">
        {!admin && (["Mastered", "Developing", "Weak", "Not assessed"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ background: TONE[s][0], border: `1.5px solid ${TONE[s][1]}` }} />{s}</span>
        ))}
        <span className="flex items-center gap-1.5"><svg width="26" height="8"><path d="M1,4 L20,4" stroke="var(--ink3)" strokeWidth="1.5" markerEnd="url(#fm-arrow)" /></svg>must know first</span>
        {admin && <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border-[1.5px] border-dashed border-line" />draft</span>}
        <span>Hover a topic to see everything it builds on.</span>
      </div>
    </div>
  );
}
