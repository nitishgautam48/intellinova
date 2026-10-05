"use client";

import Link from "next/link";
import { useState } from "react";

import { Empty, ErrorState, Icon, LinkButton, PageHead, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";

type Subj = { id: string; name: string; icon: string; tone: string; chapters: number; pct: number; next: string };
type Profile = { board: string; class_level: string };

export default function Learn() {
  const { data, error, mutate } = useApi<Subj[]>("/api/learn/subjects");
  const { data: prof } = useApi<Profile>("/api/me/profile");
  const [q, setQ] = useState("");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  const list = (data || []).filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.next.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-[22px]">
      <PageHead
        title="Learn"
        sub={prof ? `${prof.board} · ${prof.class_level} · Board › Class › Subject › Chapter › Topic` : " "}
        right={
          <label className="flex h-10 min-w-[240px] items-center gap-2 rounded-[10px] border border-line bg-surface px-3">
            <Icon name="filter_list" size={18} className="text-ink3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter subjects or chapters" className="min-w-0 flex-1 border-0 bg-transparent outline-none" />
          </label>
        }
      />
      {!data ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[190px] rounded-[18px]" />)}
        </div>
      ) : data.length === 0 ? (
        <Empty icon="menu_book" title="No subjects yet" action={<LinkButton href="/app/profile" size="sm">Choose subjects</LinkButton>}>
          Pick your subjects in Profile. If none are listed, your school hasn&apos;t published chapters for your class yet.
        </Empty>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
          {list.map((x) => (
            <Link key={x.id} href={`/app/learn/${x.id}`} className="flex flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-5 text-ink hover:border-pri hover:no-underline hover:shadow-card">
              <div className="flex items-start justify-between">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface2" style={{ color: `var(--${x.tone})` }}>
                  <Icon name={x.icon} size={24} />
                </div>
                <span className="font-display text-xl font-semibold">{x.pct}%</span>
              </div>
              <div>
                <div className="font-display text-lg font-semibold">{x.name}</div>
                <div className="text-[13px] text-ink2">{x.chapters} chapters</div>
              </div>
              <div className="h-1.5 rounded-[3px] bg-surface2">
                <div className="h-full rounded-[3px]" style={{ width: `${x.pct}%`, background: `var(--${x.tone})` }} />
              </div>
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate text-ink2">Next: {x.next}</span>
                <span className="whitespace-nowrap font-semibold text-pri-ink">Continue</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
