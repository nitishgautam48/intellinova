"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button, Card, Chip, Empty, ErrorState, Icon, LinkButton, Loading, PageHead, Segmented } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Setup = {
  chapters: { id: string; name: string; subject: string; topics: { id: string; name: string; mastery: number | null }[] }[];
  current_chapter_id: string | null;
  history: { id: string; t: string; mode: string; when: string; m: string; icon: string }[];
  active_quiz_id: string | null;
};

const TYPES = ["MCQ", "Short answer", "Numerical"];

function Builder() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: s, error, mutate } = useApi<Setup>("/api/practice/setup");
  const [mode, setMode] = useState<"Quiz" | "Mock exam">("Quiz");
  const [chapter, setChapter] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<string[]>([...TYPES]);
  const [diff, setDiff] = useState("Adaptive");
  const [n, setN] = useState(5);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!s || chapter) return;
    const pre = (params.get("topics") || "").split(",").filter(Boolean);
    const withPre = pre.length ? s.chapters.find((c) => c.topics.some((t) => pre.includes(t.id))) : null;
    const ch = withPre || s.chapters.find((c) => c.id === s.current_chapter_id) || s.chapters[0];
    if (ch) {
      setChapter(ch.id);
      setSel(new Set(pre.length ? pre : ch.topics.map((t) => t.id)));
    }
  }, [s, chapter, params]);

  const cur = useMemo(() => s?.chapters.find((c) => c.id === chapter), [s, chapter]);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!s) return <Loading />;

  const start = async () => {
    if (!sel.size) return toast.error("Pick at least one topic.");
    if (!types.length) return toast.error("Pick at least one question type.");
    setBusy(true);
    try {
      const q = await api.post<{ id: string }>("/api/practice/quizzes", { topic_ids: [...sel], types, difficulty: diff, n, mode });
      router.push(`/app/practice/${q.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  const toggle = (id: string) => setSel((x) => {
    const y = new Set(x);
    if (y.has(id)) y.delete(id);
    else y.add(id);
    return y;
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Practice" sub="Pick your chapters and question types, and we'll make a quiz from your own material." />
      {s.active_quiz_id && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-pri-soft px-5 py-3.5 text-pri-ink">
          <Icon name="pending_actions" />
          <div className="flex-1 font-semibold">You have a quiz in progress.</div>
          <LinkButton href={`/app/practice/${s.active_quiz_id}`} size="sm" variant="solid">
            Resume
          </LinkButton>
        </div>
      )}
      {s.chapters.length === 0 ? (
        <Empty icon="quiz" title="Nothing to practise yet">
          Quizzes are built from your class material. Once chapters for your subjects are published and material is added, you can practise here.
        </Empty>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <Card className="flex min-w-0 flex-[2_1_480px] flex-col gap-[22px] rounded-[18px] p-6">
            <div className="flex flex-col gap-2.5">
              <div className="font-bold">Mode</div>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
                {(
                  [
                    ["Quiz", "Untimed · instant feedback after each question", "quiz"],
                    ["Mock exam", "Timed · feedback at the end", "timer"],
                  ] as const
                ).map(([v, d, i]) => {
                  const on = mode === v;
                  return (
                    <button key={v} onClick={() => setMode(v)} className="flex items-start gap-3 rounded-[14px] p-3.5 text-left" style={{ border: `1.5px solid ${on ? "var(--pri)" : "var(--line)"}`, background: on ? "var(--pri-soft)" : "var(--surface)" }}>
                      <Icon name={i} size={22} className="text-pri" />
                      <span>
                        <span className="block font-bold" style={{ color: on ? "var(--pri-ink)" : "var(--ink)" }}>{v}</span>
                        <span className="block text-xs text-ink2">{d}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-bold">Scope</div>
                <div className="text-xs text-ink2">{sel.size} topics selected · current mastery shown</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.chapters.map((c) => (
                  <Chip key={c.id} icon={false} on={chapter === c.id} onClick={() => (setChapter(c.id), setSel(new Set(c.topics.map((t) => t.id))))} className="h-[34px] px-3">
                    {c.name}
                  </Chip>
                ))}
              </div>
              <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
                {cur?.topics.map((t) => (
                  <button key={t.id} onClick={() => toggle(t.id)} className="flex items-center gap-2.5 border-0 bg-transparent py-2 text-left">
                    <Icon name={sel.has(t.id) ? "check_box" : "check_box_outline_blank"} size={22} style={{ color: sel.has(t.id) ? "var(--pri)" : "var(--ink3)" }} />
                    <span className="min-w-0 flex-1 text-[13px] font-medium">{t.name}</span>
                    <span className="font-mono text-[11px] font-medium text-ink3">{t.mastery !== null ? t.mastery.toFixed(2) : "—"}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="font-bold">Question types</div>
              <div className="flex flex-wrap gap-2">
                {TYPES.map((t) => (
                  <Chip key={t} on={types.includes(t)} onClick={() => setTypes((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}>
                    {t}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <div className="flex flex-col gap-2.5">
                <div className="font-bold">Difficulty</div>
                <Segmented value={diff} onChange={setDiff} options={["Adaptive", "Easy", "Medium", "Hard"].map((v) => ({ v, l: v }))} />
                <div className="max-w-[36ch] text-xs text-ink2">Adaptive starts near your current mastery and adjusts after each answer.</div>
              </div>
              <div className="flex min-w-[200px] flex-1 flex-col gap-2.5">
                <div className="flex justify-between">
                  <span className="font-bold">Questions</span>
                  <span className="font-display text-lg font-semibold text-pri-ink">{n}</span>
                </div>
                <input type="range" min={3} max={30} value={n} onChange={(e) => setN(+e.target.value)} className="w-full" style={{ accentColor: "var(--pri)" }} />
              </div>
            </div>
          </Card>
          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
            <Card className="flex flex-col gap-3 rounded-[18px]">
              <div className="font-display text-[17px] font-semibold">Before you start</div>
              <div className="flex gap-2.5 text-[13px]">
                <Icon name="verified" size={18} style={{ color: "var(--ok)" }} />
                <div>
                  <strong>Verified questions only.</strong> Each answer key is re-derived by a solver or checked by a second model before you see it.
                </div>
              </div>
              <div className="flex gap-2.5 text-[13px]">
                <Icon name="block" size={18} style={{ color: "var(--teal)" }} />
                <div>
                  <strong>No repeats.</strong> Questions you&apos;ve already answered are left out while fresh ones exist.
                </div>
              </div>
              <div className="flex gap-2.5 text-[13px]">
                <Icon name="link" size={18} style={{ color: "var(--pri)" }} />
                <div>Every question shows the page, slide or timestamp it came from.</div>
              </div>
              <Button variant="primary" className="mt-1 h-12 rounded-xl text-[15px]" icon="auto_awesome" loading={busy} onClick={start}>
                Generate {n} questions
              </Button>
            </Card>
            <Card className="rounded-[18px]">
              <div className="mb-1.5 font-display text-[15px] font-semibold">Past assessments</div>
              {s.history.length === 0 && <div className="border-t border-line py-3 text-[13px] text-ink2">Your finished quizzes will appear here.</div>}
              {s.history.map((h) => (
                <div key={h.id} className="flex items-center gap-3 border-t border-line py-2.5">
                  <Icon name={h.icon} className="text-ink2" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold">{h.t}</div>
                    <div className="text-xs text-ink2">{h.m}</div>
                  </div>
                  <Link href={`/app/practice/${h.id}`} className="text-[13px] font-semibold">
                    Report
                  </Link>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PracticePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Builder />
    </Suspense>
  );
}
