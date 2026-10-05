"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { RevisionPackButton } from "@/components/revision-pack";
import { Card, ErrorState, Icon, LinkButton, Loading, PageHead, Pill, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { linkFor } from "@/lib/links";
import { toneOf, type Tone } from "@/lib/utils";

type Progress = {
  stats: { v: string; l: string; s: string }[];
  subjects: { id: string; name: string; icon: string; tone: string; pct: number }[];
  heatmap: { subject: string; chapters: { n: string; name: string; cells: string[] }[] }[];
  insights: { icon: string; t: string; d: string; a: string; tone: Tone; link: Record<string, any> | null }[];
  weeks: { l: string; m: number; v: string; current: boolean }[];
};
type Mastery = { chapter: { id: string; name: string } | null; rows: { topic_id: string; t: string; p: number; ci: number; status: string; evidence: string; next: string; recall: number | null }[] };
type Curve = { topic: string; points: [number, number][]; reviews: number[]; today: number; next: number | null };
type Setup = { chapters: { id: string; name: string; subject: string }[] };

const TONES: Record<string, [string, string]> = {
  ok: ["var(--ok-soft)", "var(--ok)"], warn: ["var(--warn-soft)", "var(--warn)"], err: ["var(--err-soft)", "var(--err)"], mute: ["var(--surface2)", "var(--ink3)"],
};

function ForgettingCurve({ topicId }: { topicId: string | null }) {
  const { data: c } = useApi<Curve>(topicId ? `/api/progress/topics/${topicId}/curve` : null);
  if (!topicId) return <div className="text-[13px] text-ink2">Pick a topic you&apos;ve been quizzed on to see its forgetting curve.</div>;
  if (!c) return <Loading />;
  if (!c.points.length) return <div className="text-[13px] text-ink2">No reviews recorded for {c.topic} yet. Take a quiz and the curve appears here.</div>;
  const X = (d: number) => 30 + Math.min(d, 28) * 20;
  const Y = (r: number) => 16 + ((1 - Math.max(r, 0.4)) / 0.6) * 140;
  const path = c.points.filter(([d]) => d <= 28).map(([d, r], i) => `${i ? "L" : "M"}${X(d).toFixed(1)} ${Y(r).toFixed(1)}`).join(" ");
  return (
    <>
      <div className="overflow-auto">
        <svg width={600} height={190} viewBox="0 0 600 190" className="block h-auto max-w-full">
          <line x1={30} x2={590} y1={Y(0.7)} y2={Y(0.7)} strokeDasharray="4 4" style={{ stroke: "var(--warn)" }} />
          <text x={590} y={Y(0.7)} dy={-6} textAnchor="end" style={{ fill: "var(--warn-ink)", font: "600 11px var(--font-mono)" }}>70% recall</text>
          {c.today <= 28 && (
            <>
              <line x1={X(c.today)} x2={X(c.today)} y1={10} y2={160} style={{ stroke: "var(--ink3)" }} />
              <text x={X(c.today)} y={10} dx={4} style={{ fill: "var(--ink2)", font: "600 11px var(--font-mono)" }}>today</text>
            </>
          )}
          {c.next !== null && c.next <= 28 && (
            <>
              <line x1={X(c.next)} x2={X(c.next)} y1={10} y2={160} strokeDasharray="3 3" style={{ stroke: "var(--pri)" }} />
              <text x={X(c.next)} y={22} dx={4} style={{ fill: "var(--pri-ink)", font: "600 11px var(--font-mono)" }}>next review</text>
            </>
          )}
          <path d={path} fill="none" strokeWidth={2.5} style={{ stroke: "var(--pri)" }} />
          {c.reviews.filter((d) => d <= 28).map((d, i) => <circle key={i} cx={X(d)} cy={16} r={5} style={{ fill: "var(--pri)" }} />)}
          {[0, 7, 14, 21, 28].map((d) => (
            <text key={d} x={X(d)} y={182} textAnchor="middle" style={{ fill: "var(--ink3)", font: "500 10px var(--font-mono)" }}>Day {d}</text>
          ))}
        </svg>
      </div>
      <div className="flex gap-3.5 text-xs text-ink2">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-pri" />
          Review done
        </span>
        {c.next !== null && <span>Next review in {Math.max(0, Math.round(c.next - c.today))} days</span>}
      </div>
    </>
  );
}

export default function ProgressPage() {
  const router = useRouter();
  const { data: p, error, mutate } = useApi<Progress>("/api/progress");
  const { data: setup } = useApi<Setup>("/api/practice/setup");
  const [chapter, setChapter] = useState<string>("");
  const { data: m } = useApi<Mastery>(`/api/practice/mastery${chapter ? `?chapter_id=${chapter}` : ""}`);
  const [curveTopic, setCurveTopic] = useState<string | null>(null);
  const [subj, setSubj] = useState(0);
  useEffect(() => {
    if (m && !curveTopic) setCurveTopic(m.rows.find((r) => r.status !== "Not assessed")?.topic_id || null);
  }, [m, curveTopic]);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!p) return <Loading />;
  const maxW = Math.max(60, ...p.weeks.map((w) => w.m));
  const heat = p.heatmap[subj];
  const weakIds = m?.rows.filter((r) => r.status === "Weak" || r.status === "Developing").map((r) => r.topic_id) || [];

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="My progress" sub="Mastery is estimated from your quiz answers and tutor conversations. It isn't a prediction of marks." />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        {p.stats.map((x) => (
          <div key={x.l} className="rounded-2xl border border-line bg-surface p-[18px]">
            <div className="font-display text-[28px] font-semibold leading-none">{x.v}</div>
            <div className="mt-2 font-semibold">{x.l}</div>
            <div className="text-xs text-ink2">{x.s}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <Card className="min-w-0 flex-[1.6_1_520px]">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="font-display text-[17px] font-semibold">{m?.chapter?.name || "Topic mastery"} · topic mastery</div>
              <div className="text-xs text-ink2">The band shows how sure the estimate is. Tap a topic to see its forgetting curve.</div>
            </div>
            <div className="flex gap-2">
              {!!setup?.chapters.length && (
                <Select value={chapter || m?.chapter?.id || ""} onChange={(e) => (setChapter(e.target.value), setCurveTopic(null))} className="h-[34px] w-auto rounded-[9px] py-0 text-[13px]">
                  {setup.chapters.map((c) => (
                    <option key={c.id} value={c.id}>{c.subject} · {c.name}</option>
                  ))}
                </Select>
              )}
              {weakIds.length > 0 && (
                <>
                  <LinkButton href={`/app/practice?topics=${weakIds.join(",")}`} size="sm" variant="soft">
                    Practice weak topics
                  </LinkButton>
                  <RevisionPackButton topicIds={weakIds} variant="secondary" />
                </>
              )}
            </div>
          </div>
          {!m?.rows.length && <div className="border-t border-line py-3 text-[13px] text-ink2">No chapter to show yet.</div>}
          {m?.rows.map((r) => {
            const tone = toneOf(r.status);
            const [soft, solid] = TONES[tone] || TONES.mute;
            const lo = Math.max(0, r.p - r.ci);
            return (
              <button key={r.topic_id} onClick={() => setCurveTopic(r.topic_id)} className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-1.5 border-0 border-t border-line bg-transparent py-2.5 text-left" style={{ background: curveTopic === r.topic_id ? "var(--surface2)" : undefined }}>
                <div className="min-w-0 flex-[1_1_180px] px-1">
                  <div className="text-[13px] font-semibold">{r.t}</div>
                  <div className="text-[11px] text-ink2">{r.evidence}</div>
                </div>
                <div className="relative h-3.5 flex-[1_1_160px] rounded-[7px] bg-surface2">
                  <div className="absolute bottom-0 top-0 rounded-[7px]" style={{ left: `${Math.round(lo * 100)}%`, width: `${Math.round(Math.min(2 * r.ci, 1) * 100)}%`, background: soft }} />
                  <div className="absolute -bottom-0.5 -top-0.5 -ml-px w-[3px] rounded-sm" style={{ left: `${Math.round(r.p * 100)}%`, background: solid }} />
                </div>
                <span className="w-[74px] font-mono text-xs font-semibold">
                  {r.p.toFixed(2)} <span className="font-normal text-ink3">± {r.ci.toFixed(2)}</span>
                </span>
                <Pill tone={tone} className="w-[96px] justify-center text-[11px] font-bold">{r.status}</Pill>
                <span className="w-[92px] text-xs" style={{ color: r.next === "today" || r.next === "overdue" || r.next === "tomorrow" ? "var(--warn-ink)" : "var(--ink2)" }}>
                  Review {r.next}
                </span>
              </button>
            );
          })}
        </Card>
        <Card className="flex min-w-0 flex-[1_1_320px] flex-col gap-2.5">
          <div className="font-display text-[17px] font-semibold">Forgetting curve{curveTopic && m ? ` · ${m.rows.find((r) => r.topic_id === curveTopic)?.t || ""}` : ""}</div>
          <div className="text-xs text-ink2">Each review makes recall fade more slowly. The next review is set for when predicted recall drops below 90%, well before the 70% line.</div>
          <ForgettingCurve topicId={curveTopic} />
        </Card>
      </div>

      {p.insights.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="font-display text-[17px] font-semibold">What to do about it</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
            {p.insights.map((i) => (
              <div key={i.t} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-[18px]">
                <div className="grid h-9 w-9 place-items-center rounded-[10px]" style={{ background: `var(--${i.tone}-soft)`, color: `var(--${i.tone}-ink)` }}>
                  <Icon name={i.icon} />
                </div>
                <div className="font-bold">{i.t}</div>
                <div className="flex-1 text-[13px] text-ink2">{i.d}</div>
                {i.a && i.link && (
                  <button onClick={() => router.push(linkFor(i.link))} className="self-start border-0 bg-transparent p-0 font-bold text-pri-ink">
                    {i.a}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <Card className="min-w-0 flex-[1_1_300px]">
          <div className="mb-3 font-display text-[17px] font-semibold">Subjects</div>
          {p.subjects.map((x) => (
            <div key={x.id} className="border-t border-line py-2.5">
              <div className="mb-1.5 flex justify-between text-[13px]">
                <span className="font-semibold">{x.name}</span>
                <strong>{x.pct}%</strong>
              </div>
              <div className="h-2 rounded bg-surface2">
                <div className="h-full rounded" style={{ width: `${x.pct}%`, background: `var(--${x.tone})` }} />
              </div>
            </div>
          ))}
          {!p.subjects.length && <div className="border-t border-line py-3 text-[13px] text-ink2">No subjects yet.</div>}
        </Card>
        <Card className="min-w-0 flex-[1_1_300px]">
          <div className="flex items-baseline justify-between">
            <div className="font-display text-[17px] font-semibold">Learning time</div>
            <div className="text-xs text-ink2">Last 4 weeks</div>
          </div>
          <div className="mt-3.5 flex h-40 items-end gap-3.5">
            {p.weeks.map((k) => (
              <div key={k.l} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="font-mono text-[11px] font-medium text-ink2">{k.v}</div>
                <div className="w-full max-w-14 rounded-[8px_8px_4px_4px]" style={{ height: Math.max(4, Math.round((k.m / maxW) * 110)), background: k.current ? "var(--teal)" : "var(--teal-soft)" }} />
                <div className="text-xs text-ink2">{k.l}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {heat && (
        <Card>
          <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="font-display text-[17px] font-semibold">{heat.subject} · topic progress by chapter</div>
              {p.heatmap.length > 1 && (
                <Select value={subj} onChange={(e) => setSubj(+e.target.value)} className="h-8 w-auto rounded-lg py-0 text-[13px]">
                  {p.heatmap.map((h, i) => <option key={h.subject} value={i}>{h.subject}</option>)}
                </Select>
              )}
            </div>
            <div className="flex gap-3 text-xs text-ink2">
              {[["Done", "var(--pri)"], ["Revision due", "var(--warn)"], ["In progress", "var(--pri-soft)"]].map(([l, c]) => (
                <span key={l} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
                  {l}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {heat.chapters.map((c) => (
              <div key={c.n} className="flex items-center gap-3">
                <span className="w-5 font-mono text-[11px] font-medium text-ink3">{c.n}</span>
                <span className="min-w-0 flex-[0_1_280px] truncate text-[13px]">{c.name}</span>
                <div className="flex flex-wrap gap-[3px]">
                  {c.cells.map((x, i) => (
                    <span key={i} className="h-[18px] w-[18px] rounded" style={{ background: x === "done" ? "var(--pri)" : x === "due" ? "var(--warn)" : x === "current" ? "var(--pri-soft)" : "var(--surface2)" }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
