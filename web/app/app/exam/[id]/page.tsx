"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button, Card, ErrorState, Eyebrow, Field, Icon, Input, LinkButton, Loading, Pill, Ring, Tabs } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { toneOf } from "@/lib/utils";

type Topic = { id: string; name: string; status: string; prio: string; prereq: string; topic_id: string | null; unit?: string; sub?: string };
type Unit = { id: string; sub: string; name: string; topics: Topic[] };
type Exam = {
  id: string; name: string; full_name: string; description: string; target_session: string; hours: number; pct: number;
  subjects: { n: string; p: number; units: Unit[] }[]; tree: Unit[]; priority: Topic[]; revision_due: Topic[];
  plan_today: { t: string; d: number; s: string }[];
  strategy: { alloc: { n: string; f: number; h: number }[]; week: { d: string; blocks: { t: string; m: number; tone: string }[] }[]; hours: number };
  facts: { k: string; v: string; src: string; url: string; d: string; s: string }[]; dates_known: boolean;
};
const CYCLE = ["Not started", "Learning", "Revision due", "Confident"];
const SUBCOLORS = ["var(--pri)", "var(--teal)", "var(--warn)", "var(--ok)"];

export default function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: e, error, mutate } = useApi<Exam>(`/api/exams/${id}`);
  const [tab, setTab] = useState<"dashboard" | "syllabus" | "strategy" | "setup">("dashboard");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [hours, setHours] = useState(6);
  const [session, setSession] = useState("");
  useEffect(() => {
    if (e) {
      setHours(e.hours);
      setSession(e.target_session);
    }
  }, [e?.hours, e?.target_session]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!e) return <Loading />;

  const cycle = async (t: Topic) => {
    const nx = CYCLE[(CYCLE.indexOf(t.status) + 1) % CYCLE.length];
    await api.put(`/api/exams/${e.id}/topics/${t.id}`, { status: nx });
    if (nx === "Confident") toast("Topic marked Confident");
    mutate();
  };
  const markRevised = async (t: Topic) => {
    await api.put(`/api/exams/${e.id}/topics/${t.id}`, { status: "Confident" });
    toast("Marked revised");
    mutate();
  };
  const savePlan = async (h = hours) => {
    const r = await api.put<Exam>(`/api/exams/${e.id}/plan`, { hours_per_week: h, target_session: session });
    mutate(r, false);
    toast(`Plan regenerated for ${h} h a week`);
  };
  const focus = e.priority.map((t) => t.name).slice(0, 4);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>EXAM PREP{e.pct === 0 ? " · EXPLORING EARLY" : ""}</Eyebrow>
          <h1 className="my-1 font-display text-[32px] font-semibold leading-[1.15] tracking-[-0.02em]">{e.name}</h1>
          <div className="text-ink2">
            {e.full_name}
            {e.target_session ? ` · target session ${e.target_session}` : ""}
          </div>
        </div>
        <LinkButton href="/app/exam?switch=1" icon="swap_horiz">
          Switch exam
        </LinkButton>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { v: "dashboard", l: "Overview" },
          { v: "syllabus", l: "Syllabus map" },
          { v: "strategy", l: "Strategy" },
          { v: "setup", l: "Exam profile" },
        ]}
      />

      {tab === "dashboard" && (
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-5">
            <div className="flex flex-wrap items-center gap-6 rounded-[20px] border border-line bg-surface p-6">
              <Ring value={e.pct} size={128} stroke={11} color="var(--teal)" label={`${e.pct}%`} sub="syllabus" />
              <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-3.5">
                {e.subjects.map((x, i) => (
                  <div key={x.n}>
                    <div className="mb-1.5 flex justify-between text-[13px]">
                      <span className="font-semibold">{x.n}</span>
                      <span className="font-bold">{x.p}%</span>
                    </div>
                    <div className="h-2 rounded bg-surface2">
                      <div className="h-full rounded transition-[width]" style={{ width: `${x.p}%`, background: SUBCOLORS[i % SUBCOLORS.length] }} />
                    </div>
                  </div>
                ))}
                {!e.subjects.length && <div className="text-[13px] text-ink2">The syllabus for this exam hasn&apos;t been added yet.</div>}
                <div className="text-xs text-ink2">Progress counts Confident topics fully and partial credit for Learning and Revision due.</div>
              </div>
            </div>
            <Card>
              <div className="mb-2 flex items-baseline justify-between">
                <div className="font-display text-[17px] font-semibold">Today&apos;s preparation</div>
                <div className="text-[13px] text-ink2">{e.plan_today.reduce((a, p) => a + p.d, 0)} min</div>
              </div>
              {e.plan_today.length === 0 && <div className="border-t border-line py-3 text-[13px] text-ink2">Nothing to plan: every topic is marked Confident.</div>}
              {e.plan_today.map((p) => (
                <div key={p.t} className="flex items-center gap-3 border-t border-line py-[11px]">
                  <Icon name="check_box_outline_blank" size={22} className="text-ink3" />
                  <div className="min-w-0 flex-1 font-semibold">{p.t}</div>
                  <span className="text-xs text-ink2">{p.d} min</span>
                  <Pill tone={toneOf(p.s)}>{p.s}</Pill>
                </div>
              ))}
            </Card>
            <Card>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-display text-[17px] font-semibold">High-priority topics</div>
                <button onClick={() => setTab("syllabus")} className="border-0 bg-transparent font-semibold text-pri-ink">
                  Open syllabus map
                </button>
              </div>
              <div className="mb-2 text-xs text-ink2">Priority comes from the syllabus weights your content team set for this exam.</div>
              {e.priority.length === 0 && <div className="border-t border-line py-3 text-[13px] text-ink2">No high-priority topics left to work on.</div>}
              {e.priority.map((t) => (
                <div key={t.id} className="flex items-center gap-3 border-t border-line py-[11px]">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-ink2">
                      {t.sub} · {t.unit}
                    </div>
                  </div>
                  <button onClick={() => cycle(t)} className="border-0 bg-transparent p-0">
                    <Pill tone={toneOf(t.status)}>{t.status}</Pill>
                  </button>
                </div>
              ))}
            </Card>
          </div>
          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
            <Card>
              <div className="mb-2 flex items-center gap-2">
                <Icon name="replay" style={{ color: "var(--warn)" }} />
                <div className="font-display text-[17px] font-semibold">Revision due</div>
              </div>
              {e.revision_due.map((t) => (
                <div key={t.id} className="flex items-center gap-2.5 border-t border-line py-2.5">
                  <div className="flex-1 font-semibold">{t.name}</div>
                  <Button size="xs" onClick={() => markRevised(t)}>Mark revised</Button>
                </div>
              ))}
              {e.revision_due.length === 0 && <div className="py-3 text-[13px] text-ink2">All caught up. Nothing due today.</div>}
            </Card>
            <Card className="flex flex-col gap-3">
              <div className="font-display text-[17px] font-semibold">Exam facts</div>
              {e.facts.filter((f) => f.v).map((f) =>
                f.s === "Verified" ? (
                  <div key={f.k} className="rounded-xl border border-line px-3.5 py-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-ok-ink">
                      <Icon name="verified" size={16} fill />
                      Verified
                    </div>
                    <div className="mt-1 font-semibold">
                      {f.k}: {f.v}
                    </div>
                    <div className="mt-1 font-mono text-[11px] font-medium text-ink2">
                      Source: {f.url ? <a href={f.url} target="_blank" rel="noopener">{f.src}</a> : f.src} · verified {f.d}
                    </div>
                  </div>
                ) : (
                  <div key={f.k} className="rounded-xl px-3.5 py-3" style={{ background: f.s === "May be outdated" ? "var(--warn-soft)" : "var(--surface2)", color: f.s === "May be outdated" ? "var(--warn-ink)" : "var(--ink2)" }}>
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <Icon name={f.s === "May be outdated" ? "warning" : "help"} size={16} />
                      {f.s}
                    </div>
                    <div className="mt-1 font-semibold text-ink">
                      {f.k}: {f.v}
                    </div>
                    <div className="mt-1 font-mono text-[11px] font-medium">{f.s === "May be outdated" ? `Last verified ${f.d} · check the official site` : "Not yet checked against an official source"}</div>
                  </div>
                ),
              )}
              {!e.dates_known && (
                <div className="rounded-xl px-3.5 py-3 text-[13px] text-ink2" style={{ border: "1.5px dashed var(--line)" }}>
                  No dates configured{e.target_session ? ` for the ${e.target_session} session` : ""} yet. We only show milestones once they&apos;re verified.
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "syllabus" && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink2">
            <span className="font-semibold text-ink">Exam › Subject › Unit › Topic</span>
            <span className="flex-1" />
            Tap a status to update it:
            {CYCLE.map((c) => (
              <Pill key={c} tone={toneOf(c)}>{c}</Pill>
            ))}
          </div>
          {e.subjects.map((x, si) => (
            <div key={x.n} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <div className="font-display text-xl font-semibold">{x.n}</div>
                <div className="h-1.5 max-w-[200px] flex-1 rounded-[3px] bg-surface2">
                  <div className="h-full rounded-[3px]" style={{ width: `${x.p}%`, background: SUBCOLORS[si % SUBCOLORS.length] }} />
                </div>
                <span className="text-[13px] font-bold">{x.p}%</span>
              </div>
              {x.units.map((u) => {
                const open = !closed.has(u.id);
                const conf = u.topics.filter((t) => t.status === "Confident").length;
                return (
                  <div key={u.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
                    <button onClick={() => setClosed((c) => { const n = new Set(c); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n; })} className="flex w-full items-center gap-3 border-0 bg-transparent px-[18px] py-3.5 text-left">
                      <Icon name={open ? "expand_less" : "expand_more"} className="text-ink2" />
                      <div className="flex-1 font-bold">{u.name}</div>
                      <span className="text-xs text-ink2">
                        {conf} of {u.topics.length} confident
                      </span>
                    </button>
                    {open &&
                      u.topics.map((tp) => (
                        <div key={tp.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-t border-line py-3 pl-[50px] pr-[18px]">
                          <div className="min-w-0 flex-[1_1_200px]">
                            <div className="font-semibold">{tp.name}</div>
                            {tp.prereq && (
                              <div className="flex items-center gap-1 text-xs text-ink2">
                                <Icon name="subdirectory_arrow_right" size={14} />
                                Needs: {tp.prereq}
                              </div>
                            )}
                          </div>
                          <Pill tone={tp.prio === "High" ? "err" : tp.prio === "Medium" ? "warn" : "mute"} className="rounded-md text-[11px] font-bold">
                            {tp.prio} priority
                          </Pill>
                          <button onClick={() => cycle(tp)} className="border-0 bg-transparent p-0" title="Change status">
                            <Pill tone={toneOf(tp.status)} className="h-[30px] gap-1 px-2.5 font-bold">
                              {tp.status}
                              <Icon name="unfold_more" size={14} />
                            </Pill>
                          </button>
                          <div className="flex gap-1">
                            <Link title="Ask the tutor" href={`/app/tutor?q=${encodeURIComponent(`Explain ${tp.name}`)}`} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink hover:no-underline">
                              <Icon name="forum" size={17} />
                            </Link>
                            {tp.topic_id && (
                              <Link title="Practise" href={`/app/practice?topics=${tp.topic_id}`} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink hover:no-underline">
                                <Icon name="edit_note" size={17} />
                              </Link>
                            )}
                            <Link title="Search resources" href={`/app/search?q=${encodeURIComponent(tp.name)}`} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink hover:no-underline">
                              <Icon name="smart_display" size={17} />
                            </Link>
                          </div>
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {tab === "strategy" && (
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-[14px] bg-surface2 px-[18px] py-3.5 text-[13px] text-ink2">
            <Icon name="info" />
            <div>This is personalised study guidance built from your inputs. It can&apos;t guarantee a score or result; adjust it whenever it stops fitting your week.</div>
          </div>
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
              <Card className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between">
                  <div className="font-display text-[17px] font-semibold">Hours a week</div>
                  <div className="font-display text-[22px] font-semibold text-pri-ink">{hours} h</div>
                </div>
                <input type="range" min={1} max={40} value={hours} onChange={(ev) => setHours(+ev.target.value)} style={{ accentColor: "var(--pri)" }} />
                <div className="flex justify-between font-mono text-[11px] font-medium text-ink3">
                  <span>1 h</span>
                  <span>40 h</span>
                </div>
                <Button variant={hours !== e.hours ? "primary" : "secondary"} icon="refresh" onClick={() => savePlan()} className="h-[42px]">
                  Regenerate plan
                </Button>
              </Card>
              <Card className="flex flex-col gap-2.5">
                <div className="font-display text-[17px] font-semibold">Focus areas</div>
                <div className="flex flex-wrap gap-1.5">
                  {focus.length ? focus.map((f, i) => <Pill key={f} tone={i < 2 ? "pri" : "teal"}>{f}</Pill>) : <span className="text-[13px] text-ink2">No high-priority gaps.</span>}
                </div>
              </Card>
            </div>
            <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-5">
              <Card>
                <div className="mb-3 font-display text-[17px] font-semibold">Subject allocation · {e.strategy.hours} h / week</div>
                <div className="mb-3 flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]">
                  {e.strategy.alloc.map((a, i) => (
                    <div key={a.n} style={{ width: `${Math.round(a.f * 100)}%`, background: a.n === "Revision" ? "var(--warn)" : SUBCOLORS[i % SUBCOLORS.length] }} />
                  ))}
                </div>
                <div className="flex flex-wrap gap-[18px]">
                  {e.strategy.alloc.map((a, i) => (
                    <div key={a.n} className="flex items-center gap-2 text-[13px]">
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: a.n === "Revision" ? "var(--warn)" : SUBCOLORS[i % SUBCOLORS.length] }} />
                      {a.n} <strong>{a.h} h</strong>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <div className="mb-3 font-display text-[17px] font-semibold">Weekly plan</div>
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))" }}>
                  {e.strategy.week.map((d) => (
                    <div key={d.d} className="flex flex-col gap-1.5 rounded-xl bg-bg p-2.5">
                      <div className="font-mono text-xs font-semibold text-ink2">{d.d}</div>
                      {d.blocks.map((b, i) => (
                        <div key={i} className="rounded-lg p-2" style={{ background: `var(--${b.tone}-soft)`, color: `var(--${b.tone}-ink)` }}>
                          <div className="text-xs font-bold">{b.t}</div>
                          <div className="text-[11px]">{b.m} min</div>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div className="flex flex-col gap-1.5 rounded-xl p-2.5" style={{ border: "1.5px dashed var(--line)" }}>
                    <div className="font-mono text-xs font-semibold text-ink2">Sun</div>
                    <div className="text-xs text-ink2">Rest, or 15 min light review</div>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="mb-2 font-display text-[17px] font-semibold">Why this plan</div>
                <div className="text-sm leading-relaxed text-ink2">
                  Time is split by how much of each subject is left, weighted by the priority your content team set for each topic.
                  {e.strategy.alloc[0] && ` ${e.strategy.alloc[0].n} gets the most time because it has the most high-priority ground to cover.`} About 15% is kept for revision, and Saturdays close with a mixed review. Update topic statuses in the syllabus map and regenerate to rebalance.
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {tab === "setup" && (
        <Card className="flex max-w-[680px] flex-col gap-5 rounded-[18px] p-6">
          <div className="font-display text-xl font-semibold">Exam profile</div>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <Field label="Exam">
              <Input value={e.name} readOnly className="text-ink2" />
            </Field>
            <Field label="Target session" hint="e.g. 2028">
              <Input value={session} onChange={(ev) => setSession(ev.target.value)} placeholder="Year you plan to sit it" />
            </Field>
          </div>
          <Field label={`Hours you can study each week: ${hours} h`}>
            <input type="range" min={1} max={40} value={hours} onChange={(ev) => setHours(+ev.target.value)} style={{ accentColor: "var(--pri)" }} />
          </Field>
          <div className="text-[13px] text-ink2">Mark topics you&apos;re strong or weak in on the syllabus map; the strategy uses those statuses.</div>
          <Button variant="primary" className="h-11 self-start" onClick={async () => (await savePlan(), setTab("strategy"))}>
            Save and update strategy
          </Button>
        </Card>
      )}
    </div>
  );
}
