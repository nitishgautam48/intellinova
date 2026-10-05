"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";

import { FlowMap, type FlowMapT } from "@/components/flow-map";
import { Chip, Empty, ErrorState, Icon, LinkButton, Loading, PageHead, Pill, Segmented } from "@/components/ui";
import { useApi } from "@/lib/api";
import { toneOf } from "@/lib/utils";

type Subject = {
  id: string; name: string; board: string; class_level: string; pct: number;
  chapters: { id: string; n: string; name: string; topics: number; done: number; status: string }[];
};

export default function SubjectPage({ params }: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = use(params);
  const { data: s, error, mutate } = useApi<Subject>(`/api/learn/subjects/${subjectId}`);
  const [f, setF] = useState("All");
  const [view, setView] = useState<"list" | "map">("list");
  const router = useRouter();
  const { data: map, error: mapErr } = useApi<FlowMapT>(view === "map" ? `/api/learn/subjects/${subjectId}/map` : null);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!s) return <Loading />;
  const done = s.chapters.reduce((a, c) => a + c.done, 0);
  const total = s.chapters.reduce((a, c) => a + c.topics, 0);
  const rows = s.chapters.filter((c) => f === "All" || c.status === f);
  const next = s.chapters.find((c) => c.status === "In progress") || s.chapters.find((c) => c.status === "Not started");
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex items-center gap-1.5 text-[13px] text-ink2">
        <Link href="/app/learn" className="font-semibold">Learn</Link>
        <span>/</span>
        <span>{s.name}</span>
      </div>
      <PageHead
        title={s.name}
        sub={`${s.chapters.length} chapters · ${done} of ${total} topics · ${s.pct}% complete`}
        right={
          <>
            <Segmented value={view} onChange={setView} options={[{ v: "list", l: "Chapters" }, { v: "map", l: "Flow map" }]} />
            {view === "list" &&
              ["All", "In progress", "Revision due", "Not started"].map((v) => (
                <Chip key={v} on={f === v} onClick={() => setF(v)} icon={false} className="h-[34px] px-3">
                  {v}
                </Chip>
              ))}
          </>
        }
      />
      {next && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-teal-soft px-5 py-[18px] text-teal-ink">
          <Icon name="route" size={26} />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold">
              Recommended next: {next.status === "In progress" ? "finish" : "start"} {next.name}
            </div>
            <div className="text-[13px]">
              {next.topics - next.done} topic{next.topics - next.done !== 1 ? "s" : ""} left in this chapter.
            </div>
          </div>
          <LinkButton href={`/app/learn/chapter/${next.id}`} className="h-[38px] border-0 bg-teal-ink text-surface hover:bg-teal-ink">
            Open chapter
          </LinkButton>
        </div>
      )}
      {view === "map" ? (
        mapErr ? <ErrorState error={mapErr} /> : !map ? <Loading /> : (
          <FlowMap data={map} onPick={(n) => n.state !== "external" && router.push(`/app/learn/chapter/${n.chapter_id}`)} />
        )
      ) : (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.map((c) => (
          <Link key={c.id} href={`/app/learn/chapter/${c.id}`} className="flex w-full items-center gap-4 border-b border-line px-[18px] py-3.5 text-left text-ink last:border-b-0 hover:bg-surface2 hover:no-underline" style={{ background: next?.id === c.id ? "var(--pri-soft)" : undefined }}>
            <span className="w-[22px] font-mono text-[13px] font-medium text-ink3">{c.n}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{c.name}</div>
              <div className="text-xs text-ink2">
                {c.done}/{c.topics} topics
              </div>
            </div>
            <div className="hidden h-1.5 w-[120px] rounded-[3px] bg-surface2 md:block">
              <div className="h-full rounded-[3px] bg-pri" style={{ width: `${c.topics ? Math.round((100 * c.done) / c.topics) : 0}%` }} />
            </div>
            <Pill tone={toneOf(c.status)}>{c.status}</Pill>
            <Icon name="chevron_right" className="text-ink3" />
          </Link>
        ))}
        {rows.length === 0 && (
          <Empty icon="filter_alt_off" title="Nothing here yet" className="m-4 border-0">
            No chapters match this filter.
          </Empty>
        )}
      </div>
      )}
    </div>
  );
}
