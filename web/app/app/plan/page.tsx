"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, Bar, Button, Card, CardTitle, Chip, Empty, ErrorState, Field, Icon, Input, Loading, PageHead, Pill } from "@/components/ui";
import { Confirm } from "@/components/ui/dialog";
import { api, useApi } from "@/lib/api";
import { linkFor } from "@/lib/links";
import type { Tone } from "@/lib/utils";

type Item = { key: string; kind: "learn" | "practice" | "review" | "mock"; topic_id: string; topic_ids?: string[]; name: string; subject: string; chapter: string; chapter_id: string; minutes: number; why: string; tone: Tone; done: boolean };
type Day = { date: string; final: boolean; minutes: number; items: Item[] };
type Schedule = {
  title: string; exam_date: string; days_left: number; minutes_per_day: number; subject_ids: string[]; chapter_ids: string[]; rest_days: number[];
  summary: { topics: number; to_learn: number; to_fix: number; reviews: number; study_days: number; final_from: string | null; fits: boolean; unscheduled: number; needed_per_day: number };
  forgetting: { topic_id: string; name: string; p: number; status: string; recall_now: number; recall_exam: number }[];
  days: Day[]; today: Item[]; done: number; total: number; past: boolean;
};
type Opt = { id: string; name: string; chapters: { id: string; name: string }[] };

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND: Record<Item["kind"], [string, string]> = { learn: ["menu_book", "Learn"], practice: ["quiz", "Practice"], review: ["replay", "Revise"], mock: ["assignment", "Mock test"] };
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const nice = (s: string, o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) => new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", o);
const link = (it: Item) => linkFor(it.kind === "learn" ? { screen: "learn", chapter_id: it.chapter_id } : { screen: "practice", topic_ids: it.topic_ids || [it.topic_id] });

function Setup({ initial, onSaved, onCancel }: { initial: Schedule | null; onSaved: (s: Schedule) => void; onCancel?: () => void }) {
  const { data: opts, error } = useApi<Opt[]>("/api/schedule/options");
  const tomorrow = iso(new Date(Date.now() + 86400000));
  const [title, setTitle] = useState(initial?.title || "");
  const [date, setDate] = useState(initial?.exam_date || "");
  const [mins, setMins] = useState(initial?.minutes_per_day || 60);
  const [subs, setSubs] = useState<string[]>(initial?.subject_ids || []);
  const [chs, setChs] = useState<string[]>(initial?.chapter_ids || []);
  const [rest, setRest] = useState<number[]>(initial?.rest_days || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (opts && !initial && !subs.length) setSubs(opts.map((o) => o.id));
  }, [opts, initial, subs.length]);
  if (error) return <ErrorState error={error} />;
  if (!opts) return <Loading />;
  if (!opts.length) return <Empty icon="menu_book" title="Pick your subjects first">Add subjects in your profile, then come back to plan for an exam.</Empty>;
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put<{ schedule: Schedule }>("/api/schedule", {
        title: title.trim() || "My exam", exam_date: date, minutes_per_day: mins, subject_ids: subs,
        chapter_ids: chs.filter((c) => opts.some((o) => subs.includes(o.id) && o.chapters.some((x) => x.id === c))), rest_days: rest,
      });
      toast.success("Schedule ready");
      onSaved(r.schedule);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex max-w-[760px] flex-col gap-5">
      <CardTitle sub="Tell us when the exam is and how much time you have. The plan is rebuilt every day from your mastery and predicted recall, so missed days are absorbed automatically.">
        {initial ? "Edit your exam schedule" : "Plan up to your exam"}
      </CardTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Exam name"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Physics unit test" maxLength={200} /></Field>
        <Field label="Exam date"><Input type="date" value={date} min={tomorrow} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Time per study day" hint="A realistic number beats an ambitious one. You can change it any time.">
        <div className="flex flex-wrap items-center gap-2">
          {[30, 45, 60, 90, 120].map((m) => (
            <Chip key={m} on={mins === m} onClick={() => setMins(m)} icon={false} className="h-[34px] px-3">{m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60} m` : ""}`}</Chip>
          ))}
          <Input type="number" aria-label="Minutes per day" min={15} max={600} value={mins} onChange={(e) => setMins(Math.max(15, Math.min(600, Number(e.target.value) || 15)))} className="h-[34px] w-[90px] rounded-full px-3 text-[13px]" />
          <span className="text-xs font-normal text-ink2">minutes</span>
        </div>
      </Field>
      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-semibold">What the exam covers</div>
        {opts.map((o) => (
          <div key={o.id} className="rounded-xl border border-line p-3">
            <div className="flex items-center justify-between gap-3">
              <Chip on={subs.includes(o.id)} onClick={() => setSubs(toggle(subs, o.id))} className="h-[34px]">{o.name}</Chip>
              {subs.includes(o.id) && <span className="text-xs text-ink2">{o.chapters.some((c) => chs.includes(c.id)) ? "Only the chapters ticked below" : "All chapters. Tick some to narrow it."}</span>}
            </div>
            {subs.includes(o.id) && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {o.chapters.map((c) => (
                  <Chip key={c.id} on={chs.includes(c.id)} onClick={() => setChs(toggle(chs, c.id))} className="h-8 px-2.5 text-xs">{c.name}</Chip>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <Field label="Days off" hint="No study is scheduled on these days.">
        <div className="flex flex-wrap gap-1.5">
          {WEEK.map((w, i) => <Chip key={w} on={rest.includes(i)} onClick={() => setRest(toggle(rest, i))} icon={false} className="h-8 px-3">{w}</Chip>)}
        </div>
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <Button variant="primary" icon="event_available" loading={busy} disabled={!date || !subs.length} onClick={save}>{initial ? "Rebuild schedule" : "Build my schedule"}</Button>
      </div>
    </Card>
  );
}

function ItemRow({ it, onToggle }: { it: Item; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3 border-t border-line py-3" style={{ opacity: it.done ? 0.55 : 1 }}>
      <button onClick={onToggle} aria-label={it.done ? "Mark not done" : "Mark done"} className="grid border-0 bg-transparent p-0" style={{ color: it.done ? "var(--ok)" : "var(--ink3)" }}>
        <Icon name={it.done ? "check_box" : "check_box_outline_blank"} size={24} />
      </button>
      <Link href={link(it)} className="min-w-0 flex-1 text-ink hover:no-underline">
        <div className="font-semibold" style={{ textDecoration: it.done ? "line-through" : "none" }}>{it.kind === "mock" ? it.name : `${KIND[it.kind][1]} ${it.name}`}</div>
        <div className="truncate text-xs text-ink2">{[it.subject, it.chapter].filter(Boolean).join(" · ")} · {it.minutes} min · {it.why}</div>
      </Link>
      <Pill tone={it.tone} icon={KIND[it.kind][0]}>{KIND[it.kind][1]}</Pill>
    </div>
  );
}

export default function PlanPage() {
  const { data, error, mutate } = useApi<{ schedule: Schedule | null }>("/api/schedule");
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const s = data.schedule;
  const set = (x: Schedule | null) => mutate({ schedule: x }, { revalidate: false });

  if (!s || edit || s.past) {
    return (
      <div className="flex flex-col gap-5">
        <PageHead title="Study plan" sub="A day-by-day schedule to your exam date, built from your weak topics and how fast you're likely to forget each one." />
        {s?.past && !edit && <Alert tone="warn" icon="event_busy">Your exam date ({nice(s.exam_date, { day: "numeric", month: "long" })}) has passed. Set the next one to get a new plan.</Alert>}
        <Setup initial={s} onSaved={(x) => (set(x), setEdit(false))} onCancel={s && !s.past ? () => setEdit(false) : undefined} />
      </div>
    );
  }

  const toggle = async (it: Item) => {
    try {
      const r = await api.post<{ done: boolean }>(`/api/schedule/items/${encodeURIComponent(it.key)}/toggle`);
      const flip = (x: Item) => (x.key === it.key ? { ...x, done: r.done } : x);
      set({ ...s, done: s.done + (r.done ? 1 : -1), today: s.today.map(flip), days: s.days.map((d) => ({ ...d, items: d.items.map(flip) })) });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const rebuild = async () => {
    setBusy(true);
    try {
      set((await api.post<{ schedule: Schedule }>("/api/schedule/rebuild")).schedule);
      toast.success("Plan rebuilt from your latest progress");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sm = s.summary;
  const todayIso = iso(new Date());
  const upcoming = s.days.filter((d) => d.date > todayIso);

  return (
    <div className="flex flex-col gap-5">
      <PageHead
        eyebrow="STUDY PLAN"
        title={s.title}
        sub={`Exam on ${nice(s.exam_date, { weekday: "long", day: "numeric", month: "long" })} · ${s.days_left} day${s.days_left === 1 ? "" : "s"} left · ${s.minutes_per_day} min a study day`}
        right={
          <>
            <Button size="sm" icon="refresh" loading={busy} onClick={rebuild}>Rebuild</Button>
            <Button size="sm" icon="edit" onClick={() => setEdit(true)}>Edit</Button>
            <Button size="sm" variant="ghost" icon="delete" onClick={() => setConfirm(true)}>Remove</Button>
          </>
        }
      />
      {!sm.fits && (
        <Alert tone="warn" icon="schedule">
          {sm.unscheduled} session{sm.unscheduled === 1 ? "" : "s"} don&apos;t fit before the final revision days at {s.minutes_per_day} min a day. About {sm.needed_per_day} min a day would cover everything, or narrow the chapters.
        </Alert>
      )}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        {[
          [sm.to_learn, "Topics to learn", "In course order"],
          [sm.to_fix, "Topics to strengthen", "Weak or untested"],
          [sm.reviews, "Spaced reviews", "Timed to your forgetting curve"],
          [sm.study_days, "Study days", sm.final_from ? `Final revision from ${nice(sm.final_from, { day: "numeric", month: "short" })}` : "No final window"],
        ].map(([v, l, sub]) => (
          <div key={String(l)} className="rounded-2xl border border-line bg-surface p-[18px]">
            <div className="font-display text-[28px] font-semibold leading-none">{v}</div>
            <div className="mt-2 font-semibold">{l}</div>
            <div className="text-xs text-ink2">{sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <Card className="min-w-0 flex-[1.4_1_440px]">
          <CardTitle sub={s.today.length ? `${s.today.filter((x) => !x.done).length} left · ${s.today.reduce((a, x) => a + x.minutes, 0)} min` : "Nothing scheduled today. Enjoy the break."}
            right={<span className="whitespace-nowrap text-xs text-ink2">{s.done}/{s.total} sessions done</span>}>
            Today
          </CardTitle>
          <Bar value={s.total ? (100 * s.done) / s.total : 0} className="mb-2" />
          {s.today.map((it) => <ItemRow key={it.key} it={it} onToggle={() => toggle(it)} />)}
        </Card>
        <Card className="min-w-0 flex-[1_1_300px]">
          <CardTitle sub="Predicted recall on exam day if you stop revising now (FSRS forgetting curve).">Forgetting risk</CardTitle>
          {s.forgetting.length === 0 ? (
            <div className="border-t border-line py-3 text-[13px] text-ink2">Take a quiz on a topic and its forgetting curve shows up here.</div>
          ) : (
            s.forgetting.map((f) => (
              <div key={f.topic_id} className="border-t border-line py-2.5">
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="min-w-0 truncate font-semibold">{f.name}</span>
                  <span className="whitespace-nowrap font-mono text-xs text-ink2">{Math.round(f.recall_now * 100)}% → <strong style={{ color: f.recall_exam < 0.7 ? "var(--err)" : "var(--ink)" }}>{Math.round(f.recall_exam * 100)}%</strong></span>
                </div>
                <div className="relative mt-1.5 h-1.5 rounded bg-surface2">
                  <div className="absolute inset-y-0 left-0 rounded bg-pri-soft" style={{ width: `${f.recall_now * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${f.recall_exam * 100}%`, background: f.recall_exam < 0.7 ? "var(--err)" : "var(--pri)" }} />
                </div>
              </div>
            ))
          )}
        </Card>
      </div>

      <div>
        <div className="mb-3 font-display text-[17px] font-semibold">Coming up</div>
        {upcoming.length === 0 ? (
          <div className="text-[13px] text-ink2">Today is your last study day. Good luck!</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))" }}>
            {upcoming.map((d) => (
              <div key={d.date} className="flex flex-col gap-2 rounded-2xl border bg-surface p-3.5" style={{ borderColor: d.final ? "var(--warn)" : "var(--line)" }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{nice(d.date)}</span>
                  <span className="font-mono text-[11px] text-ink3">{d.minutes} min</span>
                </div>
                {d.final && <Pill tone="warn" className="self-start">Final revision</Pill>}
                {d.items.length === 0 && <span className="text-xs text-ink3">Free</span>}
                {d.items.map((it) => (
                  <Link key={it.key} href={link(it)} className="flex items-center gap-2 text-[13px] text-ink hover:no-underline" style={{ opacity: it.done ? 0.5 : 1 }}>
                    <Icon name={KIND[it.kind][0]} size={16} style={{ color: `var(--${it.tone})` }} />
                    <span className="min-w-0 flex-1 truncate" title={`${it.why} · ${it.minutes} min`}>{it.name}</span>
                    <span className="font-mono text-[11px] text-ink3">{it.minutes}m</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <Confirm open={confirm} onOpenChange={setConfirm} title="Remove this schedule?" danger confirmLabel="Remove" onConfirm={async () => {
        setConfirm(false);
        await api.del("/api/schedule");
        set(null);
        toast.success("Schedule removed");
      }}>
        Today&apos;s plan goes back to following your chapters and revision dates.
      </Confirm>
    </div>
  );
}
