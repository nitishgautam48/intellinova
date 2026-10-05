"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AutoBadge, ResourceRow, useResourceActions, type ResourceCardT } from "@/components/resource-card";
import { Alert, Card, ErrorState, Icon, Loading, Skeleton, Spinner } from "@/components/ui";
import { qs, useApi } from "@/lib/api";

type Match = { t: string; m: string; icon: string; kind: string; ref: string; chapter_id?: string };
type Results = {
  query: string; did_you_mean: string | null; filters: Record<string, string | null>;
  best: ResourceCardT | null; best_topics: string[]; alternatives: ResourceCardT[]; more: ResourceCardT[]; matches: Match[]; total: number;
  discovery: Discovery | null;
};
type Discovery = { id: string; status: "queued" | "running" | "done" | "failed" | "skipped"; label: string; added: number; searching: boolean };

/** While IntelliNova searches YouTube for this topic, poll and refresh the results when it finishes. */
function FindingVideos({ d, onDone }: { d: Discovery; onDone: () => void }) {
  const { data } = useApi<Discovery>(`/api/search/discovery/${d.id}`, { refreshInterval: (x) => (x && !x.searching ? 0 : 3000) });
  const finished = data && !data.searching;
  useEffect(() => {
    if (finished) onDone();
  }, [finished, onDone]);
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-center gap-3">
        <Spinner size={22} className="text-pri" />
        <div>
          <div className="font-display text-[17px] font-semibold">Finding the best videos for “{d.label}”</div>
          <div className="text-[13px] text-ink2">Searching YouTube and checking each video against your syllabus. This can take up to a minute.</div>
        </div>
      </div>
      <Skeleton style={{ height: 64 }} />
      <Skeleton style={{ height: 64 }} />
    </div>
  );
}
type Home = { recent: string[]; trending: string[]; context: string[] };

const FILTERS: { k: string; key: string; options: string[] }[] = [
  { k: "Type", key: "rtype", options: ["Any", "Video", "Playlist", "Article", "Article series", "Document"] },
  { k: "Language", key: "language", options: ["Any", "English", "Hindi", "Hinglish"] },
  { k: "Difficulty", key: "difficulty", options: ["Any", "Beginner", "Intermediate", "Advanced"] },
];

function matchHref(m: Match) {
  if (m.kind === "chapter") return `/app/learn/chapter/${m.ref}`;
  if (m.kind === "topic" && m.chapter_id) return `/app/learn/chapter/${m.chapter_id}`;
  if (m.kind === "exam") return `/app/exam/${m.ref}`;
  if (m.kind === "career") return `/app/career?node=${m.ref}`;
  return "#";
}

function Best({ r, topics }: { r: ResourceCardT; topics: string[] }) {
  const a = useResourceActions(r);
  const covered = topics.length;
  return (
    <div className="overflow-hidden rounded-[22px] bg-surface shadow-card" style={{ border: "1.5px solid var(--pri)" }}>
      <div className="flex items-center gap-2 px-5 py-2.5 font-mono text-xs font-semibold tracking-[0.06em] text-on-pri" style={{ background: "var(--grad)" }}>
        <Icon name="workspace_premium" size={18} fill />
        BEST MATCH FOR YOU
      </div>
      <div className="flex flex-wrap gap-6 p-[22px]">
        <div className="relative grid min-w-0 max-w-[420px] flex-[1_1_300px] place-items-center overflow-hidden rounded-[14px]" style={{ aspectRatio: "16/10", background: "repeating-linear-gradient(135deg,var(--surface2) 0 10px,var(--stripe) 10px 20px)" }}>
          {r.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="font-mono text-xs font-medium text-ink3">{r.platform}</span>
          )}
          {r.dur && <span className="absolute bottom-2.5 right-2.5 rounded-md bg-ink px-[7px] py-[3px] font-mono text-[11px] font-semibold text-bg">{r.dur}</span>}
          {r.auto && <AutoBadge className="absolute left-2.5 top-2.5" />}
        </div>
        <div className="flex min-w-0 flex-[1.4_1_340px] flex-col gap-3.5">
          <div>
            <div className="font-display text-2xl font-semibold leading-[1.2] tracking-[-0.01em]">{r.title}</div>
            <div className="mt-1 text-ink2">
              {r.creator} · {r.platform} {r.type.toLowerCase()}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              ["schedule", r.dur],
              ["signal_cellular_alt", r.diff],
              ["translate", r.lang],
            ]
              .filter(([, v]) => v)
              .map(([i, v]) => (
                <span key={i} className="flex items-center gap-1 rounded-lg bg-surface2 px-[9px] py-1 text-xs font-semibold">
                  <Icon name={i} size={15} />
                  {v}
                </span>
              ))}
          </div>
          {covered > 0 && (
            <div>
              <div className="mb-1.5 flex justify-between text-[13px]">
                <span className="font-semibold">Syllabus coverage</span>
                <span className="font-bold text-ok-ink">
                  {r.topics.length} of {covered} topics
                </span>
              </div>
              <div className="flex gap-[3px]">
                {topics.map((t) => (
                  <div key={t} title={t} className="h-2 flex-1 rounded-[3px]" style={{ background: r.topics.includes(t) ? "var(--ok)" : "var(--line)" }} />
                ))}
              </div>
            </div>
          )}
          {r.why && (
            <div className="rounded-[14px] bg-teal-soft px-4 py-3.5 text-teal-ink">
              <div className="mb-1.5 flex items-center gap-1.5 font-bold">
                <Icon name="lightbulb" size={18} />
                Why this is recommended
              </div>
              <div className="text-[13px]">{r.why}</div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={a.open} className="flex h-11 items-center gap-2 rounded-xl border-0 px-5 font-semibold text-on-pri" style={{ background: "var(--grad)" }}>
              <Icon name="play_arrow" fill />
              {r.progress ? "Continue learning" : "Start learning"}
            </button>
            <button onClick={a.toggleSave} className="flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 font-semibold" style={{ color: a.saved ? "var(--pri)" : "var(--ink)" }}>
              <Icon name="bookmark" fill={a.saved} />
              {a.saved ? "Saved" : "Save"}
            </button>
            <div className="ml-auto flex items-center gap-0.5 text-xs text-ink2">
              Helpful?
              <button onClick={() => a.rate("up")} aria-label="Helpful" className="h-[34px] w-[34px] rounded-lg border-0 bg-transparent" style={{ color: a.helpful === "up" ? "var(--ok)" : "var(--ink3)" }}>
                <Icon name="thumb_up" fill={a.helpful === "up"} />
              </button>
              <button onClick={() => a.rate("down")} aria-label="Not helpful" className="h-[34px] w-[34px] rounded-lg border-0 bg-transparent" style={{ color: a.helpful === "down" ? "var(--err)" : "var(--ink3)" }}>
                <Icon name="thumb_down" fill={a.helpful === "down"} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") || "";
  const [input, setInput] = useState(q);
  const [f, setF] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  useEffect(() => {
    setInput(q);
  }, [q]);
  const { data: home } = useApi<Home>(q ? null : "/api/search/home");
  const { data, error, isLoading, mutate } = useApi<Results>(q ? `/api/search${qs({ q, ...f })}` : null);
  const go = (v: string) => router.push(`/app/search?q=${encodeURIComponent(v)}`);

  return (
    <div className="flex flex-col gap-5">
      <label className="flex h-[46px] items-center gap-2.5 rounded-xl bg-surface px-3.5 md:hidden" style={{ border: "1.5px solid var(--pri)" }}>
        <Icon name="search" className="text-ink3" />
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go(input)} placeholder="Subject, chapter, exam or career…" className="min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none" />
      </label>

      {!q && (
        <div className="flex flex-wrap gap-5">
          <Card className="min-w-0 flex-[1_1_320px]">
            <div className="mb-2 font-display text-[15px] font-semibold">Recent searches</div>
            {home?.recent.length ? (
              home.recent.map((r) => (
                <button key={r} onClick={() => go(r)} className="flex w-full items-center gap-2.5 border-0 border-t border-line bg-transparent py-2.5 text-left">
                  <Icon name="history" size={18} className="text-ink3" />
                  {r}
                </button>
              ))
            ) : (
              <div className="border-t border-line py-3 text-[13px] text-ink2">Your searches will appear here.</div>
            )}
          </Card>
          <Card className="min-w-0 flex-[1_1_320px]">
            <div className="mb-1 font-display text-[15px] font-semibold">Popular this week</div>
            <div className="mb-3 text-xs text-ink2">What students on IntelliNova are searching for</div>
            {home?.trending.length ? (
              <div className="flex flex-wrap gap-2">
                {home.trending.map((t) => (
                  <button key={t} onClick={() => go(t)} className="flex h-[34px] items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold">
                    <Icon name="trending_up" size={16} className="text-teal" />
                    {t}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[13px] text-ink2">Not enough searches yet.</div>
            )}
          </Card>
          <div className="grid flex-[1_1_100%] gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            {[
              ["menu_book", "Chapters and topics", "a chapter or concept name"],
              ["flag", "Exams", "an exam and its syllabus"],
              ["explore", "Careers", "degrees, entrances, career areas"],
              ["forum", "Plain questions", "ask the tutor instead"],
            ].map(([i, t, d]) => (
              <div key={t} className="rounded-[14px] bg-surface2 p-4">
                <Icon name={i} size={22} className="text-pri" />
                <div className="mt-1.5 font-semibold">{t}</div>
                <div className="text-xs text-ink2">{d}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {q && error && <ErrorState error={error} retry={() => mutate()} />}
      {q && isLoading && <Loading label="Searching…" />}

      {q && data && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[13px] text-ink2">Results for</div>
              <h1 className="m-0 mt-0.5 font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">{data.query}</h1>
            </div>
            <div className="text-[13px] text-ink2">
              {data.best ? "1 best match" : "No resources"} · {data.alternatives.length} alternatives · {data.matches.length} chapters and more
            </div>
          </div>
          {data.did_you_mean && (
            <div className="flex items-center gap-2.5 rounded-xl bg-pri-soft px-4 py-3 text-[13px] text-pri-ink">
              <Icon name="spellcheck" size={18} /> Did you mean{" "}
              <button onClick={() => go(data.did_you_mean!)} className="border-0 bg-transparent p-0 font-bold text-pri-ink underline">
                {data.did_you_mean}
              </button>
              ?
            </div>
          )}
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-0.5">
            {data.filters.class_level && (
              <span className="flex h-[34px] flex-none items-center gap-1.5 rounded-[10px] border border-pri bg-pri-soft px-3 text-[13px]">
                <span className="text-ink2">Class</span>
                <strong>{data.filters.class_level}</strong>
              </span>
            )}
            {data.filters.board && (
              <span className="flex h-[34px] flex-none items-center gap-1.5 rounded-[10px] border border-pri bg-pri-soft px-3 text-[13px]">
                <span className="text-ink2">Board</span>
                <strong>{data.filters.board}</strong>
              </span>
            )}
            {FILTERS.map((fl) => {
              const v = f[fl.key] || "Any";
              return (
                <label key={fl.key} className="relative flex h-[34px] flex-none items-center gap-1.5 rounded-[10px] border pl-3 pr-2 text-[13px]" style={{ borderColor: v !== "Any" ? "var(--pri)" : "var(--line)", background: v !== "Any" ? "var(--pri-soft)" : "var(--surface)" }}>
                  <span className="text-ink2">{fl.k}</span>
                  <strong>{v}</strong>
                  <Icon name="expand_more" size={16} className="text-ink3" />
                  <select value={v} onChange={(e) => setF({ ...f, [fl.key]: e.target.value === "Any" ? "" : e.target.value })} className="absolute inset-0 cursor-pointer opacity-0">
                    {fl.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>

          {data.discovery?.searching && <FindingVideos d={data.discovery} onDone={() => mutate()} />}
          {data.discovery?.status === "failed" && data.total < 3 && (
            <Alert tone="warn" icon="cloud_off">Couldn&apos;t search YouTube for more videos right now. We&apos;ll try again later.</Alert>
          )}

          {data.total === 0 && data.discovery?.searching ? null : data.total === 0 ? (
            <div className="flex flex-col items-center gap-3.5 rounded-[20px] border border-line bg-surface px-6 py-12 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-surface2 text-ink2">
                <Icon name="search_off" size={30} />
              </div>
              <div className="font-display text-[22px] font-semibold">Nothing in your syllabus matches “{data.query}”</div>
              <div className="max-w-[52ch] text-ink2">Try a chapter or topic name, or a simpler phrase. You can also ask the tutor directly.</div>
              <div className="flex flex-wrap justify-center gap-2">
                <Link href={`/app/tutor?q=${encodeURIComponent(data.query)}`} className="flex h-9 items-center rounded-full border border-line bg-surface px-3.5 font-semibold text-ink hover:no-underline">
                  Ask the tutor
                </Link>
                <Link href="/app/learn" className="flex h-9 items-center rounded-full border border-line bg-surface px-3.5 font-semibold text-ink hover:no-underline">
                  Browse chapters
                </Link>
              </div>
              <div className="text-xs text-ink3">
                {data.discovery?.status === "done" ? "We also looked on YouTube but found no video that clearly teaches this. " : ""}
                We log searches with no results so the content team can add material.
              </div>
            </div>
          ) : (
            <>
              {data.best && <Best r={data.best} topics={data.best_topics} />}
              {data.matches.length > 0 && (
                <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
                  {data.matches.map((m) => (
                    <Link key={m.kind + m.ref} href={matchHref(m)} className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-[18px] text-left text-ink hover:border-pri hover:no-underline">
                      <div className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-pri-soft text-pri">
                        <Icon name={m.icon} size={24} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold">{m.t}</div>
                        <div className="text-[13px] text-ink2">{m.m}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              {data.alternatives.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="font-display text-[17px] font-semibold">If you want a different style</div>
                  {(more ? [...data.alternatives, ...data.more] : data.alternatives).map((r) => (
                    <ResourceRow key={r.id} r={r} />
                  ))}
                  {data.more.length > 0 && (
                    <button onClick={() => setMore(!more)} className="h-10 self-center rounded-full border border-line bg-surface px-[18px] font-semibold">
                      {more ? "Show fewer" : `Show ${data.more.length} more`}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SearchInner />
    </Suspense>
  );
}
