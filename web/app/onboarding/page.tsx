"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { avatarColor } from "@/components/student-shell";
import { Alert, Button, Field, Icon, Input, Loading, Logo } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Options = {
  boards: string[];
  classes: string[];
  subjects: { id: string; name: string; stream: string | null }[];
  exams: { id: string; name: string; full_name: string }[];
  languages: string[];
  interests: string[];
  goals: { v: string; d: string; i: string }[];
};
type Profile = {
  name: string; email: string | null; phone: string | null; nickname: string; school: string; city: string; avatar: number;
  board: string; class_level: string; languages: string[]; subject_ids: string[]; interests: string[]; goals: string[];
  exam_ids: string[]; diag_mode: string; onboarded: boolean;
};

const STEPS = ["Profile", "Academic profile", "Subjects", "Interests", "Goals", "Exams", "Starting point", "Ready"];
const BOARDS = ["CBSE", "ICSE", "State board", "IB / IGCSE", "Other"];
const CLASSES = ["Class 9", "Class 10", "Class 11", "Class 12", "Starting college"];
const uniq = (a: string[]) => Array.from(new Set(a));

function Choice({ on, onClick, children, check }: { on: boolean; onClick: () => void; children: React.ReactNode; check?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[42px] items-center gap-1.5 rounded-full px-4 font-semibold"
      style={{ border: `1.5px solid ${on ? "var(--pri)" : "var(--line)"}`, background: on ? "var(--pri-soft)" : "var(--surface)", color: on ? "var(--pri-ink)" : "var(--ink)", paddingLeft: check ? 12 : 16 }}
    >
      {check && <Icon name={on ? "check" : "add"} size={18} />}
      {children}
    </button>
  );
}

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: me } = useApi<Profile>("/api/me/profile");
  useEffect(() => {
    if (me && !p) setP({ ...me, nickname: me.nickname || me.name.split(" ")[0], diag_mode: me.diag_mode || "quiz" });
  }, [me, p]);
  const { data: opts } = useApi<Options>(p ? `/api/me/options?board=${encodeURIComponent(p.board)}&class_level=${encodeURIComponent(p.class_level)}` : null, { keepPreviousData: true });

  const set = (patch: Partial<Profile>) => setP((x) => (x ? { ...x, ...patch } : x));
  const tog = (k: "languages" | "subject_ids" | "interests" | "goals" | "exam_ids", v: string) =>
    setP((x) => (x ? { ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] } : x));

  // Pre-select every published subject the first time a board + class is chosen.
  useEffect(() => {
    if (p && opts && opts.subjects.length && !p.subject_ids.some((id) => opts.subjects.find((s) => s.id === id))) set({ subject_ids: opts.subjects.map((s) => s.id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.subjects]);

  const boards = useMemo(() => uniq([...(opts?.boards || []), ...BOARDS]), [opts?.boards]);
  const classes = useMemo(() => uniq([...CLASSES, ...(opts?.classes || [])]), [opts?.classes]);

  if (!p || !opts) return <Loading className="min-h-screen" />;
  const initials = ((p.name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("") || "?").toUpperCase();

  const validate = (): string => {
    if (step === 0 && p.name.trim().length < 2) return "Enter your full name.";
    if (step === 1 && (!p.board || !p.class_level)) return "Choose your board and class.";
    if (step === 1 && !p.languages.length) return "Pick at least one language.";
    return "";
  };
  const save = async () => {
    const { name, nickname, school, city, avatar, board, class_level, languages, subject_ids, interests, goals, exam_ids, diag_mode } = p;
    await api.put("/api/me/profile", { name, nickname, school, city, avatar, board, class_level, languages, subject_ids, interests, goals, exam_ids, diag_mode });
  };
  const next = async () => {
    const v = validate();
    if (v) return setErr(v);
    setErr("");
    setBusy(true);
    try {
      await save();
      setStep((s) => Math.min(7, s + 1));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    setBusy(true);
    try {
      await save();
      const r = await api.post<{ quiz_id?: string; conversation_id?: string }>("/api/me/onboarding/complete");
      if (r.quiz_id) router.replace(`/app/practice/${r.quiz_id}`);
      else if (r.conversation_id) router.replace(`/app/tutor/${r.conversation_id}`);
      else router.replace("/app");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const subjNames = opts.subjects.filter((s) => p.subject_ids.includes(s.id)).map((s) => s.name);
  const summary: [string, string][] = [
    ["Name", p.name],
    ["Board and class", `${p.board} · ${p.class_level}`],
    ["Languages", p.languages.join(", ") || "—"],
    ["Subjects", subjNames.join(", ") || "None published yet"],
    ["Interests", p.interests.join(", ") || "—"],
    ["Goals", p.goals.join(", ") || "—"],
    ["Exam interest", opts.exams.filter((e) => p.exam_ids.includes(e.id)).map((e) => e.name).join(", ") || "Skipped for now"],
    ["Starting point", { quiz: "Diagnostic quiz · about 6 questions", chat: "Intake conversation with the tutor", skip: "Skipped · every topic starts as unknown" }[p.diag_mode] || "—"],
  ];

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-[340px] flex-none flex-col gap-9 bg-side px-8 py-9 text-side-ink md:flex">
        <Logo />
        <div className="font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">Your learning space, set up in about two minutes.</div>
        <div className="flex flex-col gap-1">
          {STEPS.map((l, i) => (
            <div key={l} className="flex items-center gap-3 py-2" style={{ opacity: i <= step ? 1 : 0.6 }}>
              <div
                className="grid h-[26px] w-[26px] place-items-center rounded-full font-mono text-xs font-semibold"
                style={{
                  background: i < step ? "var(--teal)" : i === step ? "#fff" : "transparent",
                  color: i < step ? "#fff" : i === step ? "var(--side)" : "var(--side-ink2)",
                  border: `1.5px solid ${i <= step ? (i < step ? "var(--teal)" : "#fff") : "var(--side-ink2)"}`,
                }}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <div style={{ fontWeight: i === step ? 700 : 500 }}>{l}</div>
            </div>
          ))}
        </div>
        <div className="mt-auto text-[13px] text-side-ink2">You can change any of this later in Profile. Nothing here affects marks or results.</div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-center px-[18px] pb-10 pt-6 md:px-10 md:py-12">
        <div className="flex w-full max-w-[580px] flex-col gap-7">
          <div className="flex flex-col gap-2.5">
            <div className="flex justify-between font-mono text-xs font-medium text-ink2">
              <span>STEP {step + 1} OF 8</span>
              <span>{STEPS[step]}</span>
            </div>
            <div className="h-1 overflow-hidden rounded bg-line">
              <div className="h-full rounded bg-pri transition-[width] duration-300" style={{ width: `${Math.round(((step + 1) / 8) * 100)}%` }} />
            </div>
          </div>

          {step === 0 && (
            <div className="flex flex-col gap-[22px]">
              <Head title="Set up your profile" sub="This is how you'll appear in IntelliNova. Only you and your teachers can see it." />
              <div className="flex flex-wrap items-center gap-[18px]">
                <div className="grid h-[76px] w-[76px] flex-none place-items-center rounded-full font-display text-[26px] font-semibold text-white" style={{ background: avatarColor(p.avatar), boxShadow: "0 0 0 4px var(--surface),0 0 0 5px var(--line)" }}>
                  {initials}
                </div>
                <div className="flex flex-col gap-2.5">
                  <div className="text-[13px] font-semibold">Profile colour</div>
                  <div className="flex flex-wrap gap-2">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <button key={i} type="button" onClick={() => set({ avatar: i })} aria-label={`Colour ${i + 1}`} className="h-[30px] w-[30px] rounded-full border-0" style={{ background: avatarColor(i), boxShadow: i === p.avatar ? `0 0 0 2px var(--bg),0 0 0 4px ${avatarColor(i)}` : "none" }} />
                    ))}
                  </div>
                </div>
              </div>
              <Field label="Full name">
                <Input value={p.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="What should your tutor call you?">
                <Input value={p.nickname} onChange={(e) => set({ nickname: e.target.value })} placeholder="A first name or nickname" />
              </Field>
              <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,180px),1fr))" }}>
                <Field label="School (optional)">
                  <Input value={p.school} onChange={(e) => set({ school: e.target.value })} placeholder="Your school" />
                </Field>
                <Field label="City (optional)">
                  <Input value={p.city} onChange={(e) => set({ city: e.target.value })} placeholder="Your city" />
                </Field>
              </div>
              <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] text-ink2">
                <Icon name="verified" size={18} fill style={{ color: "var(--ok)" }} />
                <span>
                  Signed in as <span className="font-semibold text-ink">{p.email || p.phone}</span>
                </span>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-6">
              <Head title="Where are you studying?" sub="This decides which syllabus and chapters you see." />
              <Group label="Board">
                {boards.map((b) => (
                  <Choice key={b} on={p.board === b} onClick={() => set({ board: b, subject_ids: [] })}>{b}</Choice>
                ))}
              </Group>
              <Group label="Current class">
                {classes.map((c) => (
                  <Choice key={c} on={p.class_level === c} onClick={() => set({ class_level: c, subject_ids: [] })}>{c}</Choice>
                ))}
              </Group>
              <Group label="Preferred languages for learning">
                {opts.languages.map((l) => (
                  <Choice key={l} on={p.languages.includes(l)} onClick={() => tog("languages", l)}>{l}</Choice>
                ))}
              </Group>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-6">
              <Head title="Which subjects are you studying?" sub={opts.subjects.length ? `Pre-filled for ${p.board} ${p.class_level}. Remove anything you don't take.` : `Subjects appear here once your school publishes chapters for ${p.board} ${p.class_level}.`} />
              {opts.subjects.length ? (
                <div className="flex flex-wrap gap-2">
                  {opts.subjects.map((s) => (
                    <Choice key={s.id} check on={p.subject_ids.includes(s.id)} onClick={() => tog("subject_ids", s.id)}>
                      {s.name}
                      {s.stream ? ` · ${s.stream}` : ""}
                    </Choice>
                  ))}
                </div>
              ) : (
                <Alert tone="warn" icon="info">
                  Nothing is published for this board and class yet. You can continue: Ask Tutor and Study AI work with your own material, and your chapters will appear when they&apos;re added.
                </Alert>
              )}
              <div className="flex gap-3 rounded-xl bg-surface2 px-4 py-3.5 text-[13px] text-ink2">
                <Icon name="info" className="text-teal-ink" />
                <div>In Class 11 or 12? Pick the subjects in your stream (Science, Commerce, Humanities).</div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-6">
              <Head title="What do you enjoy?" sub="Pick as many as you like. These shape career suggestions only." />
              <div className="flex flex-wrap gap-2">
                {opts.interests.map((x) => (
                  <Choice key={x} check on={p.interests.includes(x)} onClick={() => tog("interests", x)}>{x}</Choice>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-6">
              <Head title="What would you like help with?" sub="Choose one or more. Your dashboard adapts to these." />
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
                {opts.goals.map((g) => {
                  const on = p.goals.includes(g.v);
                  return (
                    <button key={g.v} type="button" onClick={() => tog("goals", g.v)} className="flex items-start gap-3 rounded-[14px] p-4 text-left" style={{ border: `1.5px solid ${on ? "var(--pri)" : "var(--line)"}`, background: on ? "var(--pri-soft)" : "var(--surface)" }}>
                      <Icon name={g.i} size={24} className="text-pri" />
                      <span className="flex flex-col gap-0.5">
                        <span className="font-semibold" style={{ color: on ? "var(--pri-ink)" : "var(--ink)" }}>{g.v}</span>
                        <span className="text-[13px] text-ink2">{g.d}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col gap-6">
              <Head title="Thinking about an entrance exam?" sub="Optional. Exploring early is fine; you can add or remove exams any time." />
              {opts.exams.length ? (
                <div className="flex flex-wrap gap-2">
                  {opts.exams.map((e) => (
                    <Choice key={e.id} check on={p.exam_ids.includes(e.id)} onClick={() => tog("exam_ids", e.id)}>{e.name}</Choice>
                  ))}
                </div>
              ) : (
                <div className="text-[13px] text-ink2">No exams have been set up yet. You can add one later from Exam Prep.</div>
              )}
              <button onClick={() => (set({ exam_ids: [] }), setStep(6))} className="self-start border-0 bg-transparent p-0 font-semibold text-pri-ink">
                Skip — I&apos;ll decide later
              </button>
            </div>
          )}

          {step === 6 && (
            <div className="flex flex-col gap-[22px]">
              <Head title="Let's find your starting point" sub="We don't know what you already understand yet. Pick how you'd like to show us. There are no marks." />
              <div className="flex flex-col gap-2.5">
                {[
                  ["quiz", "Take a short diagnostic", "One question per topic area. It gets easier or harder based on your answers.", "quiz", "about 5 min"],
                  ["chat", "Chat with the tutor instead", "A short conversation about what you've covered in class and what feels hard.", "forum", "about 3 min"],
                  ["skip", "Skip for now", "Every topic starts as unknown, and estimates build up as you study.", "skip_next", ""],
                ].map(([k, v, d, i, t]) => {
                  const on = p.diag_mode === k;
                  return (
                    <button key={k} type="button" onClick={() => set({ diag_mode: k })} className="flex items-start gap-3.5 rounded-[14px] p-4 text-left" style={{ border: `1.5px solid ${on ? "var(--pri)" : "var(--line)"}`, background: on ? "var(--pri-soft)" : "var(--surface)" }}>
                      <Icon name={i} size={24} className="text-pri" />
                      <span className="flex flex-1 flex-col gap-0.5">
                        <span className="font-bold" style={{ color: on ? "var(--pri-ink)" : "var(--ink)" }}>{v}</span>
                        <span className="text-[13px] text-ink2">{d}</span>
                      </span>
                      <span className="whitespace-nowrap font-mono text-[11px] font-medium text-ink3">{t}</span>
                    </button>
                  );
                })}
              </div>
              {p.diag_mode === "quiz" && (
                <div className="flex flex-col gap-2.5 rounded-[14px] bg-surface2 p-4">
                  <div className="font-mono text-[11px] font-semibold tracking-[0.06em] text-ink2">QUESTIONS FROM</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(subjNames.length ? subjNames : ["Your subjects"]).map((x) => (
                      <span key={x} className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold">{x}</span>
                    ))}
                  </div>
                  <div className="text-xs text-ink2">Your answers set a first mastery estimate for each topic. It updates after every quiz and tutor chat.</div>
                </div>
              )}
            </div>
          )}

          {step === 7 && (
            <div className="flex flex-col gap-6">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ok-soft text-ok">
                <Icon name="check_circle" size={32} fill />
              </div>
              <Head title="Your learning space is ready" sub="Here's what we set up. You can change any of it in Profile." big />
              <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                {summary.map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-[18px] py-3.5 last:border-b-0">
                    <div className="w-[130px] flex-none text-[13px] text-ink2">{k}</div>
                    <div className="min-w-[180px] flex-1 font-medium">{v}</div>
                  </div>
                ))}
              </div>
              {err && <Alert>{err}</Alert>}
              <Button variant="primary" className="h-[50px] rounded-xl text-[15px]" onClick={finish} loading={busy} iconRight="arrow_forward">
                {p.diag_mode === "quiz" ? "Start the diagnostic" : p.diag_mode === "chat" ? "Start the conversation" : "Enter Dashboard"}
              </Button>
            </div>
          )}

          {step < 7 && (
            <>
              {err && <Alert>{err}</Alert>}
              <div className="flex justify-between gap-2.5 border-t border-line pt-2">
                <Button className="h-[46px] rounded-xl px-[18px]" style={{ opacity: step === 0 ? 0.4 : 1 }} disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                  Back
                </Button>
                <Button variant="primary" className="h-[46px] rounded-xl px-[22px]" onClick={next} loading={busy} iconRight="arrow_forward">
                  Continue
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Head({ title, sub, big }: { title: string; sub: string; big?: boolean }) {
  return (
    <div>
      <h1 className="m-0 mb-2 font-display font-semibold leading-[1.15] tracking-[-0.02em]" style={{ fontSize: big ? 32 : 30 }}>
        {title}
      </h1>
      <div className="text-ink2">{sub}</div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[13px] font-semibold">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
