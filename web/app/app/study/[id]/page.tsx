"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConceptMap, type MapNode } from "@/components/concept-map";
import { SourceViewer } from "@/components/tutor";
import { Modal } from "@/components/ui/dialog";
import { Button, Card, ErrorState, Field, Icon, LinkButton, Loading, Select, Tabs, Textarea } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Section = { h: string; p: string; def: [string, string] | null; ex: string | null; src: { loc: string; unit_id: string; icon: string } };
type Outputs = {
  lang?: string; full?: Section[]; short?: string[]; key_points?: string[]; concepts?: { a: string; b: string; icon: string }[];
  formulas?: { n: string; f: string; u: string }[]; confusions?: { a: string; b: string }[]; map?: { nodes: MapNode[]; edges: string[][] };
  revision?: string[]; revision_checked?: number[]; audio_script?: string;
};
type Card_ = { id: string; front: string; back: string; topic: string; src: string; unit_id: string | null; due: string };
type Material = {
  id: string; t: string; s: string; when: string; status: string; fav: boolean; kind: string; icon: string; stage: number; steps: string[];
  error: string; outputs: Outputs; flashcards: Card_[]; source: { id: string; title: string; url: string } | null; audio_available: boolean;
};

const TABS = [
  ["full", "Full Notes", "description"],
  ["short", "Short Notes", "notes"],
  ["concepts", "Key Concepts", "lightbulb"],
  ["formulas", "Formulas", "function"],
  ["map", "Concept Map", "hub"],
  ["revision", "Revision Sheet", "fact_check"],
  ["flash", "Flashcards", "style"],
] as const;

function Processing({ m }: { m: Material }) {
  const router = useRouter();
  const pct = Math.round((Math.min(m.stage, 5) / 5) * 100);
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-[18px]">
      <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
        <div className="grid w-24 flex-none place-items-center rounded-[10px] text-ink3" style={{ aspectRatio: "16/10", background: "repeating-linear-gradient(135deg,var(--surface2) 0 8px,var(--stripe) 8px 16px)" }}>
          <Icon name={m.icon} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] font-semibold tracking-[0.05em] text-ok-ink">RESOURCE DETECTED</div>
          <div className="truncate font-bold">{m.t}</div>
          <div className="truncate text-xs text-ink2">{m.source?.url || m.s}</div>
        </div>
      </div>
      <Card className="rounded-[18px] p-[22px]">
        <div className="mb-2.5 flex items-baseline justify-between">
          <div className="font-display text-lg font-semibold">Building your study material</div>
          <div className="font-mono text-[13px] font-semibold text-pri-ink">{pct}%</div>
        </div>
        <div className="mb-[18px] h-1.5 rounded-[3px] bg-surface2">
          <div className="h-full rounded-[3px] bg-pri transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        {m.steps.map((l, i) => {
          const done = i < m.stage;
          const on = i === m.stage;
          return (
            <div key={l} className="flex items-center gap-3 py-[9px]">
              <Icon name={done ? "check_circle" : on ? "progress_activity" : "radio_button_unchecked"} size={22} style={{ color: done ? "var(--ok)" : on ? "var(--pri)" : "var(--ink3)", animation: on ? "spin 1s linear infinite" : "none" }} />
              <span className="flex-1" style={{ fontWeight: on ? 700 : 500, color: i <= m.stage ? "var(--ink)" : "var(--ink3)" }}>
                {l}
              </span>
              <span className="text-xs text-ink3">{done ? "Done" : on ? "Working…" : "Waiting"}</span>
            </div>
          );
        })}
        <div className="mt-3.5 flex flex-col gap-2">
          <div className="skeleton h-3 w-4/5" />
          <div className="skeleton h-3 w-3/5" />
        </div>
      </Card>
      <div className="flex justify-between text-[13px] text-ink2">
        <span>Longer videos can take a few minutes. You can leave this page; it keeps going.</span>
        <button onClick={() => router.push("/app/study")} className="border-0 bg-transparent font-semibold text-pri-ink">
          Back
        </button>
      </div>
    </div>
  );
}

function Failed({ m, retry }: { m: Material; retry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5 rounded-[20px] border border-line bg-surface p-8">
      <div className="grid h-[52px] w-[52px] place-items-center rounded-[14px] bg-err-soft text-err">
        <Icon name="link_off" size={28} />
      </div>
      <div className="font-display text-[22px] font-semibold">We couldn&apos;t read this resource</div>
      <div className="text-ink2">{m.error || "There's nothing reliable to build notes from. We won't guess content that isn't in the source."}</div>
      {m.source?.url && <div className="truncate rounded-[10px] bg-surface2 px-3 py-2.5 font-mono text-xs font-medium text-ink2">{m.source.url}</div>}
      <div className="flex flex-wrap gap-2">
        <LinkButton href="/app/study" variant="primary" size="lg">
          Try another source
        </LinkButton>
        <Button size="lg" onClick={retry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

function Flashcards({ cards }: { cards: Card_[] }) {
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  if (!cards.length) return <div className="text-ink2">No flashcards were generated for this material.</div>;
  const c = cards[i % cards.length];
  const rate = async (r: string) => {
    try {
      const res = await api.post<{ due: string }>(`/api/study/flashcards/${c.id}/review`, { rating: r });
      toast(`${r} · next review ${res.due}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setFlip(false);
    setI((i + 1) % cards.length);
  };
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5">
      <div className="flex items-center gap-2.5 rounded-xl bg-warn-soft px-3.5 py-3 text-[13px]">
        <Icon name="target" size={18} className="text-warn-ink" />
        Rate each card honestly. Reviews are spaced with FSRS so each comes back just before you&apos;d forget it.
      </div>
      <button onClick={() => setFlip(!flip)} className="flex min-h-[260px] flex-col justify-between rounded-[22px] border border-line p-7 text-left shadow-card transition-[background]" style={{ background: flip ? "var(--pri)" : "var(--surface)", color: flip ? "var(--on-pri)" : "var(--ink)" }}>
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] opacity-70">
          {flip ? "ANSWER" : "QUESTION"} · {c.topic}
        </span>
        <span className="font-display text-[26px] font-semibold leading-[1.3] [text-wrap:pretty]">{flip ? c.back : c.front}</span>
        <span className="flex justify-between font-mono text-xs font-medium opacity-75">
          <span>Source: {c.src}</span>
          <span>{c.due === "new" ? "New card" : `Due ${c.due}`} · Tap to flip</span>
        </span>
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <Button icon="arrow_back" onClick={() => (setFlip(false), setI((i + cards.length - 1) % cards.length))}>
          Back
        </Button>
        <span className="font-mono text-xs font-medium text-ink2">
          {(i % cards.length) + 1} of {cards.length}
        </span>
        <div className="flex gap-1.5">
          {(
            [
              ["Again", "err"],
              ["Hard", "warn"],
              ["Good", "teal"],
              ["Easy", "ok"],
            ] as const
          ).map(([l, t]) => (
            <button key={l} onClick={() => rate(l)} className="h-10 rounded-[10px] border-0 px-3 font-bold" style={{ background: `var(--${t}-soft)`, color: `var(--${t}-ink)` }}>
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AudioBrief({ m }: { m: Material }) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const script = m.outputs.audio_script || "";
  const minutes = Math.max(1, Math.round(script.split(/\s+/).length / 140));
  const play = async () => {
    if (playing) {
      audio.current?.pause();
      window.speechSynthesis?.cancel();
      setPlaying(false);
      return;
    }
    setPlaying(true);
    if (m.audio_available) {
      audio.current = new Audio(`/api/study/materials/${m.id}/audio`);
      audio.current.onended = () => setPlaying(false);
      audio.current.play().catch(() => setPlaying(false));
    } else if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(script);
      u.lang = m.outputs.lang === "hi" ? "hi-IN" : "en-IN";
      u.onend = () => setPlaying(false);
      window.speechSynthesis.speak(u);
    } else setPlaying(false);
  };
  if (!script) return null;
  return (
    <div className="flex items-center gap-3.5 rounded-[14px] border border-line px-3.5 py-3">
      <button onClick={play} aria-label="Play audio brief" className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full border-0 text-on-pri" style={{ background: "var(--grad)" }}>
        <Icon name={playing ? "pause" : "play_arrow"} size={24} fill />
      </button>
      <div className="min-w-0 flex-1">
        <div className="font-bold">Audio brief · about {minutes} min</div>
        <div className="text-xs text-ink2">{m.audio_available ? "Read by the IntelliNova voice" : "Read by your device's voice"}</div>
      </div>
    </div>
  );
}

export default function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: m, error, mutate } = useApi<Material>(`/api/study/materials/${id}`, { refreshInterval: (d) => (d?.status === "Processing" ? 2500 : 0) });
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("full");
  const [viewer, setViewer] = useState<string | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flag, setFlag] = useState({ category: "Factual error", note: "" });
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x[0] === t)) setTab(t as typeof tab);
  }, []);

  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!m) return <Loading />;
  if (m.status === "Processing") return <Processing m={m} />;
  if (m.status === "Failed") return <Failed m={m} retry={async () => (await api.post(`/api/study/materials/${m.id}/retry`), mutate())} />;
  const o = m.outputs;
  const checked = new Set(o.revision_checked || []);

  const toggleRev = async (i: number) => {
    const next = new Set(checked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    mutate({ ...m, outputs: { ...o, revision_checked: [...next] } }, false);
    await api.patch(`/api/study/materials/${m.id}`, { revision_checked: [...next] });
  };
  const sendFlag = async () => {
    await api.post(`/api/study/materials/${m.id}/flag`, flag);
    setFlagOpen(false);
    toast("Thanks. The content team will review it.");
    mutate();
  };
  const highlight = async (s: Section, i: number) => {
    await api.post(`/api/study/materials/${m.id}/highlights`, { text: s.p, section: i });
    toast("Highlighted and saved to this note");
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[13px] text-ink2">
            <Link href="/app/study/library" className="font-semibold">My study material</Link> · {m.s}
          </div>
          <h1 className="m-0 mb-2 mt-0.5 font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.02em]">{m.t}</h1>
          <div className="flex flex-wrap gap-1.5">
            <span className="flex items-center gap-1 rounded-full bg-pri-soft px-[9px] py-[3px] text-xs font-semibold text-pri-ink">
              <Icon name="auto_awesome" size={14} />
              AI-generated from 1 source
            </span>
            {m.source && (
              <span className="flex max-w-[360px] items-center gap-1 truncate rounded-full bg-surface2 px-[9px] py-[3px] text-xs font-semibold text-ink2">
                <Icon name={m.icon} size={14} />
                {m.source.title}
              </span>
            )}
            {m.status === "Flagged" && <span className="rounded-full bg-err-soft px-[9px] py-[3px] text-xs font-semibold text-err-ink">Flagged for review</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={async () => (await api.patch(`/api/study/materials/${m.id}`, { favorite: !m.fav }), mutate())} aria-label="Favourite" className="grid h-[38px] w-[38px] place-items-center rounded-[10px] border border-line bg-surface" style={{ color: m.fav ? "var(--warn)" : "var(--ink2)" }}>
            <Icon name="star" fill={m.fav} size={19} />
          </button>
          <a href={`/api/study/materials/${m.id}/export`} className="flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 font-semibold text-ink hover:no-underline">
            <Icon name="download" size={18} />
            Export
          </a>
          <a href={`/api/study/materials/${m.id}/slides`} className="flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 font-semibold text-ink hover:no-underline">
            <Icon name="slideshow" size={18} />
            Slides
          </a>
          <Button className="h-[38px]" icon="print" onClick={() => window.print()}>
            Print
          </Button>
          <Button className="h-[38px]" icon="flag" onClick={() => setFlagOpen(true)}>
            Report
          </Button>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={TABS.map(([v, l, icon]) => ({ v, l, icon }))} />

      {tab === "full" && (
        <div className="flex flex-wrap items-start gap-6">
          <div className="sticky top-0 hidden w-[200px] flex-none flex-col gap-0.5 text-[13px] xl:flex">
            <div className="mb-1.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-ink3">ON THIS PAGE</div>
            {o.full?.map((x, i) => (
              <a key={i} href={`#s${i}`} className="rounded-lg px-2.5 py-1.5 text-ink2 hover:bg-surface2 hover:no-underline">
                {x.h}
              </a>
            ))}
            {!!o.key_points?.length && <a href="#kp" className="px-2.5 py-1.5 text-ink2">Important points</a>}
          </div>
          <article className="flex min-w-0 max-w-[760px] flex-[1_1_480px] flex-col gap-[22px] rounded-[18px] border border-line bg-surface p-7">
            {o.full?.map((x, i) => (
              <section key={i} id={`s${i}`} className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <h2 className="m-0 font-display text-xl font-semibold">{x.h}</h2>
                    <button onClick={() => setViewer(x.src.unit_id)} className="flex h-6 items-center gap-1 rounded-md border-0 bg-surface2 px-2 font-mono text-[11px] font-medium text-ink2">
                      <Icon name={x.src.icon} size={14} />
                      {x.src.loc}
                    </button>
                  </div>
                  <button onClick={() => highlight(x, i)} aria-label="Highlight" className="h-8 w-8 rounded-lg border-0 bg-transparent text-ink3 hover:bg-warn-soft hover:text-warn-ink">
                    <Icon name="ink_highlighter" size={18} />
                  </button>
                </div>
                <p className="m-0 text-[15px] leading-[1.65] [text-wrap:pretty]">{x.p}</p>
                {x.def && (
                  <div className="rounded-xl bg-pri-soft px-4 py-3.5">
                    <div className="font-mono text-[11px] font-semibold tracking-[0.06em] text-pri-ink">DEFINITION · {x.def[0]}</div>
                    <div className="mt-1 text-sm">{x.def[1]}</div>
                  </div>
                )}
                {x.ex && (
                  <div className="rounded-xl border border-dashed border-line px-4 py-3.5">
                    <div className="font-mono text-[11px] font-semibold tracking-[0.06em] text-teal-ink">EXAMPLE</div>
                    <div className="mt-1 text-sm">{x.ex}</div>
                  </div>
                )}
              </section>
            ))}
            {!!o.key_points?.length && (
              <section id="kp" className="rounded-[14px] bg-warn-soft p-[18px]">
                <div className="mb-2 font-display text-base font-semibold text-warn-ink">Important points</div>
                <ul className="m-0 flex flex-col gap-1 pl-[18px]">
                  {o.key_points.map((k) => <li key={k}>{k}</li>)}
                </ul>
              </section>
            )}
          </article>
        </div>
      )}

      {tab === "short" && (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
          <Card>
            <div className="mb-2.5 font-display text-base font-semibold">Key points</div>
            {o.short?.map((k) => (
              <div key={k} className="flex gap-2.5 border-t border-line py-2 text-sm">
                <Icon name="arrow_right" size={18} className="text-pri" />
                {k}
              </div>
            ))}
          </Card>
          {!!o.formulas?.length && (
            <div className="flex flex-col gap-3">
              <div className="font-display text-base font-semibold">Formula cards</div>
              <div className="grid grid-cols-2 gap-2.5">
                {o.formulas.map((f) => (
                  <div key={f.f} className="rounded-xl border border-line bg-surface p-3.5">
                    <div className="text-xs text-ink2">{f.n}</div>
                    <div className="mt-1 font-mono text-[15px] font-semibold">{f.f}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!!o.confusions?.length && (
            <div className="rounded-2xl bg-err-soft p-5">
              <div className="mb-2.5 font-display text-base font-semibold text-err-ink">Common confusions</div>
              {o.confusions.map((c) => (
                <div key={c.a} className="py-2">
                  <div className="font-bold">{c.a}</div>
                  <div className="text-[13px]">{c.b}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "concepts" && (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))" }}>
          {o.concepts?.map((c, i) => (
            <div key={c.a} className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-[18px]">
              <div className="flex justify-between">
                <Icon name={c.icon} size={24} className="text-pri" />
                <span className="font-mono text-xs font-medium text-ink3">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div className="font-display text-[17px] font-semibold">{c.a}</div>
              <div className="text-[13px] text-ink2">{c.b}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "formulas" &&
        (o.formulas?.length ? (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {o.formulas.map((f) => (
              <div key={f.f} className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-5 py-3.5 last:border-b-0">
                <div className="w-[180px] font-semibold">{f.n}</div>
                <div className="min-w-[200px] flex-1 font-mono text-base font-semibold text-pri-ink">{f.f}</div>
                <div className="rounded-md bg-surface2 px-2 py-[3px] font-mono text-xs font-medium text-ink2">{f.u}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-ink2">This material has no formulas.</div>
        ))}

      {tab === "map" && o.map && <ConceptMap nodes={o.map.nodes} edges={o.map.edges} onRead={() => setTab("full")} />}

      {tab === "revision" && (
        <div className="flex max-w-[820px] flex-col gap-[22px] rounded-[18px] border border-line bg-surface p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-display text-[22px] font-semibold">Revision sheet · {m.t}</div>
            <div className="font-mono text-xs font-medium text-ink2">
              {checked.size} of {o.revision?.length || 0} checked
            </div>
          </div>
          <AudioBrief m={m} />
          {!!o.short?.length && (
            <div className="rounded-[14px] bg-teal-soft px-[18px] py-4 text-teal-ink">
              <div className="mb-1 font-bold">Quick recap</div>
              <div className="text-sm">{o.short.slice(0, 4).join(" ")}</div>
            </div>
          )}
          {!!o.formulas?.length && (
            <div>
              <div className="mb-2 font-display text-[15px] font-semibold">Must-know formulas</div>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
                {o.formulas.map((f) => (
                  <div key={f.f} className="rounded-[10px] bg-surface2 px-3 py-2.5 font-mono text-[13px] font-semibold">
                    {f.f}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1 font-display text-[15px] font-semibold">Can you…</div>
            {o.revision?.map((r, i) => (
              <button key={i} onClick={() => toggleRev(i)} className="flex w-full items-center gap-3 border-0 border-t border-line bg-transparent py-2.5 text-left">
                <Icon name={checked.has(i) ? "check_box" : "check_box_outline_blank"} size={22} style={{ color: checked.has(i) ? "var(--ok)" : "var(--ink3)" }} />
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "flash" && <Flashcards cards={m.flashcards} />}

      <Modal open={!!viewer} onOpenChange={() => setViewer(null)} title="Where this comes from" width={520}>
        <div className="flex flex-col gap-3.5">
          <SourceViewer unitId={viewer} n={1} />
        </div>
      </Modal>
      <Modal open={flagOpen} onOpenChange={setFlagOpen} title="Report a problem with these notes" footer={<Button variant="solid" onClick={sendFlag}>Send</Button>}>
        <div className="flex flex-col gap-3">
          <Field label="What's wrong?">
            <Select value={flag.category} onChange={(e) => setFlag({ ...flag, category: e.target.value })}>
              {["Factual error", "Incomplete", "Wrong class", "Confusing", "Other"].map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Details">
            <Textarea value={flag.note} onChange={(e) => setFlag({ ...flag, note: e.target.value })} placeholder="Quote the line and say what's wrong" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
