"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Panel, Table, Row } from "@/components/admin/kit";
import { Alert, Bar, Button, Checkbox, Empty, ErrorState, Field, Icon, Input, Loading, Segmented, Select, Tabs, Textarea } from "@/components/ui";
import { Confirm, Modal } from "@/components/ui/dialog";
import { api, PORTAL_HEADER, useApi } from "@/lib/api";
import { f2 } from "@/lib/utils";

type MetricKey = "faith" | "relev" | "cprec" | "crec" | "refuse" | "cite";
type CaseResult = {
  q: string; category: string; off: boolean; status: string; expected: string[]; cited: string[];
  faith: number | null; relev: number | null; cprec: number | null; crec: number | null; cite: number | null;
  latency_s: number; answer: string; reference: string;
};
type Extra = { answered: number | null; latency_avg_s: number | null; latency_p90_s: number | null; models: Record<string, string | number> };
type Run = {
  id: string; number: number; framework: string; pipeline: string; status: string; progress: number; error: string; when: string; date: string;
  metrics: { values: Partial<Record<MetricKey, number | null>>; targets: Record<MetricKey, number>; engine: string; engine_note?: string; n_cases: number; n_off: number; n_off_handled: number; extra?: Extra; cases?: CaseResult[] } | null;
  categories: { l: string; n: number; faith: number | null; relev: number | null; cprec: number | null; crec: number | null }[] | null;
  failures: { q: string; w: string; m: string; score: number | null }[] | null;
  question_bank: { generated: number; verified: number; disagreement: number; rejected: number; duplicate: number } | null;
  simulation: { sessions: number; adaptive: number[]; baseline: number[]; personas: { t: string; a: number; b: number; g: number; r: string; curve: number[] }[]; synthetic_bank: boolean; bank_size: number; mode?: "engine" | "model"; topics?: string[]; answers?: number; students?: number } | null;
};
type Runs = { runs: Run[]; cases: number; off_material: number; labels: Record<MetricKey, string>; targets: Record<MetricKey, number> };
type Case = { id: string; question: string; expected_answer: string; expected_locations: string[]; category: string; off_material: boolean; subject_id?: string | null };
type Subject = { id: string; board: string; class_level: string; name: string };
type BankTopic = { topic_id: string; topic: string; chapter: string; subject: string; verified: number; ready: boolean };
type Bank = {
  topics: BankTopic[]; ready: number; min: number;
  prep: { status: "queued" | "running" | "done"; done: number; total: number; generated: number; skipped: string[]; stopped?: boolean } | null;
  stats: { generated: number; verified: number; disagreement: number; rejected: number; duplicate: number };
};

const ORDER: MetricKey[] = ["faith", "relev", "cprec", "crec", "refuse", "cite"];
const CATS = ["Textbook page", "Video timestamp", "Slide number", "Diagram / figure"];
const FW = ["RAGAS", "DeepEval", "TruLens"] as const;

function Spark({ vals }: { vals: number[] }) {
  if (vals.length < 2) return <svg width="82" height="30" />;
  const mn = Math.min(...vals), mx = Math.max(...vals), span = mx - mn || 1;
  const pts = vals.map((v, i) => [2 + (78 * i) / (vals.length - 1), 27 - (24 * (v - mn)) / span]);
  const last = pts[pts.length - 1];
  return (
    <svg width="82" height="30" viewBox="0 0 82 30">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" strokeWidth="2" style={{ stroke: "var(--pri)" }} />
      <circle cx={last[0]} cy={last[1]} r="3" style={{ fill: "var(--pri)" }} />
    </svg>
  );
}

function SimChart({ sim }: { sim: NonNullable<Run["simulation"]> }) {
  const W = 600, H = 220, x0 = 44, x1 = 590, y0 = 16, y1 = 196;
  const n = sim.sessions;
  const x = (i: number) => x0 + ((x1 - x0) * i) / n;
  const y = (v: number) => y1 - (y1 - y0) * v;
  const path = (c: number[]) => c.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mt-2.5 block">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={x0} x2={x1} y1={y(g)} y2={y(g)} style={{ stroke: "var(--line)" }} />
          <text x={36} y={y(g)} textAnchor="end" dominantBaseline="middle" style={{ fill: "var(--ink3)", font: "500 10px var(--font-mono)" }}>{g.toFixed(2)}</text>
        </g>
      ))}
      {Array.from({ length: n + 1 }, (_, i) => i).filter((i) => i % 2 === 0).map((i) => (
        <text key={i} x={x(i)} y={214} textAnchor="middle" style={{ fill: "var(--ink3)", font: "500 10px var(--font-mono)" }}>{i === 0 ? "start" : `s${i}`}</text>
      ))}
      {sim.personas.map((p) => <path key={p.t} d={path(p.curve)} fill="none" strokeWidth="1" style={{ stroke: "var(--pri)", opacity: 0.22 }} />)}
      <path d={path(sim.baseline)} fill="none" strokeWidth="2.5" strokeDasharray="6 5" style={{ stroke: "var(--ink3)" }} />
      <path d={path(sim.adaptive)} fill="none" strokeWidth="3" style={{ stroke: "var(--pri)" }} />
    </svg>
  );
}

/** Downloads a file from the API with the session cookie, refreshing an expired session once. */
async function download(path: string, name: string) {
  const init: RequestInit = { credentials: "include", headers: { [PORTAL_HEADER]: "admin" } };
  let res = await fetch(path, init);
  if (res.status === 401 && (await fetch("/api/auth/refresh", { method: "POST", ...init })).ok) res = await fetch(path, init);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const dl = (path: string, name: string) => {
  download(path, name).catch((e) => toast.error((e as Error).message));
};

const STATUS_TONE: Record<string, [string, string]> = {
  answered: ["var(--ok-soft)", "var(--ok-ink)"],
  declined: ["var(--warn-soft)", "var(--warn-ink)"],
};

function CaseTable({ cases, targets }: { cases: CaseResult[]; targets: Record<MetricKey, number> }) {
  const [open, setOpen] = useState<number | null>(null);
  const [only, setOnly] = useState<"all" | "low" | "off">("all");
  const low = (c: CaseResult) => !c.off && (["faith", "relev", "cprec", "crec", "cite"] as const).some((k) => c[k] !== null && c[k]! < (targets[k] ?? 0.8) - 0.1);
  const shown = cases.map((c, i) => ({ c, i })).filter(({ c }) => only === "all" || (only === "off" ? c.off : low(c)));
  const cols = "2.6fr .9fr repeat(5,.62fr) .6fr";
  return (
    <Table
      cols={cols}
      minWidth={880}
      title="Per-question results"
      sub="Click a question to compare the tutor's answer with the reference and see what it cited."
      right={<Segmented size="sm" value={only} onChange={setOnly} options={[{ v: "all", l: `All ${cases.length}` }, { v: "low", l: `Below target ${cases.filter(low).length}` }, { v: "off", l: `Off-material ${cases.filter((c) => c.off).length}` }]} />}
      headers={["Question", "Outcome", "Faithful", "Relev.", "Ctx prec.", "Ctx rec.", "Citation", "Time"]}
      empty="No questions match this filter."
    >
      {shown.map(({ c, i }) => {
        const [bg, ink] = STATUS_TONE[c.status] || ["var(--surface2)", "var(--ink2)"];
        const good = c.off ? c.status === "declined" : c.status === "answered";
        return (
          <div key={i} className="border-t border-line">
            <button onClick={() => setOpen(open === i ? null : i)} className="grid w-full items-center gap-2.5 border-0 bg-transparent px-4 py-[10px] text-left text-[13px] hover:bg-surface2" style={{ gridTemplateColumns: cols }} aria-expanded={open === i}>
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon name={open === i ? "expand_less" : "expand_more"} size={18} className="flex-none text-ink3" />
                <span className="truncate font-semibold" title={c.q}>{c.q}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="rounded-md px-[7px] py-0.5 text-[11px] font-bold capitalize" style={{ background: bg, color: ink }}>{c.status}</span>
                {c.off && <Icon name={good ? "check_circle" : "error"} size={15} style={{ color: good ? "var(--ok-ink)" : "var(--err-ink)" }} />}
              </span>
              {(["faith", "relev", "cprec", "crec", "cite"] as const).map((k) => (
                <span key={k} className="font-mono text-xs" style={{ color: c.off ? "var(--ink3)" : scoreColor(c[k], targets[k]) }}>{c.off ? "—" : f2(c[k])}</span>
              ))}
              <span className="font-mono text-xs text-ink2">{c.latency_s.toFixed(1)}s</span>
            </button>
            {open === i && (
              <div className="grid gap-3 bg-surface2 px-4 py-3 text-[13px]" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
                <div className="min-w-0">
                  <div className="mb-1 font-mono text-[10px] font-semibold uppercase text-ink2">Tutor answer</div>
                  <div className="whitespace-pre-wrap break-words">{c.answer || <span className="text-ink3">No answer text.</span>}</div>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 font-mono text-[10px] font-semibold uppercase text-ink2">{c.off ? "Expected behaviour" : "Reference answer"}</div>
                  <div className="whitespace-pre-wrap break-words">{c.off ? "Decline or flag: this isn't in the class material." : c.reference || <span className="text-ink3">None given.</span>}</div>
                  {!c.off && (
                    <div className="mt-2 text-xs text-ink2">
                      Expected <span className="font-mono">{c.expected.join(", ") || "—"}</span> · cited <span className="font-mono">{c.cited.join(", ") || "nothing"}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Table>
  );
}

function scoreColor(v: number | null, target = 0.8) {
  if (v === null) return "var(--ink3)";
  return v >= target ? "var(--ok-ink)" : v >= target - 0.1 ? "var(--warn-ink)" : "var(--err-ink)";
}

function Results({ data, onRun }: { data: Runs; onRun: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const [fw, setFw] = useState<(typeof FW)[number]>("RAGAS");
  const [busy, setBusy] = useState(false);
  const run = data.runs.find((r) => r.id === pick) || data.runs.find((r) => r.status === "completed") || data.runs[0];
  const active = data.runs.find((r) => r.status === "queued" || r.status === "running");
  const history = useMemo(() => [...data.runs].filter((r) => r.status === "completed").reverse(), [data.runs]);

  const start = async () => {
    setBusy(true);
    try {
      await api.post("/api/admin/eval/runs", { framework: fw });
      toast.success("Evaluation started");
      onRun();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={fw} onChange={setFw} options={FW.map((v) => ({ v, l: v }))} />
        <div className="flex flex-wrap gap-1">
          {data.runs.slice(0, 6).map((r) => {
            const on = r.id === run?.id;
            return (
              <button key={r.id} onClick={() => setPick(r.id)} className="h-8 rounded-full border px-2.5 font-mono text-[11px] font-semibold" style={{ borderColor: on ? "var(--ink)" : "var(--line)", background: on ? "var(--ink)" : "var(--surface)", color: on ? "var(--bg)" : "var(--ink)" }}>
                Run {r.number}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {run?.status === "completed" && (
          <>
            <Button icon="description" onClick={() => dl(`/api/admin/eval/runs/${run.id}/report.md`, `intellinova-eval-run-${run.number}.md`)}>Report</Button>
            <Button icon="table_view" onClick={() => dl(`/api/admin/eval/runs/${run.id}/report.csv`, `intellinova-eval-run-${run.number}.csv`)}>CSV</Button>
          </>
        )}
        <Button variant="primary" icon="play_arrow" loading={busy} disabled={!!active || !data.cases} onClick={start}>Run evaluation</Button>
      </div>
    </div>
  );

  if (!data.runs.length) {
    return (
      <div className="flex flex-col gap-4">
        {head}
        <Empty icon="query_stats" title="No evaluation runs yet" >
          {data.cases ? "Run the harness to measure faithfulness, relevancy, retrieval quality and citation accuracy on your test set." : "Add test questions in the Test set tab first. Each needs the answer and where it can be found in your sources."}
        </Empty>
      </div>
    );
  }

  // Results only exist once a run has scored something (a queued run's fields are empty).
  const m = run.metrics?.values ? run.metrics : null;
  const sim = run.simulation?.adaptive?.length ? run.simulation : null;
  const qb = run.question_bank && "verified" in run.question_bank ? run.question_bank : null;
  const ex = m?.extra;
  const gain = (c: number[]) => (c.length ? c[c.length - 1] - c[0] : 0);

  return (
    <div className="flex flex-col gap-4">
      {head}
      {active && (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
          <Icon name="progress_activity" size={18} className="text-pri" style={{ animation: "spin 1s linear infinite" }} />
          <span className="font-semibold">Run {active.number} {active.status}</span>
          <Bar value={active.progress * 100} className="flex-1" height={6} />
          <span className="font-mono text-xs text-ink2">{Math.round(active.progress * 100)}%</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
        <strong>Run {run.number} · {run.date}</strong>
        <span className="text-ink2">Framework: {run.framework}{m?.engine ? (m.engine === "builtin" ? " · built-in judges" : ` · official ${run.framework} package`) : ""}</span>
        {m && <span className="text-ink2">Test set: {m.n_cases} questions</span>}
        {m && <span className="rounded-md bg-surface2 px-2 py-[3px] text-xs font-semibold">{m.n_cases - m.n_off} with known source locations</span>}
        {m && <span className="rounded-md bg-warn-soft px-2 py-[3px] text-xs font-semibold text-warn-ink">{m.n_off} off-material</span>}
        {run.pipeline && <span className="truncate font-mono text-[11px] text-ink3" title={run.pipeline}>{run.pipeline}</span>}
      </div>
      {m?.engine_note && (
        <div className="flex items-start gap-2 rounded-xl bg-surface2 px-4 py-2.5 text-xs text-ink2">
          <Icon name="info" size={16} className="mt-px flex-none" />
          {m.engine_note}
        </div>
      )}
      {run.status === "failed" && <Alert>Run {run.number} failed: {run.error || "unknown error"}</Alert>}
      {m && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))" }}>
          {ORDER.map((k) => {
            const v = m.values[k] ?? null;
            const tgt = m.targets[k] ?? data.targets[k];
            const ok = v !== null && v >= tgt;
            return (
              <div key={k} className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-4">
                <div className="text-[13px] text-ink2">{data.labels[k]}</div>
                <div className="flex items-end justify-between gap-2">
                  <span className="font-display text-[28px] font-semibold leading-none">{f2(v)}</span>
                  <Spark vals={history.map((r) => r.metrics?.values?.[k]).filter((x): x is number => typeof x === "number")} />
                </div>
                <div className="flex items-center gap-1 text-xs font-semibold" style={{ color: v === null ? "var(--ink3)" : ok ? "var(--ok-ink)" : "var(--warn-ink)" }}>
                  <Icon name={v === null ? "remove" : ok ? "check_circle" : "error"} size={15} />
                  {v === null ? "Not measured" : `Target ${tgt.toFixed(2)}${ok ? " met" : ""}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {ex && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
          {([
            ["task_alt", "Answered from material", ex.answered === null ? "—" : `${Math.round(ex.answered * 100)}%`, "In-material questions the tutor answered rather than declined"],
            ["timer", "Average answer time", ex.latency_avg_s === null ? "—" : `${ex.latency_avg_s.toFixed(1)}s`, "Retrieval + answer + citation check, per question"],
            ["speed", "90th percentile time", ex.latency_p90_s === null ? "—" : `${ex.latency_p90_s.toFixed(1)}s`, "9 in 10 questions were answered within this"],
          ] as const).map(([icon, l, v, hint]) => (
            <div key={l} title={hint} className="flex items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3">
              <Icon name={icon} size={22} className="text-ink2" />
              <div className="min-w-0">
                <div className="font-display text-lg font-semibold leading-tight">{v}</div>
                <div className="truncate text-xs text-ink2">{l}</div>
              </div>
            </div>
          ))}
          <div className="flex min-w-0 flex-col justify-center rounded-[14px] border border-line bg-surface px-4 py-2.5 text-xs text-ink2">
            {([["answer", "Answers"], ["judge", "Judge"], ["embeddings", "Embeddings"], ["rerank", "Re-ranker"], ["k", "Passages (k)"], ["num_ctx", "Context tokens"]] as const)
              .filter(([k]) => ex.models[k] !== undefined)
              .map(([k, l]) => (
                <div key={k} className="flex justify-between gap-2"><span className="flex-none">{l}</span><span className="truncate font-mono text-ink" title={String(ex.models[k])}>{String(ex.models[k])}</span></div>
              ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1.5_1_480px]">
          <Table cols="1.6fr .6fr repeat(4,1fr)" minWidth={560} title="By source location" headers={["Source location", "N", "Faithful", "Relevancy", "Ctx prec.", "Ctx recall"]} empty="No in-material questions in this run.">
            {(run.categories || []).map((c) => (
              <Row key={c.l} cols="1.6fr .6fr repeat(4,1fr)">
                <strong>{c.l}</strong>
                <span className="font-mono text-ink2">{c.n}</span>
                {(["faith", "relev", "cprec", "crec"] as const).map((k) => (
                  <span key={k} className="font-mono" style={{ color: scoreColor(c[k], data.targets[k]) }}>{f2(c[k])}</span>
                ))}
              </Row>
            ))}
            {m && m.n_off > 0 && (
              <div className="grid items-center gap-2.5 border-t border-line bg-warn-soft px-4 py-[11px] text-[13px]" style={{ gridTemplateColumns: "1.6fr .6fr 4fr" }}>
                <strong>Off-material</strong>
                <span className="font-mono text-ink2">{m.n_off}</span>
                <span>Declined or flagged <strong>{m.n_off_handled} of {m.n_off}</strong>, with outside knowledge kept separate from cited content</span>
              </div>
            )}
          </Table>
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <Panel title="Failing examples">
            {run.failures?.length ? (
              run.failures.map((f, i) => (
                <div key={i} className="border-t border-line py-2.5">
                  <div className="flex justify-between gap-2">
                    <span className="text-[13px] font-semibold">{f.q}</span>
                    <span className="self-start whitespace-nowrap rounded-md bg-err-soft px-[7px] py-0.5 text-[11px] font-bold text-err-ink">{f.m}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink2">{f.w}</div>
                </div>
              ))
            ) : (
              <div className="border-t border-line py-3 text-[13px] text-ink2">{run.status === "completed" ? "No failing examples in this run." : "Waiting for results."}</div>
            )}
          </Panel>
          <Panel title="Question bank checks" sub="Solver re-derivation plus cross-model validation">
            {qb ? (
              ([
                ["quiz", "Questions generated", qb.generated],
                ["verified", "Verified by both checks", qb.verified],
                ["compare_arrows", "Models disagreed (held back)", qb.disagreement],
                ["block", "Rejected by solver", qb.rejected],
                ["content_copy", "Near-duplicates removed", qb.duplicate],
              ] as const).map(([icon, l, v]) => (
                <div key={l} className="flex items-center gap-2.5 border-t border-line py-2 text-[13px]">
                  <Icon name={icon} size={18} className="text-ink2" />
                  <span className="flex-1">{l}</span>
                  <strong className="font-mono">{v}</strong>
                </div>
              ))
            ) : (
              <div className="border-t border-line py-3 text-[13px] text-ink2">Not measured in this run.</div>
            )}
          </Panel>
        </div>
      </div>
      {!!m?.cases?.length && <CaseTable cases={m.cases} targets={m.targets ?? data.targets} />}
      {sim && (
        <Panel className="flex flex-wrap gap-5">
          <div className="min-w-0 flex-[1.4_1_460px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="font-display text-[15px] font-semibold">Personalisation · simulated students</div>
                <div className="text-xs text-ink2">
                  {sim.mode === "engine"
                    ? `${sim.students} simulated students took ${sim.answers} questions through the live quiz engine (${sim.topics?.join(", ")}), rolled back afterwards · ${sim.sessions} sessions`
                    : `${sim.personas.length} profiles × ${sim.sessions} sessions · model-based: no topic has ${8}+ verified MCQ/numerical questions yet (prepare them in the Question bank tab) · ${sim.synthetic_bank ? "nominal question bank" : `${sim.bank_size} verified questions`}`}
                </div>
              </div>
              <div className="flex gap-3 text-xs text-ink2">
                <span className="flex items-center gap-1.5"><span className="h-[3px] w-3.5 rounded-sm bg-pri" />Adaptive</span>
                <span className="flex items-center gap-1.5"><span className="h-[3px] w-3.5 rounded-sm bg-ink3" />Fixed-order baseline</span>
              </div>
            </div>
            <div className="overflow-auto"><SimChart sim={sim} /></div>
          </div>
          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-pri-soft p-3"><div className="font-display text-xl font-semibold leading-none text-pri-ink">+{gain(sim.adaptive).toFixed(2)}</div><div className="mt-1 text-[11px] text-ink2">Mastery gain · adaptive</div></div>
              <div className="rounded-xl bg-surface2 p-3"><div className="font-display text-xl font-semibold leading-none">+{gain(sim.baseline).toFixed(2)}</div><div className="mt-1 text-[11px] text-ink2">Baseline gain</div></div>
              <div className="rounded-xl bg-ok-soft p-3"><div className="font-display text-xl font-semibold leading-none text-ok-ink">{sim.personas.length ? `${(sim.personas.reduce((a, p) => a + parseFloat(p.r), 0) / sim.personas.length).toFixed(1)}%` : "—"}</div><div className="mt-1 text-[11px] text-ink2">Question repetition</div></div>
            </div>
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="grid gap-2 bg-surface2 px-3 py-2 font-mono text-[10px] font-semibold uppercase text-ink2" style={{ gridTemplateColumns: "2fr .7fr .7fr .7fr .8fr" }}>
                <span>Profile</span><span>Start</span><span>End</span><span>Gain</span><span>Repeats</span>
              </div>
              {sim.personas.map((p) => (
                <div key={p.t} className="grid gap-2 border-t border-line px-3 py-2 text-xs" style={{ gridTemplateColumns: "2fr .7fr .7fr .7fr .8fr" }}>
                  <span className="font-semibold">{p.t}</span>
                  <span className="font-mono">{p.a.toFixed(2)}</span>
                  <span className="font-mono">{p.b.toFixed(2)}</span>
                  <span className="font-mono text-ok-ink">+{p.g.toFixed(2)}</span>
                  <span className="font-mono">{p.r}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

const blank = (): Omit<Case, "id"> => ({ question: "", expected_answer: "", expected_locations: [], category: "Textbook page", off_material: false });

function CaseForm({ value, onChange }: { value: Omit<Case, "id">; onChange: (v: Omit<Case, "id">) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Question"><Textarea rows={2} value={value.question} onChange={(e) => onChange({ ...value, question: e.target.value })} /></Field>
      <Checkbox checked={value.off_material} onChange={(v) => onChange({ ...value, off_material: v })}>Off-material: the tutor should decline or flag this</Checkbox>
      {!value.off_material && (
        <>
          <Field label="Reference answer"><Textarea rows={3} value={value.expected_answer} onChange={(e) => onChange({ ...value, expected_answer: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expected source locations" hint="Comma-separated, e.g. p. 208, Slide 14">
              <Input value={value.expected_locations.join(", ")} onChange={(e) => onChange({ ...value, expected_locations: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </Field>
            <Field label="Location type">
              <Select value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value })}>
                {CATS.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function TestSet({ onChange }: { onChange: () => void }) {
  const { data, error, mutate } = useApi<Case[]>("/api/admin/eval/cases");
  const [editing, setEditing] = useState<{ id: string | null; v: Omit<Case, "id"> } | null>(null);
  const [importing, setImporting] = useState(false);
  const [json, setJson] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [subject, setSubject] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState({ n: 12, off: 3 });
  const [del, setDel] = useState<Case | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const subjects = useApi<Subject[]>(importing || drafting ? "/api/admin/curriculum/subjects" : null);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const done = () => (mutate(), onChange());

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) await api.put(`/api/admin/eval/cases/${editing.id}`, editing.v);
      else await api.post("/api/admin/eval/cases", [editing.v]);
      toast.success("Saved");
      setEditing(null);
      done();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doImport = async () => {
    if (file) {
      const form = new FormData();
      form.append("file", file);
      form.append("subject_id", subject);
      setBusy(true);
      try {
        const out = await api.upload<{ added: number; skipped: number }>("/api/admin/eval/cases/import", form);
        toast.success(`Imported ${out.added} question${out.added === 1 ? "" : "s"}${out.skipped ? ` · ${out.skipped} already in the set` : ""}`);
        setImporting(false);
        setFile(null);
        done();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    let rows: unknown;
    try {
      rows = JSON.parse(json);
    } catch {
      return toast.error("That isn't valid JSON.");
    }
    if (!Array.isArray(rows)) return toast.error("Paste a JSON array of test questions, or choose a CSV/JSON file.");
    if (subject) rows = rows.map((r) => ({ subject_id: subject, ...(r as object) }));
    setBusy(true);
    try {
      const out = await api.post<Case[]>("/api/admin/eval/cases", rows);
      toast.success(`Imported ${out.length} question${out.length === 1 ? "" : "s"}`);
      setImporting(false);
      setJson("");
      done();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doDraft = async () => {
    setBusy(true);
    try {
      const out = await api.post<Case[]>("/api/admin/eval/cases/draft", { subject_id: subject || null, n: draft.n, off_material: draft.off });
      toast.success(`Drafted ${out.length} question${out.length === 1 ? "" : "s"}. Review them before your first run.`);
      setDrafting(false);
      done();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const subjectPicker = (
    <Field label="Subject" hint="Questions are answered against this subject's material. Leave as All to search everything.">
      <Select value={subject} onChange={(e) => setSubject(e.target.value)}>
        <option value="">All subjects</option>
        {(subjects.data || []).map((s) => <option key={s.id} value={s.id}>{s.name} · {s.board} {s.class_level}</option>)}
      </Select>
    </Field>
  );
  const shown = data.filter((c) => !q || c.question.toLowerCase().includes(q.toLowerCase()));
  const cols = "3fr 1.1fr 1.4fr 70px";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-[38px] min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3">
          <Icon name="search" size={18} className="text-ink3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions" className="min-w-0 flex-1 border-0 bg-transparent outline-none" />
        </label>
        <Button icon="auto_awesome" onClick={() => setDrafting(true)}>Draft from material</Button>
        <Button icon="upload_file" onClick={() => setImporting(true)}>Import</Button>
        <Button variant="primary" icon="add" onClick={() => setEditing({ id: null, v: blank() })}>Add question</Button>
      </div>
      <Table cols={cols} minWidth={720} title="Held-out test set" sub="Written by the team, never used for tuning. Off-material questions check that the tutor declines." headers={["Question", "Type", "Expected location", ""]} empty="No test questions yet.">
        {shown.map((c) => (
          <Row key={c.id} cols={cols}>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{c.question}</span>
              {c.expected_answer && <span className="block truncate text-xs text-ink2">{c.expected_answer}</span>}
            </span>
            <span>{c.off_material ? <span className="rounded-md bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn-ink">Off-material</span> : c.category}</span>
            <span className="truncate font-mono text-xs text-ink2">{c.expected_locations.join(", ") || "—"}</span>
            <span className="flex justify-end gap-0.5">
              <button title="Edit" onClick={() => setEditing({ id: c.id, v: { question: c.question, expected_answer: c.expected_answer, expected_locations: c.expected_locations, category: c.category, off_material: c.off_material } })} className="grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-ink2 hover:bg-surface2"><Icon name="edit" size={17} /></button>
              <button title="Delete" onClick={() => setDel(c)} className="grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-ink2 hover:bg-surface2"><Icon name="delete" size={17} /></button>
            </span>
          </Row>
        ))}
      </Table>
      <Modal open={!!editing} onOpenChange={(v) => !v && setEditing(null)} title={editing?.id ? "Edit test question" : "Add test question"} width={600} footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
        {editing && <CaseForm value={editing.v} onChange={(v) => setEditing({ ...editing, v })} />}
      </Modal>
      <Modal open={importing} onOpenChange={(v) => (setImporting(v), !v && setFile(null))} title="Import test questions" sub="A CSV or JSON file written by your team. Questions already in the set are skipped." width={640} footer={<><Button onClick={() => setImporting(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!file && !json.trim()} onClick={doImport}>Import</Button></>}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold hover:bg-surface2">
              <Icon name="attach_file" size={18} />
              {file ? file.name : "Choose CSV or JSON file"}
              <input type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" aria-label="Test set file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <Button variant="ghost" icon="download" onClick={() => dl("/api/admin/eval/cases/template.csv", "intellinova-test-set-template.csv")}>CSV template</Button>
          </div>
          <div className="rounded-[10px] bg-surface2 px-3 py-2 text-xs text-ink2">
            Columns: <span className="font-mono">question, expected_answer, expected_locations, category, off_material</span>. Separate several locations with <span className="font-mono">;</span> (e.g. <span className="font-mono">p. 2; Slide 4</span>). Category is one of {CATS.join(", ")}. Mark questions the material doesn't cover with <span className="font-mono">off_material = yes</span>.
          </div>
          {subjectPicker}
          {!file && (
            <Field label="Or paste JSON">
              <Textarea rows={7} value={json} onChange={(e) => setJson(e.target.value)} className="font-mono text-xs" placeholder={`[\n  {"question": "State Ohm's law.", "expected_answer": "V = IR at constant temperature", "expected_locations": ["p. 176"], "category": "Textbook page"},\n  {"question": "Who won the 2011 World Cup?", "off_material": true}\n]`} />
            </Field>
          )}
        </div>
      </Modal>
      <Modal open={drafting} onOpenChange={setDrafting} title="Draft test questions from your material" sub="The AI writes questions from processed sources, each tagged with the page, slide or timestamp it came from. Review and edit them; a held-out set should be checked by a teacher." width={560} footer={<><Button onClick={() => setDrafting(false)}>Cancel</Button><Button variant="primary" icon="auto_awesome" loading={busy} onClick={doDraft}>Draft {draft.n + draft.off} questions</Button></>}>
        <div className="flex flex-col gap-3">
          {subjectPicker}
          <div className="grid grid-cols-2 gap-3">
            <Field label="From the material" hint="1–40">
              <Input type="number" min={1} max={40} value={draft.n} onChange={(e) => setDraft({ ...draft, n: Math.max(1, Math.min(40, Number(e.target.value) || 1)) })} />
            </Field>
            <Field label="Off-material checks" hint="0–6, should be declined">
              <Input type="number" min={0} max={6} value={draft.off} onChange={(e) => setDraft({ ...draft, off: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })} />
            </Field>
          </div>
          {busy && <div className="flex items-center gap-2 text-xs text-ink2"><Icon name="progress_activity" size={16} style={{ animation: "spin 1s linear infinite" }} />Writing questions with the local model, a few seconds each. Keep this window open.</div>}
        </div>
      </Modal>
      <Confirm open={!!del} onOpenChange={(v) => !v && setDel(null)} title="Delete this test question?" danger confirmLabel="Delete" onConfirm={async () => {
        const c = del!;
        setDel(null);
        try {
          await api.del(`/api/admin/eval/cases/${c.id}`);
          done();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}>
        “{del?.question}”
      </Confirm>
    </div>
  );
}

function QuestionBank() {
  const { data, error, mutate } = useApi<Bank>("/api/admin/eval/bank", {
    refreshInterval: (d) => (d?.prep && d.prep.status !== "done" ? 3000 : 0),
  });
  const [per, setPer] = useState(10);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const running = !!data.prep && data.prep.status !== "done";
  const short = data.topics.filter((t) => t.verified < per).length;
  const prepare = async () => {
    setBusy(true);
    try {
      await api.post("/api/admin/eval/bank/prepare", { per_topic: per });
      toast.success("Preparing the question bank");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const shown = data.topics.filter((t) => !q || `${t.topic} ${t.chapter} ${t.subject}`.toLowerCase().includes(q.toLowerCase()));
  const cols = "2fr 1.6fr 1fr 1.6fr";
  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-[620px]">
            <div className="font-display text-[15px] font-semibold">Question bank for the personalisation test</div>
            <div className="mt-1 text-[13px] text-ink2">
              The simulated-student check runs on the real quiz engine once a topic has at least <strong>{data.min}</strong> verified MCQ or numerical questions.
              Preparing the bank writes questions from each topic&apos;s class material; a second model and a solver check every one before it&apos;s used.
              The same questions are then available to students in Practice.
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Per topic">
              <Select value={String(per)} onChange={(e) => setPer(Number(e.target.value))} className="w-[96px]">
                {[8, 10, 12, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
            <Button variant="primary" icon="auto_awesome" loading={busy} disabled={running || !short} onClick={prepare}>
              {short ? `Prepare ${short} topic${short === 1 ? "" : "s"}` : "All topics ready"}
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
          {([
            ["Topics ready", `${data.ready} / ${data.topics.length}`],
            ["Verified questions", data.stats.verified],
            ["Held back (models disagreed)", data.stats.disagreement],
            ["Rejected by solver", data.stats.rejected],
          ] as const).map(([l, v]) => (
            <div key={l} className="rounded-xl bg-surface2 p-3">
              <div className="font-display text-xl font-semibold leading-none">{v}</div>
              <div className="mt-1 text-[11px] text-ink2">{l}</div>
            </div>
          ))}
        </div>
        {data.prep && (
          <div className="mt-3 flex flex-col gap-1.5 rounded-xl border border-line px-4 py-3 text-[13px]">
            <div className="flex items-center gap-3">
              {running ? <Icon name="progress_activity" size={18} className="text-pri" style={{ animation: "spin 1s linear infinite" }} /> : <Icon name="check_circle" size={18} className="text-ok-ink" />}
              <span className="font-semibold">{running ? (data.prep.status === "queued" ? "Queued…" : `Preparing topic ${Math.min(data.prep.done + 1, data.prep.total)} of ${data.prep.total}`) : data.prep.stopped ? "Last preparation stopped part-way (the worker restarted). Start it again to finish." : "Last preparation finished"}</span>
              {data.prep.total > 0 && <Bar value={(100 * data.prep.done) / data.prep.total} className="flex-1" height={6} />}
              <span className="font-mono text-xs text-ink2">{data.prep.generated} new verified</span>
            </div>
            {!!data.prep.skipped?.length && <div className="text-xs text-ink2">Skipped (no class material yet, or the AI was unavailable): {data.prep.skipped.join(", ")}</div>}
          </div>
        )}
      </Panel>
      <div className="flex">
        <label className="flex h-[38px] min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3">
          <Icon name="search" size={18} className="text-ink3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics" className="min-w-0 flex-1 border-0 bg-transparent outline-none" />
        </label>
      </div>
      <Table cols={cols} minWidth={640} title="Verified questions by topic" headers={["Topic", "Chapter", "Subject", "Verified MCQ / numerical"]} empty="No published topics yet. Publish a curriculum first.">
        {shown.map((t) => (
          <Row key={t.topic_id} cols={cols}>
            <strong className="truncate">{t.topic}</strong>
            <span className="truncate text-ink2">{t.chapter}</span>
            <span className="truncate text-ink2">{t.subject}</span>
            <span className="flex items-center gap-2">
              <Bar value={Math.min(100, (100 * t.verified) / data.min)} className="flex-1" height={6} color={t.ready ? "var(--ok-ink)" : "var(--warn-ink)"} />
              <span className="w-8 text-right font-mono text-xs">{t.verified}</span>
              <Icon name={t.ready ? "check_circle" : "pending"} size={16} style={{ color: t.ready ? "var(--ok-ink)" : "var(--ink3)" }} />
            </span>
          </Row>
        ))}
      </Table>
    </div>
  );
}

export default function Evaluation() {
  const { data, error, mutate } = useApi<Runs>("/api/admin/eval/runs", {
    refreshInterval: (d) => (d?.runs.some((r) => r.status === "queued" || r.status === "running") ? 3000 : 0),
  });
  const [tab, setTab] = useState<"results" | "cases" | "bank">("results");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onChange={setTab} tabs={[{ v: "results", l: "Results", icon: "query_stats" }, { v: "cases", l: "Test set", icon: "checklist", n: data.cases }, { v: "bank", l: "Question bank", icon: "quiz" }]} />
      {tab === "results" ? <Results data={data} onRun={() => mutate()} /> : tab === "cases" ? <TestSet onChange={() => mutate()} /> : <QuestionBank />}
    </div>
  );
}
