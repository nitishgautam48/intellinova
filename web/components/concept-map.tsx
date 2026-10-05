"use client";

import { useRef, useState } from "react";

import { Icon } from "@/components/ui";

export type MapNode = { id: string; l: string; t: string; x: number; y: number; main?: boolean };

/** Pan / zoom concept map (drag to pan, buttons to zoom), from the Study AI design. */
export function ConceptMap({ nodes, edges, onRead }: { nodes: MapNode[]; edges: string[][]; onRead?: () => void }) {
  const [sel, setSel] = useState(nodes.find((n) => !n.main)?.id || nodes[0]?.id);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const rel = edges.filter((e) => e.includes(sel)).map((e) => byId[e[0] === sel ? e[1] : e[0]]?.l).filter(Boolean);
  const cur = byId[sel];
  return (
    <div className="flex flex-wrap items-stretch gap-4">
      <div
        onPointerDown={(e) => (drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y })}
        onPointerMove={(e) => drag.current && setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y })}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
        className="relative h-[540px] min-w-0 flex-[1_1_520px] cursor-grab touch-none overflow-hidden rounded-[18px] border border-line bg-surface"
        style={{ backgroundImage: "radial-gradient(var(--line) 1px,transparent 1px)", backgroundSize: "22px 22px" }}
      >
        <div className="absolute left-0 top-0 h-[560px] w-[940px] origin-top-left" style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
          <svg width={940} height={560} className="absolute inset-0 overflow-visible">
            {edges.map(([a, b], i) => {
              const A = byId[a];
              const B = byId[b];
              if (!A || !B) return null;
              const act = a === sel || b === sel;
              return <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y} strokeWidth={act ? 2.2 : 1} style={{ stroke: act ? "var(--pri)" : "var(--ink3)", opacity: act ? 1 : 0.45 }} />;
            })}
          </svg>
          {nodes.map((n) => {
            const on = n.id === sel;
            const r = rel.includes(n.l);
            return (
              <button
                key={n.id}
                onPointerDown={(e) => (e.stopPropagation(), setSel(n.id))}
                onClick={() => setSel(n.id)}
                className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-3.5 py-[9px] font-bold shadow-card"
                style={{
                  left: n.x, top: n.y, fontSize: n.main ? 15 : 13,
                  border: `1.5px solid ${on || r ? "var(--pri)" : "var(--line)"}`,
                  background: on ? "var(--pri)" : n.main ? "var(--ink)" : r ? "var(--pri-soft)" : "var(--surface)",
                  color: on ? "var(--on-pri)" : n.main ? "var(--bg)" : r ? "var(--pri-ink)" : "var(--ink)",
                }}
              >
                {n.l}
              </button>
            );
          })}
        </div>
        <div className="absolute bottom-3 left-3 flex gap-1 rounded-xl border border-line bg-surface p-1">
          <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))} aria-label="Zoom out" className="h-8 w-8 rounded-lg border-0 bg-transparent">
            <Icon name="remove" size={18} />
          </button>
          <span className="grid w-12 place-items-center font-mono text-xs font-medium">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.15).toFixed(2)))} aria-label="Zoom in" className="h-8 w-8 rounded-lg border-0 bg-transparent">
            <Icon name="add" size={18} />
          </button>
          <button onClick={() => (setZoom(1), setPan({ x: 0, y: 0 }))} aria-label="Reset view" className="h-8 w-8 rounded-lg border-0 bg-transparent">
            <Icon name="center_focus_strong" size={18} />
          </button>
        </div>
        <div className="absolute right-3 top-3 rounded-md bg-surface px-2 py-1 font-mono text-[11px] font-medium text-ink3">Drag to pan · click a concept</div>
      </div>
      {cur && (
        <div className="flex min-w-[260px] flex-[0_1_300px] flex-col gap-3 rounded-[18px] border border-line bg-surface p-5">
          <div className="font-mono text-[11px] font-semibold tracking-[0.06em] text-pri-ink">SELECTED CONCEPT</div>
          <div className="font-display text-[22px] font-semibold">{cur.l}</div>
          <div className="text-sm leading-relaxed">{cur.t || "The central idea of this material."}</div>
          <div className="mt-1.5 text-xs font-bold text-ink2">Connected to</div>
          <div className="flex flex-wrap gap-1.5">
            {rel.map((r) => (
              <span key={r} className="rounded-full bg-pri-soft px-2.5 py-1 text-xs font-semibold text-pri-ink">
                {r}
              </span>
            ))}
          </div>
          {onRead && (
            <button onClick={onRead} className="mt-auto h-[38px] rounded-[10px] border border-line bg-surface font-semibold">
              Read in full notes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
