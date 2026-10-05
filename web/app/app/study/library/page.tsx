"use client";

import Link from "next/link";
import { useState } from "react";

import { Chip, Empty, ErrorState, Icon, LinkButton, Loading, Pill } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { toneOf } from "@/lib/utils";

type Row = { id: string; t: string; s: string; when: string; status: string; fav: boolean; kind: string; icon: string };
const FILTERS = [
  ["All", "All"],
  ["link", "Lecture videos"],
  ["file", "Textbooks"],
  ["slides", "Slide decks"],
  ["text", "Pasted text"],
  ["pack", "Revision packs"],
  ["fav", "Favorites"],
] as const;

export default function Library() {
  const { data, error, mutate } = useApi<Row[]>("/api/study/materials");
  const [f, setF] = useState("All");
  const [q, setQ] = useState("");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const rows = data.filter((r) => (f === "All" || (f === "fav" ? r.fav : r.kind === f)) && (!q || `${r.t} ${r.s}`.toLowerCase().includes(q.toLowerCase())));
  const subjects = new Set(data.map((d) => d.s));
  const fav = async (r: Row) => {
    mutate(data.map((x) => (x.id === r.id ? { ...x, fav: !x.fav } : x)), false);
    await api.patch(`/api/study/materials/${r.id}`, { favorite: !r.fav });
    mutate();
  };
  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-center gap-1.5 text-[13px] text-ink2">
        <Link href="/app/study" className="font-semibold">Study AI</Link>
        <span>/</span>
        <span>My study material</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 mb-1.5 font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.02em]">My study material</h1>
          <div className="text-ink2">
            {data.length} item{data.length !== 1 ? "s" : ""} across {subjects.size} source{subjects.size !== 1 ? "s" : ""}
          </div>
        </div>
        <label className="flex h-10 min-w-[240px] items-center gap-2 rounded-[10px] border border-line bg-surface px-3">
          <Icon name="search" size={18} className="text-ink3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your notes" className="min-w-0 flex-1 border-0 bg-transparent outline-none" />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([v, l]) => (
          <Chip key={v} icon={false} on={f === v} onClick={() => setF(v)} className="h-[34px] px-3">
            {l}
          </Chip>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty icon="auto_awesome" title="No material here yet" action={<LinkButton href="/app/study" size="sm" variant="solid">Generate notes</LinkButton>}>
          Generate notes from any lecture, textbook or slide deck and they&apos;ll show up here.
        </Empty>
      ) : (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
          {rows.map((p) => (
            <div key={p.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-[18px]">
              <div className="flex items-start justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-[11px] bg-pri-soft text-pri">
                  <Icon name={p.icon} size={22} />
                </div>
                <button onClick={() => fav(p)} aria-label="Favourite" className="border-0 bg-transparent p-0" style={{ color: p.fav ? "var(--warn)" : "var(--ink3)" }}>
                  <Icon name="star" fill={p.fav} />
                </button>
              </div>
              <div>
                {p.status !== "Ready" && <Pill tone={toneOf(p.status)} className="mb-1">{p.status}</Pill>}
                <div className="font-bold">{p.t}</div>
                <div className="text-xs text-ink2">
                  {p.s} · {p.when}
                </div>
              </div>
              <LinkButton href={`/app/study/${p.id}`} size="sm" className="mt-auto">
                Open
              </LinkButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
