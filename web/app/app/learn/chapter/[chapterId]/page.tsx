"use client";

import Link from "next/link";
import { use } from "react";
import { toast } from "sonner";

import { BestResource, ResourceRow, type ResourceCardT } from "@/components/resource-card";
import { Card, Empty, ErrorState, Eyebrow, Icon, LinkButton, Loading, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Chapter = {
  id: string; name: string; subject: { id: string; name: string }; position: number;
  topics: { id: string; name: string; dur: string; summary: string; state: "done" | "current" | "todo"; mastery: number | null; subtopics: string[] }[];
  done: number; total: number; time_left: string; total_time: string;
  before: { id: string; name: string; chapter: string; chapter_id: string; done: boolean }[];
  best: ResourceCardT | null; alternatives: ResourceCardT[]; more: ResourceCardT[];
  finding_videos: boolean;
};

export default function ChapterPage({ params }: { params: Promise<{ chapterId: string }> }) {
  const { chapterId } = use(params);
  // While videos are being found on YouTube for this chapter's topics, refresh until they arrive.
  const { data: c, error, mutate } = useApi<Chapter>(`/api/learn/chapters/${chapterId}`, { refreshInterval: (x) => (x?.finding_videos ? 5000 : 0) });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!c) return <Loading />;
  const cur = c.topics.find((t) => t.state === "current");
  const pct = c.total ? Math.round((100 * c.done) / c.total) : 0;
  const topicIds = c.topics.map((t) => t.id).join(",");

  const toggle = async (id: string, state: string) => {
    const r = await api.post<{ done: boolean }>(`/api/learn/topics/${id}/complete`);
    if (r.done) toast("Topic marked complete");
    else if (state === "done") toast("Marked as not done");
    mutate();
  };

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex items-center gap-1.5 text-[13px] text-ink2">
        <Link href="/app/learn" className="font-semibold">Learn</Link>
        <span>/</span>
        <Link href={`/app/learn/${c.subject.id}`} className="font-semibold">{c.subject.name}</Link>
        <span>/</span>
        <span>{c.name}</span>
      </div>
      <div className="flex flex-wrap justify-between gap-6 rounded-[20px] border border-line bg-surface p-6">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3">
          <Eyebrow color="var(--pri-ink)">
            CHAPTER {c.position} · {c.subject.name.toUpperCase()}
          </Eyebrow>
          <h1 className="m-0 font-display text-[34px] font-semibold leading-[1.1] tracking-[-0.02em]">{c.name}</h1>
          {cur?.summary && <div className="max-w-[60ch] text-ink2 [text-wrap:pretty]">{cur.summary}</div>}
          <div className="mt-1 flex flex-wrap gap-2">
            {c.best && cur && (
              <button
                onClick={() => {
                  api.post(`/api/resources/${c.best!.id}/progress`, { status: "started" }).catch(() => {});
                  window.open(c.best!.url, "_blank", "noopener");
                }}
                className="flex h-[42px] items-center gap-2 rounded-[10px] border-0 px-[18px] font-semibold text-on-pri"
                style={{ background: "var(--grad)" }}
              >
                <Icon name="play_arrow" fill /> Resume: {cur.name}
              </button>
            )}
            <LinkButton href={`/app/tutor?q=${encodeURIComponent(`Explain ${cur?.name || c.name}`)}`} size="lg" icon="forum">
              Ask tutor
            </LinkButton>
            <LinkButton href={`/app/practice?topics=${topicIds}`} size="lg" icon="quiz">
              Practice quiz
            </LinkButton>
            <LinkButton href="/app/study" size="lg" icon="description">
              Make notes
            </LinkButton>
          </div>
        </div>
        <div className="flex items-center gap-7">
          <div>
            <div className="font-display text-[26px] font-semibold">{c.total}</div>
            <div className="text-xs text-ink2">topics</div>
          </div>
          <div>
            <div className="font-display text-[26px] font-semibold">{c.total_time}</div>
            <div className="text-xs text-ink2">total time</div>
          </div>
          <div>
            <div className="font-display text-[26px] font-semibold text-pri-ink">{pct}%</div>
            <div className="text-xs text-ink2">done</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <Card className="min-w-0 flex-[2_1_460px]">
          <div className="mb-3 font-display text-[17px] font-semibold">Topic roadmap</div>
          {c.topics.length === 0 && <div className="text-[13px] text-ink2">Topics for this chapter haven&apos;t been published yet.</div>}
          {c.topics.map((t) => {
            const st = t.state;
            return (
              <div key={t.id} className="mb-1 flex items-center gap-3.5 rounded-xl px-3 py-2.5" style={{ background: st === "current" ? "var(--pri-soft)" : "transparent", border: `1px solid ${st === "current" ? "var(--pri)" : "transparent"}` }}>
                <button onClick={() => toggle(t.id, st)} title={st === "done" ? "Mark as not done" : "Mark as done"} className="grid border-0 bg-transparent p-0">
                  <Icon name={st === "done" ? "check_circle" : st === "current" ? "play_circle" : "radio_button_unchecked"} size={24} fill={st !== "todo"} style={{ color: st === "done" ? "var(--ok)" : st === "current" ? "var(--pri)" : "var(--ink3)" }} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-ink2">
                    {st === "done" ? "Completed" : st === "current" ? "You are here" : "Not started"} · {t.dur}
                    {t.mastery !== null && ` · mastery ${t.mastery.toFixed(2)}`}
                  </div>
                  {!!t.subtopics?.length && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.subtopics.map((x) => <span key={x} className="rounded-md border border-line px-1.5 py-px text-[11px] text-ink2">{x}</span>)}
                    </div>
                  )}
                </div>
                {st === "current" && (
                  <button onClick={() => toggle(t.id, st)} className="h-[34px] rounded-[9px] border-0 px-3.5 text-[13px] font-semibold text-on-pri" style={{ background: "var(--grad)" }}>
                    Mark done
                  </button>
                )}
              </div>
            );
          })}
        </Card>
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          {c.before.length > 0 && (
            <Card className="p-[18px]">
              <div className="mb-2.5 font-display text-[15px] font-semibold">Before you start</div>
              <div className="flex flex-col gap-2 text-[13px]">
                {c.before.map((b) => (
                  <div key={b.id} className="flex items-center gap-2">
                    <Icon name={b.done ? "check_circle" : "schedule"} size={18} style={{ color: b.done ? "var(--ok)" : "var(--warn)" }} />
                    {b.chapter} · {b.name}
                    {!b.done && (
                      <Link href={`/app/learn/chapter/${b.chapter_id}`} className="ml-auto">
                        Refresh
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card className="p-[18px]">
            <div className="mb-2.5 font-display text-[15px] font-semibold">Suggested path for the rest</div>
            <div className="flex flex-col gap-3 text-[13px]">
              {[
                c.best ? <><strong>Work through</strong> the best-match resource<div className="text-ink2">About {c.time_left} left in this chapter</div></> : <><strong>Read your class material</strong> for the remaining topics</>,
                <><strong>Generate short notes</strong> from what you studied</>,
                <><strong>Practice</strong> with an adaptive quiz on this chapter</>,
              ].map((node, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full font-mono text-[11px] font-semibold" style={i === 0 ? { background: "var(--grad)", color: "var(--on-pri)" } : { background: "var(--pri-soft)", color: "var(--pri-ink)" }}>
                    {i + 1}
                  </span>
                  <div>{node}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="font-display text-[17px] font-semibold">Resources</div>
        {c.finding_videos && (
          <div className="flex items-center gap-2.5 rounded-xl bg-pri-soft px-4 py-3 text-[13px] text-pri-ink">
            <Spinner size={18} /> Finding more videos for this chapter on YouTube and checking them against your syllabus…
          </div>
        )}
        {c.best ? (
          <>
            <BestResource r={c.best} allTopics={c.topics.map((t) => t.name)} onChange={() => mutate()} />
            {c.alternatives.length > 0 && <div className="mt-2 text-[13px] font-semibold text-ink2">Alternatives</div>}
            {[...c.alternatives, ...c.more].map((r) => (
              <ResourceRow key={r.id} r={r} onChange={() => mutate()} />
            ))}
          </>
        ) : (
          !c.finding_videos && <Empty icon="video_library" title="No resources for this chapter yet">
            Your content team hasn&apos;t added videos or articles for {c.name}. You can still ask the tutor or generate notes from your own material.
          </Empty>
        )}
      </div>
    </div>
  );
}
