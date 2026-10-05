"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ResourceCard, type ResourceCardT } from "@/components/resource-card";
import { RevisionPackButton } from "@/components/revision-pack";
import { Button, Card, CardTitle, Empty, ErrorState, Eyebrow, Icon, LinkButton, Pill, Ring, Skeleton, Tag } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { linkFor } from "@/lib/links";
import type { Tone } from "@/lib/utils";

type Task = { id: string; title: string; meta: string; dur: string; why: string; tone: Tone; done: boolean; link: Record<string, any> };
type Dash = {
  name: string;
  date: string;
  chips: string[];
  streak: number;
  continue: null | { chapter_id: string; name: string; subject: string; pos: number; next: string | null; dots: { name: string; state: string }[]; done: number; total: number; pct: number; time_left: string };
  tasks: Task[];
  tasks_left: number;
  tasks_minutes: number;
  attention: { topic_id: string; name: string; sub: string; signal: string }[];
  recs: ResourceCardT[];
  week: { d: string; m: number; today: boolean }[];
  recent: { t: string; s: string; icon: string; link: Record<string, string> }[];
  exam: null | { id: string; name: string; target: string; pct: number; next: string | null };
  plan: null | { title: string; days_left: number; exam_date: string; fits: boolean };
  career: null | { id: string; t: string; icon: string }[];
  has_subjects: boolean;
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const router = useRouter();
  const { data: d, error, mutate } = useApi<Dash>("/api/dashboard");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!d)
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-16 w-80" />
        <div className="flex flex-wrap gap-5">
          <Skeleton className="h-56 flex-[2_1_560px]" />
          <Skeleton className="h-56 flex-[1_1_300px]" />
        </div>
      </div>
    );

  const toggleTask = async (t: Task) => {
    mutate({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) }, false);
    await api.post(`/api/dashboard/tasks/${t.id}/toggle`);
    if (!t.done) toast("Nice — task done");
    mutate();
  };
  const maxMin = Math.max(30, ...d.week.map((w) => w.m));
  const weekTotal = d.week.reduce((a, w) => a + w.m, 0);
  const best = [...d.week].sort((a, b) => b.m - a.m)[0];
  const c = d.continue;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-xs font-medium uppercase tracking-[0.04em] text-ink2">{d.date}</div>
          <h1 className="mb-2.5 mt-1.5 font-display text-[32px] font-semibold leading-[1.15] tracking-[-0.02em]">
            {greeting()}, {d.name}
          </h1>
          <div className="flex flex-wrap gap-1.5">
            {d.chips.map((c) => (
              <Tag key={c}>{c}</Tag>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            ["Ask Tutor", "forum", "/app/tutor"],
            ["Practice quiz", "quiz", "/app/practice"],
            ["Generate notes", "description", "/app/study"],
          ].map(([label, icon, href]) => (
            <Link key={href} href={href} className="flex h-10 flex-none items-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-surface pl-3 pr-3.5 font-semibold text-ink hover:border-pri hover:text-pri-ink hover:no-underline">
              <Icon name={icon} className="text-pri" />
              {label}
            </Link>
          ))}
        </div>
      </div>

      {!d.has_subjects && (
        <Empty icon="menu_book" title="No chapters for your class yet" action={<LinkButton href="/app/profile" size="sm">Check your subjects</LinkButton>}>
          Your school or content team hasn&apos;t published chapters for your board and class yet, or you haven&apos;t picked subjects. You can still use Ask Tutor and Study AI with your own material.
        </Empty>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-5">
          {c && (
            <div className="flex flex-wrap items-center justify-between gap-6 rounded-[20px] border border-line p-6" style={{ background: "linear-gradient(135deg,var(--pri-soft),var(--surface) 75%)" }}>
              <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
                <Eyebrow color="var(--pri-ink)">CONTINUE LEARNING</Eyebrow>
                <div>
                  <div className="font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em]">{c.name}</div>
                  <div className="mt-1 text-ink2">
                    {c.subject} · Chapter {c.pos}
                    {c.next && (
                      <>
                        {" "}· Up next: <strong className="text-ink">{c.next}</strong>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  {c.dots.map((x) => (
                    <div key={x.name} title={x.name} className="h-1.5 flex-1 rounded-[3px]" style={{ background: x.state === "done" ? "var(--pri)" : x.state === "current" ? "var(--teal)" : "var(--line)" }} />
                  ))}
                </div>
                <div className="text-[13px] text-ink2">
                  {c.done} of {c.total} topics · about {c.time_left} left
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <LinkButton href={`/app/learn/chapter/${c.chapter_id}`} variant="primary" size="lg" icon="play_arrow">
                    Continue
                  </LinkButton>
                  <LinkButton href="/app/study" size="lg">
                    Quick revision
                  </LinkButton>
                </div>
              </div>
              <Ring value={c.pct} label={`${c.pct}%`} sub="chapter" />
            </div>
          )}

          <Card>
            <CardTitle
              sub={d.tasks.length ? `${d.tasks_left} left · about ${d.tasks_minutes} min in total` : "Built each morning from your chapter, revision dates and weak topics."}
              right={
                <Link href="/app/plan" className="flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold">
                  <Icon name="event" size={16} />
                  {d.plan ? `${d.plan.title} · ${d.plan.days_left} day${d.plan.days_left === 1 ? "" : "s"} left` : "Set an exam date"}
                </Link>
              }
            >
              Today&apos;s plan
            </CardTitle>
            {d.tasks.length === 0 ? (
              <div className="border-t border-line py-4 text-[13px] text-ink2">Nothing planned yet. Start a chapter or take a quiz and your plan fills in.</div>
            ) : (
              d.tasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 border-t border-line py-3" style={{ opacity: t.done ? 0.55 : 1 }}>
                  <button onClick={() => toggleTask(t)} aria-label="Mark done" className="grid border-0 bg-transparent p-0" style={{ color: t.done ? "var(--ok)" : "var(--ink3)" }}>
                    <Icon name={t.done ? "check_box" : "check_box_outline_blank"} size={24} />
                  </button>
                  <button onClick={() => router.push(linkFor(t.link))} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left">
                    <div className="font-semibold" style={{ textDecoration: t.done ? "line-through" : "none" }}>
                      {t.title}
                    </div>
                    <div className="text-xs text-ink2">
                      {t.meta} · {t.dur}
                    </div>
                  </button>
                  <Pill tone={t.tone}>{t.why}</Pill>
                </div>
              ))
            )}
          </Card>

          {d.recs.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <div className="font-display text-[17px] font-semibold">Recommended for you</div>
                  <div className="text-[13px] text-ink2">Picked for {c?.name || "your chapter"} and your languages. Three at a time, never twenty.</div>
                </div>
                {c && (
                  <Link href={`/app/learn/chapter/${c.chapter_id}`} className="whitespace-nowrap font-semibold">
                    See all
                  </Link>
                )}
              </div>
              <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
                {d.recs.map((r) => (
                  <ResourceCard key={r.id} r={r} />
                ))}
              </div>
            </div>
          )}

          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="font-display text-[17px] font-semibold">This week</div>
              <div className="text-[13px] text-ink2">{weekTotal ? `${Math.floor(weekTotal / 60)} h ${weekTotal % 60} m studied · most on ${best.d}` : "No study time logged yet this week"}</div>
            </div>
            <div className="mt-4 flex h-[150px] items-end gap-2.5">
              {d.week.map((w) => (
                <div key={w.d} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="font-mono text-[11px] font-medium text-ink3">{w.m}m</div>
                  <div className="w-full max-w-[44px] rounded-[8px_8px_4px_4px]" style={{ height: Math.max(4, Math.round((w.m / maxMin) * 100)), background: w.today ? "var(--pri)" : "var(--pri-soft)" }} />
                  <div className="text-xs text-ink2" style={{ fontWeight: w.today ? 700 : 500 }}>
                    {w.d}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
          <Card>
            <div className="mb-1 flex items-center gap-2">
              <Icon name="error" style={{ color: "var(--warn)" }} />
              <div className="font-display text-[17px] font-semibold">Needs attention</div>
            </div>
            <div className="mb-2 flex items-center justify-between gap-2 text-[13px] text-ink2">
              Estimated from your quizzes and tutor chats.
              {d.attention.length > 0 && <RevisionPackButton topicIds={d.attention.map((k) => k.topic_id)} size="xs" />}
            </div>
            {d.attention.length === 0 ? (
              <div className="border-t border-line py-3 text-[13px] text-ink2">Nothing flagged yet. Take a quiz to get estimates.</div>
            ) : (
              d.attention.map((k) => (
                <div key={k.topic_id} className="flex items-center gap-3 border-t border-line py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{k.name}</div>
                    <div className="text-xs text-ink2">
                      {k.sub} · <span className="text-warn-ink">{k.signal}</span>
                    </div>
                  </div>
                  <LinkButton href={`/app/practice?topics=${k.topic_id}`} size="xs">
                    Review
                  </LinkButton>
                </div>
              ))
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Eyebrow>EXAM PREP</Eyebrow>
              {d.exam && <Pill tone="teal">{d.exam.pct >= 70 ? "On track" : d.exam.pct > 0 ? "In progress" : "Exploring"}</Pill>}
            </div>
            {d.exam ? (
              <>
                <div>
                  <div className="font-display text-xl font-semibold">{d.exam.name}</div>
                  <div className="text-[13px] text-ink2">{d.exam.target ? `Target session ${d.exam.target}` : "Set a target session in Exam Prep"}</div>
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between text-xs text-ink2">
                    <span>Syllabus progress</span>
                    <strong className="text-ink">{d.exam.pct}%</strong>
                  </div>
                  <div className="h-2 rounded bg-surface2">
                    <div className="h-full rounded bg-teal" style={{ width: `${d.exam.pct}%` }} />
                  </div>
                </div>
                {d.exam.next && (
                  <div className="text-[13px]">
                    Next up: <strong>{d.exam.next}</strong>
                  </div>
                )}
                <LinkButton href={`/app/exam/${d.exam.id}`} className="h-[38px]">
                  Open Exam Prep
                </LinkButton>
              </>
            ) : (
              <>
                <div className="text-[13px] text-ink2">Preparing for an entrance exam? Track its syllabus and get a weekly plan.</div>
                <LinkButton href="/app/exam" className="h-[38px]">
                  Choose an exam
                </LinkButton>
              </>
            )}
          </Card>

          {d.career !== null && (
            <Card className="flex flex-col gap-3">
              <Eyebrow>CAREER EXPLORATION</Eyebrow>
              {d.career.length ? (
                <>
                  <div className="text-[13px] text-ink2">Based on the interests you picked, these directions are worth a look:</div>
                  <div className="flex flex-col gap-2">
                    {d.career.map((x) => (
                      <Link key={x.id} href={`/app/career?node=${x.id}`} className="flex items-center gap-2.5 rounded-[10px] bg-surface2 px-3 py-2.5 text-ink hover:no-underline">
                        <Icon name={x.icon} className="text-pri" />
                        <span className="flex-1 font-semibold">{x.t}</span>
                        <Icon name="chevron_right" size={18} className="text-ink3" />
                      </Link>
                    ))}
                  </div>
                  <LinkButton href="/app/career?view=compare" variant="soft" className="h-[38px]">
                    Compare Class 11 combinations
                  </LinkButton>
                </>
              ) : (
                <>
                  <div className="text-[13px] text-ink2">Tell us what you enjoy and we&apos;ll show subjects, degrees and careers that fit.</div>
                  <LinkButton href="/app/career?view=interests" variant="soft" className="h-[38px]">
                    Start exploring
                  </LinkButton>
                </>
              )}
            </Card>
          )}

          <Card>
            <div className="mb-2 font-display text-[17px] font-semibold">Recently viewed</div>
            {d.recent.length === 0 ? (
              <div className="border-t border-line py-3 text-[13px] text-ink2">Chapters, resources and notes you open show up here.</div>
            ) : (
              d.recent.map((r) => (
                <Link key={r.t} href={linkFor(r.link)} target={r.link.screen === "resource" ? "_blank" : undefined} className="flex items-center gap-3 border-t border-line py-2.5 text-ink hover:no-underline">
                  <div className="grid h-9 w-9 flex-none place-items-center rounded-[9px] bg-surface2 text-ink2">
                    <Icon name={r.icon} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{r.t}</div>
                    <div className="text-xs text-ink2">{r.s}</div>
                  </div>
                </Link>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
