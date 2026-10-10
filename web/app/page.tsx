"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/ui";
import { useTheme } from "@/lib/theme";

type Quality = { available: boolean; run?: number; date?: string; cases?: number; metrics?: { v: string; l: string }[] };

const mono = "font-mono";
const H2 = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <h2 className={`m-0 max-w-[700px] font-display font-semibold leading-[1.15] tracking-[-0.025em] [text-wrap:balance] ${className}`} style={{ fontSize: "clamp(26px,3.4vw,36px)" }}>
    {children}
  </h2>
);
const Kick = ({ children }: { children: React.ReactNode }) => <div className="text-xs text-ink3">{children}</div>;
const Cite = ({ n, on }: { n: number; on?: boolean }) => (
  <span className="inline-grid h-[18px] min-w-5 place-items-center rounded-[5px] px-1 align-[2px] font-mono text-[10px] font-semibold" style={{ background: on ? "var(--pri)" : "var(--pri-soft)", color: on ? "var(--on-pri)" : "var(--pri-ink)" }}>{n}</span>
);

const STEPS = [
  ["upload_file", "Add your material", "A YouTube lecture, a textbook PDF or your teacher’s slides."],
  ["forum", "Ask your doubts", "Clear explanations, each point linked back to where it comes from."],
  ["quiz", "Test yourself", "Short quizzes that get easier or harder as you go."],
  ["insights", "Revise at the right time", "See what’s slipping and get a nudge before you forget it."],
];
const STAGES: [string, string, string, string[]][] = [
  ["upload_file", "Read", "Transcribes lectures, reads scanned pages and pulls out diagrams, tables and formulas.", ["speech-to-text", "OCR", "figures"]],
  ["account_tree", "Organise", "Splits material into small pieces tagged by chapter, topic, concept and prerequisite.", ["topic tags", "concept map"]],
  ["manage_search", "Find", "For each question, finds the most relevant passages, slides and video moments.", ["hybrid search", "re-ranking"]],
  ["edit_note", "Answer", "Writes the explanation only from what it found, with a citation on every point.", ["citations", "EN · HI · Hinglish"]],
  ["fact_check", "Check", "Tests each sentence against the source and says so when your material doesn’t cover it.", ["fact check", "off-syllabus flag"]],
];
const FEATURES = [
  ["link", "Nothing made up", "If it tells you something, you can see where it came from."],
  ["report", "Says when it doesn’t know", "If your notes don’t cover a question, it says so. Anything from outside them is clearly labelled, never mixed in."],
  ["image_search", "Understands diagrams", "Circuit diagrams, graphs and tables become part of the answer."],
  ["rule", "Questions you can rely on", "Every answer key is double-checked, and you won’t get the same question twice."],
  ["psychology", "Gets to know you", "The more you practise, the better it knows what to show you next."],
  ["translate", "Speaks your language", "English lessons with Hindi explanations, or talk it through out loud."],
];
const STU = [
  ["Clear up doubts", "forum", "Explained simply, in English, Hinglish or Hindi. Type your question or just say it.", "teal", "ask tutor"],
  ["Practise your way", "quiz", "MCQs, short answers and numericals from the chapters you choose, with a pointer to the right page when you slip.", "pri", "practice"],
  ["Know what to revise", "insights", "A simple view of what you’ve got and what needs another look, with reminders at the right time.", "ok", "progress"],
];
const ADM = [
  ["Bring in content", "database", "Upload lectures, textbooks and slide decks. IntelliNova sorts them into chapters and topics for you.", "teal", "knowledge base"],
  ["Keep it accurate", "verified", "Review generated notes and answer keys, and keep exam and career details up to date.", "pri", "review"],
  ["See how it’s doing", "query_stats", "Track answer quality and whether students are actually improving.", "ok", "evaluation"],
];

/** Illustrative walk-through of how the learner model behaves (explainer, not user data). */
const EXAMPLE = [
  { t: "Ohm’s law", v: 0.82, delta: "+0.06", days: [5, 14, 30], end: 36, next: "in 9 days", note: "Strong here. Ready for harder numericals.", tone: "ok", why: "5 correct in a row, so the level steps up.", act: 2, qs: ["State Ohm’s law in one line", "A 12 V battery drives 2 A. Find the resistance.", "Why doesn’t a filament bulb follow Ohm’s law?"] },
  { t: "Series circuits", v: 0.71, delta: "0.54 → 0.71", days: [4, 10, 24], end: 30, next: "in 4 days", note: "Improving. Forgot once that current is the same in every resistor.", tone: "teal", why: "3 of the last 4 correct, so it stays at medium.", act: 1, qs: ["What stays the same across resistors in series?", "Find the total resistance of 2 Ω, 3 Ω and 5 Ω in series", "Why does one fused bulb switch off a whole string?"] },
  { t: "Parallel circuits", v: 0.46, delta: "0.52 → 0.46", days: [2, 5, 12], end: 16, next: "tomorrow", note: "Spotted: mixes up the series and parallel resistance formulas.", tone: "warn", why: "2 wrong answers that used the series formula.", act: 1, qs: ["What stays the same across parallel branches?", "Two 6 Ω resistors in parallel: find the total", "Why do household circuits use parallel wiring?"] },
  { t: "Electric power", v: 0.38, delta: "new topic", days: [1, 3, 8], end: 12, next: "in 1 day", note: "New topic. Starting with the basics before any numericals.", tone: "warn", why: "new topic, so it starts easy.", act: 0, qs: ["Write the formula for electric power", "Find the power of a 220 V, 5 A heater", "Why are geysers put on a separate circuit?"] },
] as const;

function ModelDemo() {
  const [i, setI] = useState(2);
  const c = EXAMPLE[i];
  const col = (v: number) => (v >= 0.7 ? "var(--pri)" : v >= 0.5 ? "var(--teal)" : "var(--warn)");
  const tone = { ok: ["var(--ok-soft)", "var(--ok-ink)", "verified"], teal: ["var(--teal-soft)", "var(--teal-ink)", "trending_up"], warn: ["var(--warn-soft)", "var(--warn-ink)", "lightbulb"] }[c.tone];
  const curve = useMemo(() => {
    const X = (d: number) => +((d / c.end) * 300).toFixed(1);
    const drop = 30 + 70 * (1 - c.v);
    const pts = [0, ...c.days.map(X), 300];
    let line = "", fill = "", drops = "";
    for (let k = 0; k < pts.length - 1; k++) {
      const x0 = pts[k], x1 = pts[k + 1], w = x1 - x0, ye = +(14 + drop * Math.pow(0.62, k)).toFixed(1);
      const seg = `C${(x0 + w * 0.28).toFixed(1)},${(14 + (ye - 14) * 0.55).toFixed(1)} ${(x0 + w * 0.6).toFixed(1)},${(14 + (ye - 14) * 0.88).toFixed(1)} ${x1},${ye}`;
      line += `M${x0},14 ${seg} `;
      fill += (k ? `L${x0},14 ` : "M0,14 ") + seg + " ";
      if (k < pts.length - 2) drops += `M${x1},${ye} L${x1},14 `;
    }
    return { line: line.trim(), fill: fill + "L300,110 L0,110 Z", drops: drops.trim() };
  }, [c]);

  return (
    <div className="mt-3.5 grid w-full gap-3.5 text-left lg:grid-cols-3">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[15px] font-semibold">It keeps a model of you</div>
          <span className={`${mono} text-[10px] font-medium text-ink3`}>example</span>
        </div>
        <div className="text-[13px] text-ink2">An estimate for every topic, updated after each quiz and conversation. Tap a topic to see the other two cards respond.</div>
        <div className="mt-0.5 flex flex-col gap-1">
          {EXAMPLE.map((m, k) => (
            <button key={m.t} onClick={() => setI(k)} className="-mx-2.5 flex flex-col gap-[5px] rounded-[10px] border px-2.5 py-2 text-left transition-colors" style={{ borderColor: k === i ? "color-mix(in oklch,var(--pri) 40%,transparent)" : "transparent", background: k === i ? "var(--pri-soft)" : "transparent" }}>
              <div className="flex w-full items-baseline gap-2 text-xs">
                <span className="min-w-0 flex-1" style={{ fontWeight: k === i ? 600 : 400 }}>{m.t}</span>
                <span className={`${mono} whitespace-nowrap text-[10px] text-ink3`}>{m.delta}</span>
                <span className={mono} style={{ color: col(m.v) }}>{m.v.toFixed(2)}</span>
              </div>
              <div className="h-[5px] w-full overflow-hidden rounded-[3px] bg-surface2">
                <div className="h-full rounded-[3px]" style={{ width: `${Math.round(m.v * 100)}%`, background: col(m.v) }} />
              </div>
            </button>
          ))}
        </div>
        <div className="mt-auto flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-xs" style={{ background: tone[0], color: tone[1] }}>
          <Icon name={tone[2]} size={16} />
          {c.note}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[15px] font-semibold">Revision timed to your memory</div>
          <span className={`${mono} whitespace-nowrap rounded-[5px] border border-line px-[7px] py-[3px] text-[10px] text-ink3`}>{c.days.length} reviews · {c.end} days</span>
        </div>
        <div className="text-[13px] text-ink2">Each review comes just before you&apos;d forget. Weaker topics come back sooner, and the gaps grow as they stick.</div>
        <div className="relative mt-1 h-[130px]">
          {[["100%", 11.667], ["50%", 51.667], ["0%", 91.667]].map(([l, t]) => (
            <span key={l} className={`${mono} absolute left-0 -translate-y-1/2 text-[10px] text-ink3`} style={{ top: `${t}%` }}>{l}</span>
          ))}
          <div className="absolute bottom-0 left-[38px] right-0 top-0">
            <svg viewBox="0 0 300 120" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" fill="none">
              <defs>
                <linearGradient id="memfill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--pri)" stopOpacity=".22" />
                  <stop offset="1" stopColor="var(--pri)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[14, 62, 110].map((y) => <line key={y} vectorEffect="non-scaling-stroke" x1="0" y1={y} x2="300" y2={y} stroke="var(--line)" />)}
              <path vectorEffect="non-scaling-stroke" d="M0,14 C30,78 90,100 300,107" stroke="var(--ink3)" strokeWidth="1.5" strokeDasharray="3 4" />
              <path d={curve.fill} fill="url(#memfill)" />
              <path vectorEffect="non-scaling-stroke" d={curve.line} stroke="var(--pri)" strokeWidth="2" strokeLinecap="round" />
              <path vectorEffect="non-scaling-stroke" d={curve.drops} stroke="var(--pri)" strokeWidth="1" strokeDasharray="2 3" opacity=".6" />
            </svg>
            {c.days.map((d) => (
              <span key={d} className="absolute h-[9px] w-[9px] rounded-full bg-pri transition-[left] duration-500" style={{ left: `${((d / c.end) * 100).toFixed(2)}%`, top: "11.667%", margin: "-4.5px 0 0 -4.5px", boxShadow: "0 0 0 2px var(--surface)" }} />
            ))}
          </div>
        </div>
        <div className={`${mono} relative ml-[38px] h-3.5 text-[10px] text-ink3`}>
          {c.days.map((d) => <span key={d} className="absolute -translate-x-1/2 whitespace-nowrap transition-[left] duration-500" style={{ left: `${((d / c.end) * 100).toFixed(2)}%` }}>day {d}</span>)}
        </div>
        <div className="flex flex-wrap gap-3.5 text-xs text-ink2">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-sm bg-pri" />With reviews</span>
          <span className="flex items-center gap-1.5"><span className="w-3.5 border-t-[1.5px] border-dashed border-ink3" />Without</span>
        </div>
        <div className="mt-auto flex items-start gap-2 rounded-[10px] bg-pri-soft px-3 py-2.5 text-xs text-pri-ink">
          <Icon name="event_repeat" size={16} />
          Next review: {c.t}, {c.next}. Mastery is {c.v.toFixed(2)}, so reviews start {c.days[0]} {c.days[0] === 1 ? "day" : "days"} apart.
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[15px] font-semibold">Questions that adapt</div>
          <span className={`${mono} whitespace-nowrap rounded-[5px] border border-line px-[7px] py-[3px] text-[10px] text-ink3`}>Q 4 of 10</span>
        </div>
        <div className="text-[13px] text-ink2">The next question is picked from your mastery, recent mistakes and what you haven&apos;t seen yet.</div>
        <div className="mt-1 flex flex-col gap-1.5">
          {c.qs.map((t, k) => {
            const on = k === c.act, done = k < c.act;
            const clr = on ? "var(--pri-ink)" : "var(--ink3)";
            return (
              <div key={t} className="flex items-center gap-2.5 rounded-[10px] border px-3 py-[9px] transition-colors" style={{ borderColor: on ? "color-mix(in oklch,var(--pri) 45%,transparent)" : "var(--line)", background: on ? "var(--pri-soft)" : "var(--bg)" }}>
                <span className={`${mono} w-[52px] flex-none text-[10px]`} style={{ color: clr }}>{["easy", "medium", "harder"][k]}</span>
                <span className="min-w-0 flex-1 text-xs">{t}</span>
                <Icon name={on ? "radio_button_checked" : done ? "check_circle" : "lock"} size={16} style={{ color: clr }} />
              </div>
            );
          })}
        </div>
        <div className="flex items-start gap-2 text-xs text-ink2">
          <Icon name="target" size={16} className="text-pri" />
          <span><span className="font-semibold text-ink">Picked because:</span> {c.why}</span>
        </div>
        <div className="mt-auto text-xs text-ink3">Answer keys are worked out twice and compared before a question is shown.</div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<"student" | "admin">("student");
  const [q, setQ] = useState<Quality | null>(null);

  useEffect(() => {
    fetch("/api/public/quality")
      .then((r) => (r.ok ? r.json() : null))
      .then(setQ)
      .catch(() => setQ(null));
  }, []);

  const cards = (tab === "student" ? STU : ADM).map(([t, icon, d, tone, tag]) => ({ t, icon, d, tag, glow: `color-mix(in oklch,var(--${tone}) 26%,var(--surface))` }));
  const cardHref = tab === "student" ? "/signup" : "/admin/login";
  const showQuality = !!q?.available && !!q.metrics?.length;

  return (
    <div className="min-h-screen overflow-hidden bg-bg text-[15px] leading-[1.55] text-ink" style={{ backgroundImage: "none" }}>
      <div className="relative" style={{ background: "radial-gradient(40% 55% at 0% 0%,color-mix(in oklch,var(--pri) 22%,transparent),transparent 72%),radial-gradient(28% 40% at 100% 70%,color-mix(in oklch,var(--teal) 14%,transparent),transparent 72%),radial-gradient(40% 25% at 50% 100%,color-mix(in oklch,var(--pri) 6%,transparent),transparent 70%)" }}>
        <div className="pointer-events-none absolute inset-0 opacity-55" style={{ backgroundImage: "linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px)", backgroundSize: "96px 96px", maskImage: "radial-gradient(70% 70% at 50% 35%,#000,transparent 85%)", WebkitMaskImage: "radial-gradient(70% 70% at 50% 35%,#000,transparent 85%)" }} />

        <header className="relative mx-auto flex max-w-[1180px] items-center gap-4 border-b border-line px-4 py-4 sm:gap-8 sm:px-6">
          <Link href="/" className="flex flex-none items-center gap-2.5 text-inherit hover:no-underline">
            <span className="grid h-7 w-7 place-items-center rounded-lg font-display text-[15px] font-bold text-on-pri" style={{ background: "var(--grad)" }}>I</span>
            <span className={`${mono} text-[17px] font-semibold tracking-[-0.02em]`}>IntelliNova</span>
          </Link>
          <nav className="hidden gap-[26px] whitespace-nowrap text-[13px] font-medium lg:flex">
            {[["#how", "How it works"], ["#paths", "For you"], ["#model", "The model"], ["#features", "Why IntelliNova"], ...(showQuality ? [["#trust", "Accuracy"]] : [])].map(([h, l]) => (
              <a key={h} href={h} className="text-ink2">{l}</a>
            ))}
          </nav>
          <div className="flex-1" />
          <button onClick={toggle} aria-label="Toggle dark mode" className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full border-0 bg-transparent text-ink2 hover:bg-surface2">
            <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} size={18} />
          </button>
          <Link href="/admin/login" className="hidden h-[34px] flex-none items-center whitespace-nowrap rounded-full border border-line bg-surface px-3.5 text-[13px] font-semibold text-ink hover:bg-surface2 hover:no-underline sm:flex">Admin console</Link>
          <Link href="/login" className="flex-none whitespace-nowrap px-1 text-[13px] font-semibold text-ink">Log in</Link>
          <Link href="/signup" className="flex h-[34px] flex-none items-center whitespace-nowrap rounded-full bg-ink px-4 text-[13px] font-bold text-bg hover:no-underline">Start free</Link>
        </header>

        <section className="relative mx-auto flex max-w-[1180px] flex-col items-center gap-5 px-4 py-[88px] text-center sm:px-6">
          <div className="pointer-events-none hidden xl:block">
            {[["left-[10%] top-14", 'source: "Slide 14"'], ["right-[11%] top-24", 'open("Textbook", p.208)'], ["left-[6%] top-[380px]", 'seek("Video 6", "12:34")'], ["right-[7%] top-[420px]", "mastery: 0.54 → 0.71"]].map(([pos, t]) => (
              <span key={t} className={`${mono} absolute ${pos} rounded-md border border-line bg-surface px-2.5 py-[5px] text-[11px] text-ink3`}>{t}</span>
            ))}
          </div>
          <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border px-[11px] py-1 text-xs font-medium" style={{ borderColor: "color-mix(in oklch,var(--pri) 55%,transparent)", background: "color-mix(in oklch,var(--pri) 8%,transparent)" }}>
            <Icon name="bolt" size={14} className="text-pri" />Your AI study partner
          </span>
          <h1 className="m-0 mt-1 max-w-[820px] font-display font-semibold leading-[1.08] tracking-[-0.03em] [text-wrap:balance]" style={{ fontSize: "clamp(36px,5.4vw,60px)" }}>
            Turn your class material into <span className="grad-text">a tutor that shows its work</span>
          </h1>
          <p className="m-0 max-w-[560px] text-base leading-relaxed text-ink2">
            Add the videos, textbook chapters and slides from your class. Ask doubts, take quick quizzes and revise, then tap any answer to jump straight to the page or moment it came from.
          </p>
          <div className="mt-2.5 flex flex-wrap justify-center gap-2.5">
            <Link href="/signup" className="flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-semibold text-on-pri hover:no-underline" style={{ background: "var(--grad)", boxShadow: "0 8px 28px -10px color-mix(in oklch,var(--pri) 55%,transparent),inset 0 1px 0 oklch(1 0 0 / .35)" }}>
              Start learning<Icon name="arrow_outward" size={18} />
            </Link>
            <a href="#how" className="flex h-11 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-[18px] text-sm font-semibold text-ink hover:bg-surface2 hover:no-underline">
              See how it works<Icon name="play_circle" size={18} />
            </a>
          </div>

          <div className="mt-16 w-full max-w-[960px] rounded-[20px] border border-line p-1.5" style={{ background: "color-mix(in oklch,var(--surface) 60%,transparent)", boxShadow: "0 40px 100px -40px color-mix(in oklch,var(--pri) 25%,transparent),0 0 0 1px color-mix(in oklch,var(--pri) 8%,transparent)" }}>
            <div className="flex flex-wrap overflow-hidden rounded-[15px] border border-line bg-surface text-left">
              <div className="flex min-w-0 flex-[1.5_1_380px] flex-col gap-4 p-[22px]">
                <div className={`${mono} flex items-center gap-2 text-[11px] font-medium text-ink3`}>
                  <span className="h-[7px] w-[7px] rounded-full bg-pri" style={{ boxShadow: "0 0 10px var(--pri)" }} />ask tutor · class 10 science · electricity
                </div>
                <div className="max-w-[80%] self-end rounded-[14px_14px_4px_14px] border border-line bg-surface2 px-[15px] py-[11px] text-sm">Why is the current the same everywhere in a series circuit?</div>
                <div className="flex gap-3">
                  <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px] bg-pri-soft text-pri"><Icon name="auto_awesome" size={17} /></span>
                  <div className="text-sm leading-[1.7]">
                    There&apos;s only one path for charge, so every resistor carries the same current <Cite n={1} on />. The voltages across each one add up to the total <Cite n={2} />, which is why one fused bulb switches the whole string off <Cite n={3} />.
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 lg:pl-[42px]">
                  {["[1] Slide 14", "[2] p. 208 · Fig. 11.6", "[3] Video 6 · 12:34"].map((t, i) => (
                    <span key={t} className={`${mono} flex-none whitespace-nowrap rounded-md border px-[9px] py-[5px] text-[11px] font-medium`} style={{ borderColor: i ? "var(--line)" : "var(--pri)", color: i ? "var(--ink2)" : "var(--pri-ink)" }}>{t}</span>
                  ))}
                </div>
              </div>
              <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3 border-l border-line bg-bg p-[22px]">
                <div className={`${mono} text-[11px] font-medium text-ink3`}>[1] source viewer</div>
                <div className="flex aspect-[16/10] flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-4">
                  <div className="font-display text-[15px] font-semibold">Resistors in series</div>
                  {["Same current I through every resistor", "Rs = R₁ + R₂ + R₃", "V = V₁ + V₂ + V₃"].map((t) => (
                    <div key={t} className="text-xs text-ink2"><span className="text-pri">•</span> {t}</div>
                  ))}
                  <div className={`${mono} mt-auto self-end text-[10px] text-ink3`}>14 / 32</div>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-pri-ink"><Icon name="verified" size={15} fill />Linked to your class material</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section id="how" className="mx-auto flex max-w-[1180px] flex-col items-center gap-2.5 px-4 pb-2 pt-20 text-center sm:px-6">
        <Kick>How it works</Kick>
        <H2>From class notes to exam-ready in four steps</H2>
        <p className="m-0 max-w-[520px] text-ink2">Use what your teacher already shared. Nothing to retype or reformat.</p>
        <div className="relative mt-12 grid w-full gap-7 sm:grid-cols-2 lg:grid-cols-4">
          <div className="absolute left-[12.5%] right-[12.5%] top-[22px] hidden h-px opacity-50 lg:block" style={{ background: "linear-gradient(90deg,transparent,var(--ink3),transparent)" }} />
          {STEPS.map(([icon, t, d], i) => (
            <div key={t} className="relative flex flex-col items-center gap-2.5">
              <div className="relative grid h-11 w-11 place-items-center rounded-[11px] border border-line bg-surface">
                <Icon name={icon} size={21} />
                <span className={`${mono} absolute -right-[7px] -top-[7px] grid h-[17px] w-[17px] place-items-center rounded-full border border-pri text-[9px] font-semibold text-pri-ink`} style={{ background: "color-mix(in oklch,var(--pri) 30%,var(--surface))" }}>{i + 1}</span>
              </div>
              <div className="mt-1.5 text-[15px] font-semibold">{t}</div>
              <div className="max-w-[210px] text-[13px] text-ink2">{d}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="model" className="mx-auto flex max-w-[1180px] flex-col items-center gap-2.5 px-4 pb-6 pt-[72px] text-center sm:px-6">
        <Kick>Inside the model</Kick>
        <H2>What happens between your question and the answer</H2>
        <p className="m-0 max-w-[560px] text-ink2">Every answer passes through five stages. Each one leaves a trail, so the final reply can point to the exact place it came from.</p>
        <div className="mt-9 w-full rounded-[20px] border border-line p-2 text-left" style={{ background: "linear-gradient(180deg,var(--surface),color-mix(in oklch,var(--surface) 40%,transparent))" }}>
          <div className="grid gap-2 sm:grid-cols-6 xl:grid-cols-5">
            {STAGES.map(([icon, t, d, tags], i) => (
              <div key={t} className={`relative flex flex-col gap-2.5 rounded-[14px] border border-line bg-bg p-[18px] ${i < 3 ? "sm:col-span-2" : "sm:col-span-3"} xl:col-span-1`}>
                <div className="flex items-center justify-between">
                  <span className={`${mono} text-[11px] font-medium text-pri-ink`}>0{i + 1}</span>
                  <Icon name={icon} size={19} className="text-ink2" />
                </div>
                <div className="text-[15px] font-semibold">{t}</div>
                <div className="text-[13px] text-ink2">{d}</div>
                <div className="mt-auto flex flex-wrap gap-[5px] pt-1">
                  {tags.map((x) => <span key={x} className={`${mono} flex-none whitespace-nowrap rounded-[5px] border border-line px-[7px] py-[3px] text-[10px] font-medium text-ink3`}>{x}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
        <ModelDemo />
      </section>

      <section id="paths" className="mx-auto flex max-w-[1180px] flex-col items-center gap-2.5 px-4 pb-10 pt-[72px] text-center sm:px-6">
        <Kick>Who is it for?</Kick>
        <H2>Made for students, run by schools</H2>
        <p className="m-0 max-w-[520px] text-ink2">Students learn in the app. Teachers and content teams keep the material accurate from the admin console.</p>
        <div className="mt-3.5 inline-flex gap-0.5 rounded-full border border-line bg-surface p-[3px]">
          {([["student", "Students"], ["admin", "Schools"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className="h-[34px] whitespace-nowrap rounded-full border-0 px-[26px] text-[13px] font-semibold" style={{ background: tab === k ? "var(--ink)" : "transparent", color: tab === k ? "var(--bg)" : "var(--ink2)" }}>{l}</button>
          ))}
        </div>
        <div className="mt-7 grid w-full gap-3.5 text-left" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
          {cards.map((c) => (
            <Link key={c.t} href={cardHref} className="relative flex min-h-[180px] flex-col gap-1.5 overflow-hidden rounded-2xl border border-line p-[18px] text-inherit hover:border-ink3 hover:no-underline" style={{ background: `linear-gradient(180deg,var(--surface) 30%,${c.glow})` }}>
              <div className="flex items-start justify-between">
                <span className={`${mono} whitespace-nowrap rounded-md border border-line bg-bg px-2 py-[3px] text-[11px] font-medium text-ink2`}>{c.tag}</span>
                <span className="grid h-[30px] w-[30px] place-items-center rounded-full border border-line bg-bg"><Icon name={c.icon} size={16} className="text-ink2" /></span>
              </div>
              <div className="mt-auto flex items-center gap-1.5 text-[17px] font-semibold">{c.t}<Icon name="arrow_outward" size={16} /></div>
              <div className="text-[13px] text-ink2">{c.d}</div>
            </Link>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto flex max-w-[1180px] flex-col items-center gap-2.5 px-4 pb-20 pt-14 text-center sm:px-6">
        <Kick>Why IntelliNova?</Kick>
        <H2>Why students trust it</H2>
        <p className="m-0 max-w-[520px] text-ink2">Built around the things that make most study apps hard to rely on.</p>
        <div className="mt-9 grid w-full gap-3.5 text-left" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))" }}>
          {FEATURES.map(([icon, t, d]) => (
            <div key={t} className="flex flex-col gap-2 rounded-2xl border border-line p-5" style={{ background: "linear-gradient(180deg,var(--surface),color-mix(in oklch,var(--surface) 50%,transparent))" }}>
              <div className="mb-2 grid h-[38px] w-[38px] place-items-center rounded-[10px] border border-line bg-surface2"><Icon name={icon} /></div>
              <div className="text-[15px] font-semibold">{t}</div>
              <div className="text-[13px] text-ink2">{d}</div>
            </div>
          ))}
        </div>
      </section>

      {showQuality && (
        <section id="trust" className="relative border-y border-line" style={{ background: "radial-gradient(40% 90% at 50% 0%,color-mix(in oklch,var(--pri) 12%,transparent),transparent 75%)" }}>
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-10 px-4 py-20 sm:px-6">
            <div className="flex flex-[1_1_320px] flex-col gap-2.5">
              <Kick>We check our work</Kick>
              <h2 className="m-0 font-display font-semibold leading-[1.2] tracking-[-0.02em]" style={{ fontSize: "clamp(24px,3vw,32px)" }}>Tested on real student questions before every update</h2>
              <p className="m-0 text-sm text-ink2">
                Before anything reaches you, our team runs IntelliNova through a held-out bank of real questions, including ones it should refuse. These are the results of evaluation run {q!.run}
                {q!.date ? ` on ${q!.date}` : ""}{q!.cases ? `, across ${q!.cases} questions` : ""}.
              </p>
            </div>
            <div className="grid flex-[1.3_1_420px] gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
              {q!.metrics!.map((m) => (
                <div key={m.l} className="rounded-[14px] border border-line bg-surface p-[18px]">
                  <div className="grad-text font-display text-[30px] font-semibold leading-none">{m.v}</div>
                  <div className="mt-2 text-xs text-ink2">{m.l}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto grid max-w-[1180px] gap-3.5 px-4 py-[72px] sm:px-6" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        {[
          ["/signup", "for students", "Open the student app", "Setup takes two minutes. Tell us your class and subjects, answer a few warm-up questions, and you’re in.", "pri"],
          ["/admin/login", "for schools & content teams", "Open the admin console", "Upload material, review what the AI creates, keep facts current and see how well it’s working.", "teal"],
        ].map(([href, tag, t, d, tone]) => (
          <Link key={href} href={href} className="relative flex min-h-[200px] flex-col gap-2.5 overflow-hidden rounded-[20px] border border-line p-[30px] text-inherit hover:no-underline" style={{ background: `linear-gradient(180deg,var(--surface) 20%,color-mix(in oklch,var(--${tone}) 22%,var(--surface)))` }}>
            <span className={`${mono} self-start whitespace-nowrap rounded-md border border-line bg-bg px-2 py-[3px] text-[11px] font-medium text-ink2`}>{tag}</span>
            <div className="mt-auto flex items-center gap-2 font-display text-2xl font-semibold tracking-[-0.02em]">{t}<Icon name="arrow_outward" size={22} /></div>
            <div className="max-w-[44ch] text-sm text-ink2">{d}</div>
          </Link>
        ))}
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-4 py-[22px] text-xs text-ink3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="h-5 w-5 rounded-md" style={{ background: "var(--grad)" }} />
            <span className={mono}>IntelliNova · © {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-[18px]">
            <Link href="/signup" className="text-ink2">Student app</Link>
            <Link href="/admin/login" className="text-ink2">Admin console</Link>
            <Link href="/privacy" className="text-ink2">Privacy</Link>
            <Link href="/terms" className="text-ink2">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
