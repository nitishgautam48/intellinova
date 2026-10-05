"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";

import { SourceViewer } from "@/components/tutor";
import { Modal } from "@/components/ui/dialog";
import { Alert, Button, Card, ErrorState, Eyebrow, Icon, LinkButton, Loading, Pill, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { f2, toneOf, type Tone } from "@/lib/utils";

type Item = {
  id: string; position: number; type: string; topic: string; topic_id: string; difficulty: string; question: string; options: string[]; unit: string;
  source: { loc: string; type: string; icon: string; unit_id: string | null; title: string };
  response: string | null; answered: boolean;
  grade?: "correct" | "partial" | "wrong"; answer?: string; explanation?: string; rubric?: { t: string; hit: boolean }[];
  misconception?: string; mastery_before?: number | null; mastery_after?: number | null;
};
type Summary = {
  counts: { correct: number; partial: number; wrong: number }; total: number;
  topics: { t: string; b: number; a: number }[]; weak: { t: string; m: number }[];
  misconceptions: { t: string; ev: string; loc: string; unit_id: string | null }[];
  review: { n: string; grade: string; t: string; topic: string; loc: string; type: string }[];
};
type Quiz = { id: string; title: string; mode: string; status: string; error: string; n: number; items: Item[]; current: number; time_left: number | null; summary: Summary | null };

const RT: Record<string, [string, string, Tone]> = {
  correct: ["check_circle", "Correct", "ok"],
  partial: ["adjust", "Partly correct", "warn"],
  wrong: ["cancel", "Not quite", "err"],
};
const TONE_BG: Record<Tone, [string, string]> = {
  ok: ["var(--ok-soft)", "var(--ok-ink)"], warn: ["var(--warn-soft)", "var(--warn-ink)"], err: ["var(--err-soft)", "var(--err-ink)"],
  pri: ["var(--pri-soft)", "var(--pri-ink)"], teal: ["var(--teal-soft)", "var(--teal-ink)"], mute: ["var(--surface2)", "var(--ink2)"],
};

function Preparing({ q }: { q: Quiz }) {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center gap-4 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-pri-soft text-pri">
        <Spinner size={30} />
      </span>
      <div className="font-display text-2xl font-semibold">Preparing your {q.mode === "Diagnostic" ? "diagnostic" : "questions"}</div>
      <div className="max-w-[48ch] text-ink2">
        Writing questions from your class material, checking every answer key with a solver and a second model, and removing near-duplicates. This can take a minute the first time a topic is practised.
      </div>
    </div>
  );
}

function Timer({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
  }, [seconds]);
  useEffect(() => {
    const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const m = Math.floor(left / 60);
  const s = left % 60;
  return (
    <span className="flex items-center gap-1 rounded-lg px-2.5 py-1 font-mono text-[13px] font-semibold" style={{ background: left < 60 ? "var(--err-soft)" : "var(--surface2)", color: left < 60 ? "var(--err-ink)" : "var(--ink)" }}>
      <Icon name="timer" size={16} />
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

function Taking({ q, mutate }: { q: Quiz; mutate: () => void }) {
  const mock = q.mode === "Mock exam";
  const [idx, setIdx] = useState(q.current);
  const it = q.items[Math.min(idx, q.items.length - 1)];
  const [val, setVal] = useState(it?.response || "");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => {
    setVal(it?.response || "");
  }, [it?.id, it?.response]);
  if (!it) return <Loading />;
  const done = it.answered && !mock;
  const submit = async () => {
    if (!val.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/practice/quizzes/${q.id}/items/${it.id}/answer`, { response: val.trim() });
      await mutate();
      if (mock && idx < q.items.length - 1) setIdx(idx + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    setBusy(true);
    try {
      await api.post(`/api/practice/quizzes/${q.id}/finish`);
      await mutate();
    } finally {
      setBusy(false);
    }
  };
  // After an answer the API has already added the next adaptive question (if any remain).
  const next = async () => {
    if (idx < q.items.length - 1) setIdx(idx + 1);
    else await finish();
  };
  const fb = it.grade ? RT[it.grade] : null;
  const [fbBg, fbFg] = fb ? TONE_BG[fb[2]] : ["", ""];
  const up = (it.mastery_after ?? 0) >= (it.mastery_before ?? 0);

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[13px] font-semibold text-ink2">
          QUESTION {idx + 1} OF {q.n} · {q.title.toUpperCase()}
        </div>
        <div className="flex items-center gap-2">
          {mock && q.time_left !== null && <Timer seconds={q.time_left} />}
          <div className="flex gap-1">
            {Array.from({ length: q.n }).map((_, i) => {
              const x = q.items[i];
              const bg = x?.grade === "correct" ? "var(--ok)" : x?.grade === "partial" ? "var(--warn)" : x?.grade === "wrong" ? "var(--err)" : i === idx ? "var(--pri)" : x?.answered ? "var(--ink3)" : "var(--line)";
              return <button key={i} disabled={!mock || !x} onClick={() => setIdx(i)} className="h-1.5 w-7 rounded-[3px] border-0 p-0" style={{ background: bg }} aria-label={`Question ${i + 1}`} />;
            })}
          </div>
        </div>
      </div>
      <Card className="flex flex-col gap-[18px] rounded-[20px] p-[26px]">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-lg bg-surface2 px-[9px] py-[3px] text-xs font-semibold">{it.type}</span>
          <span className="rounded-lg bg-pri-soft px-[9px] py-[3px] text-xs font-semibold text-pri-ink">{it.topic}</span>
          {it.source.loc && (
            <span className="flex items-center gap-1 rounded-lg bg-surface2 px-[9px] py-[3px] text-xs font-semibold">
              <Icon name={it.source.icon} size={14} />
              {it.source.loc}
            </span>
          )}
          <Pill tone={toneOf(it.difficulty)} className="rounded-lg">
            {it.difficulty}
          </Pill>
          <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-ok-ink">
            <Icon name="verified" size={15} fill />
            Answer verified
          </span>
        </div>
        <div className="font-display text-[21px] font-semibold leading-[1.35] [text-wrap:pretty]">{it.question}</div>

        {it.type === "MCQ" && (
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            {it.options.map((o, i) => {
              const sel = val === o;
              const ok = done && o === it.answer;
              const bad = done && sel && o !== it.answer;
              const [bg, bd, ic, icc] = ok ? ["var(--ok-soft)", "var(--ok)", "check_circle", "var(--ok)"] : bad ? ["var(--err-soft)", "var(--err)", "cancel", "var(--err)"] : sel ? ["var(--pri-soft)", "var(--pri)", "radio_button_checked", "var(--pri)"] : ["var(--surface)", "var(--line)", "radio_button_unchecked", "var(--ink3)"];
              return (
                <button key={o} disabled={done} onClick={() => setVal(o)} className="flex items-center gap-3 rounded-[14px] px-4 py-3.5 text-left text-[15px] font-semibold" style={{ border: `1.5px solid ${bd}`, background: bg }}>
                  <Icon name={ic} size={22} style={{ color: icc }} />
                  <span className="font-mono text-xs font-semibold text-ink3">{"ABCD"[i]}</span>
                  {o}
                </button>
              );
            })}
          </div>
        )}
        {it.type === "Numerical" && (
          <label className="flex h-[54px] max-w-[320px] items-center gap-2.5 rounded-[14px] bg-bg px-4" style={{ border: "1.5px solid var(--line)" }}>
            <input value={val} disabled={done} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !done && submit()} inputMode="decimal" placeholder="Your answer" className="min-w-0 flex-1 border-0 bg-transparent font-mono text-xl font-semibold outline-none" />
            <span className="font-mono text-base font-semibold text-ink2">{it.unit}</span>
          </label>
        )}
        {it.type === "Short answer" && (
          <textarea value={val} disabled={done} onChange={(e) => setVal(e.target.value)} placeholder="Write 1–2 sentences…" className="min-h-[110px] resize-y rounded-[14px] bg-bg px-4 py-3.5 text-[15px] leading-normal outline-none" style={{ border: "1.5px solid var(--line)" }} />
        )}

        {!done && (
          <div className="flex items-center justify-between gap-3 pt-1.5">
            <span className="text-xs text-ink2">{mock ? "Feedback comes at the end of the mock exam" : "Feedback appears right after you submit"}</span>
            <div className="flex gap-2">
              {mock && (
                <Button className="h-[46px] rounded-xl" onClick={finish} loading={busy}>
                  Finish exam
                </Button>
              )}
              <button onClick={submit} disabled={busy || !val.trim()} className="h-[46px] rounded-xl border-0 px-[22px] font-semibold" style={{ background: val.trim() ? "var(--pri)" : "var(--surface2)", color: val.trim() ? "var(--on-pri)" : "var(--ink3)" }}>
                {busy ? <Spinner size={18} /> : mock ? (it.answered ? "Update answer" : "Save answer") : "Submit answer"}
              </button>
            </div>
          </div>
        )}

        {done && fb && (
          <>
            <div className="flex flex-col gap-3 rounded-2xl p-[18px]" style={{ background: fbBg }}>
              <div className="flex items-center gap-2 font-display text-lg font-semibold" style={{ color: fbFg }}>
                <Icon name={fb[0]} size={24} fill />
                {fb[1]}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
                <span>
                  Your answer: <strong>{it.response}{it.type === "Numerical" && it.unit && !/[a-z]$/i.test(it.response || "") ? ` ${it.unit}` : ""}</strong>
                </span>
                <span>
                  Correct: <strong>{it.type === "Short answer" ? "See key points below" : `${it.answer}${it.unit ? ` ${it.unit}` : ""}`}</strong>
                </span>
              </div>
              {it.explanation && <div className="text-sm leading-relaxed">{it.explanation}</div>}
              {it.type === "Short answer" && (
                <div className="flex flex-col gap-1.5">
                  {it.rubric?.map((k) => (
                    <div key={k.t} className="flex items-center gap-2 text-[13px]">
                      <Icon name={k.hit ? "check_circle" : "radio_button_unchecked"} size={18} style={{ color: k.hit ? "var(--ok)" : "var(--ink3)" }} />
                      {k.t}
                    </div>
                  ))}
                </div>
              )}
              {it.misconception && (
                <div className="flex items-start gap-2 rounded-[10px] bg-surface px-3 py-2.5 text-[13px]">
                  <Icon name="psychology_alt" size={18} style={{ color: "var(--err)" }} />
                  <div>
                    <strong>Likely misconception:</strong> {it.misconception}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                {it.source.unit_id ? (
                  <Button size="sm" icon={it.source.icon} onClick={() => setViewer(it.source.unit_id)}>
                    Explained at {it.source.loc}
                  </Button>
                ) : (
                  <span />
                )}
                {it.mastery_before != null && it.mastery_after != null && (
                  <span className="flex items-center gap-1.5 text-[13px]">
                    <Icon name={up ? "trending_up" : "trending_down"} size={18} style={{ color: up ? "var(--ok-ink)" : "var(--err-ink)" }} />
                    {it.topic} mastery{" "}
                    <strong className="font-mono">
                      {f2(it.mastery_before)} → {f2(it.mastery_after)}
                    </strong>
                  </span>
                )}
              </div>
            </div>
            <Button variant="primary" className="h-[46px] self-end rounded-xl px-[22px]" iconRight="arrow_forward" loading={busy} onClick={next}>
              {idx < q.items.length - 1 ? "Next question" : "See report"}
            </Button>
          </>
        )}
      </Card>
      <Modal open={!!viewer} onOpenChange={() => setViewer(null)} title="Where this is explained" width={520}>
        <div className="flex flex-col gap-3.5">
          <SourceViewer unitId={viewer} n={1} />
        </div>
      </Modal>
    </div>
  );
}

function Report({ q }: { q: Quiz }) {
  const router = useRouter();
  const s = q.summary!;
  const [viewer, setViewer] = useState<string | null>(null);
  const schedule = async () => {
    const r = await api.post<{ scheduled: number; due: string }>(`/api/practice/quizzes/${q.id}/schedule-requiz`);
    toast(r.scheduled ? `Re-quiz on ${r.scheduled} weak topic${r.scheduled > 1 ? "s" : ""} added ${r.due}` : "No weak topics to re-quiz");
  };
  const weakIds = q.items.filter((i) => s.weak.some((w) => w.t === i.topic)).map((i) => i.topic_id);
  const score = `${s.counts.correct}${s.counts.partial ? ` + ${s.counts.partial} partial` : ""}`;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>{q.title.toUpperCase()}</Eyebrow>
          <h1 className="m-0 mt-1 font-display text-[32px] font-semibold leading-[1.15] tracking-[-0.02em]">{q.mode === "Diagnostic" ? "Your starting point" : "Your report"}</h1>
        </div>
        <div className="flex gap-2">
          {q.mode === "Diagnostic" ? (
            <LinkButton href="/app" variant="primary">Go to dashboard</LinkButton>
          ) : (
            <>
              <LinkButton href="/app/practice">New quiz</LinkButton>
              <Button variant="primary" onClick={schedule}>Schedule re-quiz</Button>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="flex-[1_1_200px] rounded-2xl border border-line bg-surface p-[18px]">
          <div className="font-display text-[30px] font-semibold leading-none">
            {score}
            <span className="text-base text-ink2"> / {s.total}</span>
          </div>
          <div className="mt-1.5 text-[13px] text-ink2">Score</div>
        </div>
        {(
          [
            ["Correct", s.counts.correct, "ok"],
            ["Partly correct", s.counts.partial, "warn"],
            ["Incorrect", s.counts.wrong, "err"],
          ] as const
        ).map(([l, n, t]) => (
          <div key={l} className="flex-[1_1_140px] rounded-2xl p-[18px]" style={{ background: TONE_BG[t][0] }}>
            <div className="font-display text-[30px] font-semibold leading-none" style={{ color: TONE_BG[t][1] }}>{n}</div>
            <div className="mt-1.5 text-[13px]" style={{ color: TONE_BG[t][1] }}>{l}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1.4_1_460px] flex-col gap-5">
          <Card>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <div className="font-display text-[17px] font-semibold">Mastery change by topic</div>
              <div className="text-xs text-ink2">Estimated probability you&apos;ve mastered it</div>
            </div>
            {s.topics.map((t) => {
              const d = t.a - t.b;
              const ac = t.a < 0.5 ? "var(--err)" : t.a < 0.8 ? "var(--warn)" : "var(--ok)";
              return (
                <div key={t.t} className="border-t border-line py-2.5">
                  <div className="mb-1.5 flex justify-between gap-2 text-[13px]">
                    <span className="font-semibold">{t.t}</span>
                    <span className="font-mono">
                      {f2(t.b)} → <strong>{f2(t.a)}</strong> <span style={{ color: d >= 0 ? "var(--ok-ink)" : "var(--err-ink)" }}>{(d >= 0 ? "+" : "") + f2(d)}</span>
                    </span>
                  </div>
                  <div className="relative h-2.5 rounded-[5px] bg-surface2">
                    <div className="absolute bottom-0 left-0 top-0 rounded-[5px] bg-line" style={{ width: `${Math.round(t.b * 100)}%` }} />
                    <div className="absolute left-0 top-[3px] h-1 rounded-sm" style={{ width: `${Math.round(t.a * 100)}%`, background: ac }} />
                  </div>
                </div>
              );
            })}
          </Card>
          <Card>
            <div className="mb-2 font-display text-[17px] font-semibold">Question review</div>
            {s.review.map((r) => (
              <div key={r.n} className="flex items-start gap-3 border-t border-line py-2.5">
                <Icon name={RT[r.grade]?.[0] || "cancel"} size={20} fill style={{ color: `var(--${RT[r.grade]?.[2] || "err"})` }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">
                    {r.n} · {r.t}
                  </div>
                  <div className="text-xs text-ink2">
                    {r.type} · {r.topic} · {r.loc}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <Icon name="psychology_alt" style={{ color: "var(--err)" }} />
              <div className="font-display text-[17px] font-semibold">Likely misconceptions</div>
            </div>
            {s.misconceptions.map((m, i) => (
              <div key={i} className="flex flex-col gap-1.5 border-t border-line py-3">
                <div className="font-bold">{m.t}</div>
                <div className="text-xs text-ink2">Evidence: {m.ev}</div>
                {m.unit_id && (
                  <button onClick={() => setViewer(m.unit_id)} className="h-[30px] self-start rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold">
                    Review at {m.loc}
                  </button>
                )}
              </div>
            ))}
            {s.misconceptions.length === 0 && <div className="pt-1.5 text-[13px] text-ink2">No clear misconception patterns in this quiz.</div>}
          </Card>
          <Card>
            <div className="mb-2 font-display text-[17px] font-semibold">Weak topics</div>
            {s.weak.length === 0 && <div className="border-t border-line py-2.5 text-[13px] text-ink2">None below 0.50. Nice work.</div>}
            {s.weak.map((w) => (
              <div key={w.t} className="flex justify-between gap-2 border-t border-line py-[9px] text-[13px]">
                <span className="font-semibold">{w.t}</span>
                <span className="font-mono text-err-ink">{f2(w.m)}</span>
              </div>
            ))}
          </Card>
          <Card className="flex flex-col gap-2">
            <div className="mb-1 font-display text-[17px] font-semibold">Revise your weak topics</div>
            {[
              ["quiz", "Practise just these topics", "A short adaptive quiz on the weak ones", `/app/practice?topics=${[...new Set(weakIds)].join(",")}`],
              ["forum", "Talk it through with the tutor", "Ask about the questions you missed", `/app/tutor?q=${encodeURIComponent(s.weak.length ? `Help me understand ${s.weak[0].t}` : "")}`],
              ["style", "Make flashcards", "Generate notes and cards from your material", "/app/study"],
            ].map(([i, t, d, href]) => (
              <button key={t} onClick={() => router.push(href)} className="flex items-center gap-3 rounded-xl border-0 bg-surface2 p-3 text-left">
                <Icon name={i} size={22} className="text-pri" />
                <span className="flex-1">
                  <span className="block text-[13px] font-bold">{t}</span>
                  <span className="block text-xs text-ink2">{d}</span>
                </span>
              </button>
            ))}
          </Card>
        </div>
      </div>
      <Modal open={!!viewer} onOpenChange={() => setViewer(null)} title="Where this is explained" width={520}>
        <div className="flex flex-col gap-3.5">
          <SourceViewer unitId={viewer} n={1} />
        </div>
      </Modal>
    </div>
  );
}

export default function QuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = use(params);
  const { data: q, error, mutate } = useApi<Quiz>(`/api/practice/quizzes/${quizId}`, {
    refreshInterval: (d) => (d?.status === "preparing" ? 2000 : 0),
  });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!q) return <Loading />;
  if (q.status === "preparing") return <Preparing q={q} />;
  if (q.status === "failed")
    return (
      <div className="mx-auto flex max-w-[560px] flex-col gap-4 py-10">
        <Alert>{q.error || "This quiz couldn't be prepared."}</Alert>
        <div className="flex gap-2">
          <LinkButton href="/app/practice">Back to Practice</LinkButton>
          <Link href="/app/tutor" className="self-center font-semibold">Ask the tutor instead</Link>
        </div>
      </div>
    );
  if (q.status === "completed" && q.summary) return <Report q={q} />;
  return <Taking q={q} mutate={() => mutate()} />;
}
