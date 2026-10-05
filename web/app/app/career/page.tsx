"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button, Card, Chip, Empty, Eyebrow, Icon, Loading, Pill, Tabs } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { toneOf } from "@/lib/utils";

type View = "landing" | "interests" | "combos" | "compare" | "graph";
type Profile = { profile: { likes: string[]; acts: string[]; unsure: string[]; ideas: string }; options: { likes: string[]; acts: string[]; unsure: string[]; ideas: string[] }; directions: Dir[] };
type Dir = { id: string; t: string; icon: string; summary: string };
type Combo = { id: string; name: string; summary: string; subs: string[]; dirs: string[]; req: { a: string; k: string; b: string }[]; cons: string; dims: Record<string, string> };
type Combos = { combinations: Combo[]; dimensions: { key: string; label: string; note: string }[] };
type Graph = { columns: { type: string; label: string; nodes: { id: string; l: string }[] }[]; edges: string[][] };
type NodeD = { id: string; l: string; type: string; d: string; facts: { a: string; k: string; b: string; src: string; url: string; v: string; stale: boolean }[] };

function Interests({ onCombos }: { onCombos: () => void }) {
  const { data, mutate } = useApi<Profile>("/api/careers/profile");
  const [p, setP] = useState<Profile["profile"] | null>(null);
  const [dirs, setDirs] = useState<Dir[]>([]);
  useEffect(() => {
    if (data && !p) {
      setP(data.profile);
      setDirs(data.directions);
    }
  }, [data, p]);
  if (!data || !p) return <Loading />;
  const save = async (np: typeof p) => {
    setP(np);
    const r = await api.put<{ directions: Dir[] }>("/api/careers/profile", np);
    setDirs(r.directions);
    mutate();
  };
  const tog = (k: "likes" | "acts" | "unsure", v: string) => save({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] });
  const group = (label: string, k: "likes" | "acts" | "unsure", opts: string[]) => (
    <div className="flex flex-col gap-2.5">
      <div className="font-bold">{label}</div>
      {opts.length ? (
        <div className="flex flex-wrap gap-2">
          {opts.map((v) => (
            <Chip key={v} icon={false} on={p[k].includes(v)} onClick={() => tog(k, v)}>
              {v}
            </Chip>
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-ink2">Options appear once your content team adds career data.</div>
      )}
    </div>
  );
  return (
    <div className="flex flex-wrap items-start gap-5">
      <Card className="flex min-w-0 flex-[2_1_480px] flex-col gap-[22px] rounded-[18px] p-6">
        {group("Interests you have", "likes", data.options.likes)}
        {group("Things you enjoy doing", "acts", data.options.acts)}
        {group("Subjects you dislike or feel unsure about", "unsure", data.options.unsure)}
        <div className="flex flex-col gap-2.5">
          <div className="font-bold">Do you already have career ideas?</div>
          <div className="flex flex-wrap gap-2">
            {data.options.ideas.map((v) => (
              <Chip key={v} icon={false} on={p.ideas === v} onClick={() => save({ ...p, ideas: v })} className="rounded-[10px]">
                {v}
              </Chip>
            ))}
          </div>
        </div>
      </Card>
      <Card className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 rounded-[18px] p-[22px]">
        <div className="font-display text-[17px] font-semibold">Directions to explore</div>
        <div className="text-xs text-ink2">Suggestions to look into, not decisions.</div>
        {dirs.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-xl bg-surface2 p-3">
            <Icon name={d.icon} size={22} className="text-pri" />
            <div className="flex-1">
              <div className="font-bold">{d.t}</div>
              {d.summary && <div className="text-xs text-ink2">{d.summary}</div>}
            </div>
          </div>
        ))}
        {dirs.length === 0 && <div className="rounded-xl p-4 text-[13px] text-ink2" style={{ border: "1.5px dashed var(--line)" }}>Pick at least one interest and directions will appear here.</div>}
        <Button variant="primary" className="mt-1 h-[42px]" onClick={onCombos}>
          See matching combinations
        </Button>
      </Card>
    </div>
  );
}

function CareerInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState<View>((params.get("view") as View) || (params.get("node") ? "graph" : "landing"));
  const { data: combos } = useApi<Combos>(view === "combos" || view === "compare" || view === "landing" ? "/api/careers/combinations" : null);
  const { data: graph } = useApi<Graph>(view === "graph" ? "/api/careers/graph" : null);
  const [cmp, setCmp] = useState<string[]>([]);
  const [sel, setSel] = useState<string | null>(params.get("node"));
  const [reverse, setReverse] = useState(false);
  const { data: node } = useApi<NodeD>(sel && view === "graph" ? `/api/careers/nodes/${sel}` : null);
  const go = (v: View) => {
    setView(v);
    router.replace(`/app/career?view=${v}`, { scroll: false });
  };
  useEffect(() => {
    if (combos && cmp.length < 2) setCmp(combos.combinations.slice(0, 2).map((c) => c.id));
  }, [combos]); // eslint-disable-line react-hooks/exhaustive-deps

  const layout = useMemo(() => {
    if (!graph) return null;
    const cols = reverse ? [...graph.columns].reverse() : graph.columns;
    const CW = 180, GAP = 54, NH = 44, RH = 58;
    const pos: Record<string, { x: number; y: number; col: number; l: string }> = {};
    cols.forEach((c, i) => c.nodes.forEach((n, j) => (pos[n.id] = { x: i * (CW + GAP), y: 40 + j * RH, col: i, l: n.l })));
    const down = new Set<string>(sel ? [sel] : []);
    const up = new Set<string>(sel ? [sel] : []);
    let ch = true;
    while (ch && sel) {
      ch = false;
      for (const [a, b] of graph.edges) {
        if (down.has(a) && !down.has(b)) (down.add(b), (ch = true));
        if (up.has(b) && !up.has(a)) (up.add(a), (ch = true));
      }
    }
    const rel = new Set([...down, ...up]);
    const h = Math.max(...cols.map((c) => c.nodes.length), 1) * RH + 60;
    return { cols, pos, rel, down, up, CW, NH, GAP, w: cols.length * (CW + GAP) - GAP, h };
  }, [graph, reverse, sel]);

  const cA = combos?.combinations.find((c) => c.id === cmp[0]);
  const cB = combos?.combinations.find((c) => c.id === cmp[1]);
  const toggleCmp = (id: string) => setCmp((x) => (x.includes(id) ? x : [id, x[0]].filter(Boolean) as string[]));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Eyebrow>CAREER EXPLORER</Eyebrow>
        <h1 className="my-1 font-display text-[32px] font-semibold leading-[1.15] tracking-[-0.02em]">Explore what comes next</h1>
        <div className="text-ink2">Subjects, combinations, degrees and careers. You decide; we help you see the trade-offs.</div>
      </div>
      <Tabs value={view} onChange={go} tabs={[{ v: "landing", l: "Start" }, { v: "interests", l: "Interests" }, { v: "combos", l: "Combinations" }, { v: "compare", l: "Compare" }, { v: "graph", l: "Pathways" }]} />

      {view === "landing" && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
            {(
              [
                ["A", "I know what I'm interested in", "Start from subjects and activities you like, and see which combinations and degrees connect to them.", "Start with interests", "pri"],
                ["B", "I'm not sure yet", "Answer a few light questions about what you enjoy doing. No right answers, and nothing is final.", "Explore gently", "teal"],
              ] as const
            ).map(([k, t, d, cta, tone]) => (
              <button key={k} onClick={() => go("interests")} className="flex flex-col gap-3.5 rounded-[22px] border border-line p-7 text-left hover:border-pri" style={{ background: `linear-gradient(160deg,var(--${tone}-soft),var(--surface) 70%)` }}>
                <div className="font-mono text-[13px] font-semibold" style={{ color: `var(--${tone}-ink)` }}>{k}</div>
                <div className="font-display text-2xl font-semibold leading-[1.2]">{t}</div>
                <div className="text-ink2">{d}</div>
                <span className="mt-1.5 flex items-center gap-1.5 font-bold" style={{ color: `var(--${tone}-ink)` }}>
                  {cta}
                  <Icon name="arrow_forward" size={18} />
                </span>
              </button>
            ))}
          </div>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
            {(
              [
                ["view_module", "Subject combinations", `${combos?.combinations.length ?? "…"} to explore`, "combos"],
                ["compare_arrows", "Compare two options", `Side by side, across ${combos?.dimensions.length ?? "…"} directions`, "compare"],
                ["account_tree", "Pathway map", "Interest to career, or career back to subjects", "graph"],
              ] as const
            ).map(([i, t, d, v]) => (
              <button key={v} onClick={() => go(v)} className="flex items-center gap-3 rounded-[14px] border border-line bg-surface p-4 text-left">
                <Icon name={i} size={24} className="text-pri" />
                <div>
                  <div className="font-bold">{t}</div>
                  <div className="text-xs text-ink2">{d}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {view === "interests" && <Interests onCombos={() => go("combos")} />}

      {view === "combos" &&
        (!combos ? (
          <Loading />
        ) : combos.combinations.length === 0 ? (
          <Empty icon="view_module" title="No combinations added yet">Your content team hasn&apos;t added subject combinations yet.</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="text-[13px] text-ink2">None of them is “best”; each keeps different doors open.</div>
            <div className="grid items-start gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
              {combos.combinations.map((c, i) => {
                const inCmp = cmp.includes(c.id);
                return (
                  <Card key={c.id} className="flex flex-col gap-3.5 rounded-[18px] p-[22px]">
                    <span className="font-mono text-xs font-semibold text-ink3">OPTION {String.fromCharCode(65 + i)}</span>
                    <div className="font-display text-xl font-semibold leading-[1.2]">{c.name}</div>
                    {!!c.subs.length && (
                      <div className="flex flex-wrap gap-1.5">
                        {c.subs.map((x) => <span key={x} className="rounded-lg bg-surface2 px-[9px] py-1 text-xs font-semibold">{x}</span>)}
                      </div>
                    )}
                    {!!c.dirs.length && (
                      <div>
                        <div className="mb-1.5 text-xs font-bold text-ink2">Can support</div>
                        <div className="flex flex-col gap-1">
                          {c.dirs.map((x) => (
                            <div key={x} className="flex items-center gap-2 text-[13px]">
                              <Icon name="arrow_outward" size={16} className="text-teal" />
                              {x}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {c.req.map((r, j) => (
                      <div key={j} className="flex items-start gap-2 text-[13px]">
                        <Pill tone={toneOf(r.k)} className="rounded-md text-[11px] font-bold">{r.k}</Pill>
                        <span><strong>{r.a}</strong> {r.b}</span>
                      </div>
                    ))}
                    {c.cons && (
                      <div className="rounded-[10px] bg-warn-soft p-3 text-[13px]">
                        <strong className="text-warn-ink">Consider: </strong>
                        {c.cons}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="primary" className="flex-1" onClick={() => (setSel(c.id), go("graph"))}>Explore pathways</Button>
                      <Button size="md" onClick={() => toggleCmp(c.id)} style={{ background: inCmp ? "var(--pri-soft)" : undefined, color: inCmp ? "var(--pri-ink)" : undefined }} className="text-[13px]">
                        {inCmp ? "In comparison" : "Add to compare"}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
            <Button className="self-start" icon="compare_arrows" onClick={() => go("compare")}>Compare selected</Button>
          </div>
        ))}

      {view === "compare" &&
        (!combos ? (
          <Loading />
        ) : combos.combinations.length < 2 ? (
          <Empty icon="compare_arrows" title="Nothing to compare yet">At least two subject combinations are needed.</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
              {[0, 1].map((slot) => (
                <Card key={slot} className="rounded-[14px] p-4">
                  <div className="mb-2 font-mono text-xs font-semibold" style={{ color: slot ? "var(--teal-ink)" : "var(--pri-ink)" }}>OPTION {slot ? "B" : "A"}</div>
                  <div className="flex flex-col gap-1.5">
                    {combos.combinations.map((c) => {
                      const on = cmp[slot] === c.id;
                      const other = cmp[1 - slot] === c.id;
                      return (
                        <button key={c.id} disabled={other} onClick={() => setCmp((x) => { const y = [...x]; y[slot] = c.id; return y; })} className="h-[38px] rounded-[10px] px-3 text-left text-[13px] font-semibold disabled:opacity-40" style={{ border: `1.5px solid ${on ? "var(--pri)" : "var(--line)"}`, background: on ? "var(--pri-soft)" : "var(--surface)", color: on ? "var(--pri-ink)" : "var(--ink)" }}>
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
            {cA && cB && (
              <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
                <div className="grid gap-3 bg-surface2 px-[18px] py-3.5 text-[13px] font-bold" style={{ gridTemplateColumns: "minmax(120px,1fr) minmax(0,1fr) minmax(0,1fr)" }}>
                  <span>Direction</span>
                  <span>{cA.name}</span>
                  <span>{cB.name}</span>
                </div>
                {combos.dimensions.map((d) => (
                  <div key={d.key} className="border-t border-line px-[18px] py-3.5">
                    <div className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(120px,1fr) minmax(0,1fr) minmax(0,1fr)" }}>
                      <span className="font-semibold">{d.label}</span>
                      {[cA, cB].map((c) => (
                        <span key={c.id}>
                          {c.dims[d.key] ? <Pill tone={toneOf(c.dims[d.key])} className="font-bold">{c.dims[d.key]}</Pill> : <span className="text-xs text-ink3">Not rated</span>}
                        </span>
                      ))}
                    </div>
                    {d.note && <div className="mt-1.5 text-xs text-ink2">{d.note}</div>}
                  </div>
                ))}
                {combos.dimensions.length === 0 && <div className="border-t border-line p-5 text-[13px] text-ink2">No comparison dimensions have been set up yet.</div>}
              </div>
            )}
            <div className="flex gap-3 rounded-[14px] bg-teal-soft px-[18px] py-4 text-[13px] text-teal-ink">
              <Icon name="balance" />
              <div>These labels describe how directly each combination leads to a direction. “Limited” means extra steps later, not a closed door. Talk it through with a teacher or parent too.</div>
            </div>
          </div>
        ))}

      {view === "graph" &&
        (!layout ? (
          <Loading />
        ) : layout.cols.every((c) => !c.nodes.length) ? (
          <Empty icon="account_tree" title="No pathway data yet">Your content team hasn&apos;t added career pathways yet.</Empty>
        ) : (
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="font-mono text-xs font-medium text-ink2">{layout.cols.map((c) => c.label).join(" › ")}</div>
              <Button icon="swap_horiz" onClick={() => setReverse(!reverse)}>{reverse ? "Start from interests" : "Start from a career"}</Button>
            </div>
            <div className="flex flex-wrap items-stretch gap-4">
              <div className="min-w-0 flex-[1_1_560px] overflow-auto rounded-[18px] border border-line bg-surface p-5">
                <div className="relative" style={{ width: layout.w, height: layout.h }}>
                  {layout.cols.map((c, i) => (
                    <div key={c.type} className="absolute top-0 w-[180px] font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-ink3" style={{ left: i * (layout.CW + layout.GAP) }}>
                      {c.label}
                    </div>
                  ))}
                  <svg width={layout.w} height={layout.h} className="absolute inset-0">
                    {graph!.edges.map(([a, b], i) => {
                      let A = layout.pos[a];
                      let B = layout.pos[b];
                      if (!A || !B) return null;
                      if (A.col > B.col) [A, B] = [B, A];
                      const x1 = A.x + layout.CW, y1 = A.y + layout.NH / 2, x2 = B.x, y2 = B.y + layout.NH / 2;
                      const act = sel && ((layout.down.has(a) && layout.down.has(b)) || (layout.up.has(a) && layout.up.has(b)));
                      return <path key={i} d={`M${x1} ${y1} C${x1 + 30} ${y1},${x2 - 30} ${y2},${x2} ${y2}`} fill="none" strokeWidth={act ? 2 : 1.25} style={{ stroke: act ? "var(--pri)" : "var(--line)", transition: "stroke .2s" }} />;
                    })}
                  </svg>
                  {Object.entries(layout.pos).map(([id, p]) => {
                    const on = id === sel;
                    const r = !sel || layout.rel.has(id);
                    return (
                      <button key={id} onClick={() => setSel(id)} title={p.l} className="absolute h-11 w-[180px] truncate whitespace-nowrap rounded-xl px-3 text-left text-[13px] font-bold transition-all" style={{ left: p.x, top: p.y, border: `1.5px solid ${on || (sel && r) ? "var(--pri)" : "var(--line)"}`, background: on ? "var(--pri)" : sel && r ? "var(--pri-soft)" : "var(--surface)", color: on ? "var(--on-pri)" : sel && r ? "var(--pri-ink)" : "var(--ink2)", opacity: r ? 1 : 0.55 }}>
                        {p.l}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex min-w-[270px] flex-[0_1_320px] flex-col gap-3 rounded-[18px] border border-line bg-surface p-5">
                {!sel || !node ? (
                  <div className="text-[13px] text-ink2">Select a node to see how it connects, and the verified requirements behind each step.</div>
                ) : (
                  <>
                    <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-ink2">{node.type}</div>
                    <div className="font-display text-[22px] font-semibold leading-[1.2]">{node.l}</div>
                    {node.d && (
                      <div className="rounded-xl bg-pri-soft p-3">
                        <div className="mb-1 flex items-center gap-1 font-mono text-[10px] font-semibold tracking-[0.06em] text-pri-ink">
                          <Icon name="info" size={14} />
                          ABOUT
                        </div>
                        <div className="text-[13px] leading-[1.55]">{node.d}</div>
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-1 font-mono text-[10px] font-semibold tracking-[0.06em] text-ok-ink">
                      <Icon name="verified" size={14} fill />
                      REQUIREMENTS
                    </div>
                    {node.facts.map((f, i) => (
                      <div key={i} className="flex flex-col gap-1.5 rounded-xl border border-line p-3">
                        <div className="flex items-center gap-1.5">
                          <Pill tone={toneOf(f.k)} className="rounded-md text-[11px] font-bold">{f.k}</Pill>
                          {f.stale && <Pill tone="warn" icon="warning" className="rounded-md text-[11px] font-bold">May be outdated</Pill>}
                        </div>
                        <div className="text-[13px]">
                          <strong>{f.a}</strong> {f.b}
                        </div>
                        <div className="font-mono text-[11px] font-medium text-ink2">
                          {f.url ? <a href={f.url} target="_blank" rel="noopener">{f.src}</a> : f.src} · {f.v}
                        </div>
                      </div>
                    ))}
                    {node.facts.length === 0 && <div className="rounded-xl p-3 text-[13px] text-ink2" style={{ border: "1.5px dashed var(--line)" }}>No verified requirements recorded for this node yet.</div>}
                    <Button className="mt-auto" icon="bookmark" onClick={async () => (await api.post("/api/careers/save", { node_id: node.id }), toast("Saved to your pathways"))}>
                      Save this pathway
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}

export default function CareerPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CareerInner />
    </Suspense>
  );
}
