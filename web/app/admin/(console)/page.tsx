"use client";

import Link from "next/link";

import { BarList, Panel, RowBars, StatCard, StatGrid, StatusPill } from "@/components/admin/kit";
import { ErrorState, Icon, LinkButton, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";

type Overview = {
  stats: { l: string; v: string; d: string; icon: string }[];
  popular: { t: string; n: number }[];
  top_chapters: { t: string; s: string; n: number; w: string }[];
  reports: { id: string; t: string; r: string; s: string; n: string }[];
  queue: { kind: "generated" | "career" | "resource"; id: string; t: string; r: string; when: string; icon: string }[];
};

const reviewHref = (q: Overview["queue"][number]) =>
  q.kind === "generated" ? `/admin/generated?open=${q.id}` : q.kind === "career" ? `/admin/careers?entity=rules&sel=${q.id}` : `/admin/resources?open=${q.id}`;

function Quiet({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-line py-4 text-[13px] text-ink2">{children}</div>;
}

export default function AdminOverview() {
  const { data, error, mutate } = useApi<Overview>("/api/admin/overview");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <StatGrid>
        {data.stats.map((x) => <StatCard key={x.l} {...x} />)}
      </StatGrid>
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
        <Panel title="Popular searches · 7 days">
          {data.popular.length ? <BarList items={data.popular} /> : <Quiet>No searches with results yet.</Quiet>}
        </Panel>
        <Panel title="Most accessed chapters">
          {data.top_chapters.length ? <RowBars items={data.top_chapters} /> : <Quiet>Chapter views will show up once students start learning.</Quiet>}
        </Panel>
        <Panel title="Resource reports">
          {data.reports.length ? (
            data.reports.map((r) => (
              <Link key={r.id} href={`/admin/resources?open=${r.id}`} className="flex items-center gap-2.5 border-t border-line py-2.5 text-ink hover:no-underline">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{r.t}</div>
                  <div className="text-xs text-ink2">{r.r} · {r.n}</div>
                </div>
                <StatusPill s={r.s} />
              </Link>
            ))
          ) : (
            <Quiet>No open reports from students.</Quiet>
          )}
        </Panel>
        <Panel title="Needs review">
          {data.queue.length ? (
            data.queue.map((r) => (
              <div key={r.kind + r.id} className="flex items-center gap-3 border-t border-line py-2.5">
                <Icon name={r.icon} className="text-ink2" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{r.t}</div>
                  <div className="text-xs text-ink2">{r.r} · {r.when}</div>
                </div>
                <LinkButton href={reviewHref(r)} size="xs">Review</LinkButton>
              </div>
            ))
          ) : (
            <Quiet>Nothing is waiting for review.</Quiet>
          )}
        </Panel>
      </div>
    </div>
  );
}
