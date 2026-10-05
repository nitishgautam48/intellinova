"use client";

import Link from "next/link";
import { useState } from "react";

import { ResourceCard, type ResourceCardT } from "@/components/resource-card";
import { Empty, ErrorState, Icon, LinkButton, Loading, Tabs } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Saved = {
  resources: ResourceCardT[];
  materials: { id: string; t: string; s: string; when: string; status: string }[];
  pathways: { id: string; t: string; when: string }[];
};

export default function SavedPage() {
  const { data, error, mutate } = useApi<Saved>("/api/saved");
  const [tab, setTab] = useState<"resources" | "notes" | "maps">("resources");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  return (
    <div className="flex flex-col gap-[18px]">
      <h1 className="m-0 font-display text-[32px] font-semibold leading-[1.15] tracking-[-0.02em]">Saved</h1>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { v: "resources", l: "Resources", n: data.resources.length },
          { v: "notes", l: "Study material", n: data.materials.length },
          { v: "maps", l: "Pathways", n: data.pathways.length },
        ]}
      />
      {tab === "resources" &&
        (data.resources.length ? (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))" }}>
            {data.resources.map((r) => <ResourceCard key={r.id} r={r} onChange={() => mutate()} />)}
          </div>
        ) : (
          <Empty icon="bookmark_add" title="No saved resources yet" action={<LinkButton href="/app/learn" size="sm">Browse chapters</LinkButton>}>
            Tap the bookmark on any video or article to keep it here.
          </Empty>
        ))}
      {tab === "notes" &&
        (data.materials.length ? (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {data.materials.map((p) => (
              <Link key={p.id} href={`/app/study/${p.id}`} className="flex w-full items-center gap-3.5 border-b border-line px-[18px] py-3.5 text-left text-ink last:border-b-0 hover:bg-surface2 hover:no-underline">
                <Icon name="description" size={22} className="text-pri" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{p.t}</div>
                  <div className="text-xs text-ink2">{p.s || "Study material"}</div>
                </div>
                <span className="text-xs text-ink3">{p.when}</span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty icon="auto_awesome" title="No study material yet" action={<LinkButton href="/app/study" size="sm">Open Study AI</LinkButton>}>
            Notes you generate with Study AI are kept here.
          </Empty>
        ))}
      {tab === "maps" &&
        (data.pathways.length ? (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            {data.pathways.map((p) => (
              <div key={p.id} className="flex items-center gap-3.5 border-b border-line px-[18px] py-3.5 last:border-b-0">
                <Icon name="route" size={22} className="text-pri" />
                <Link href={`/app/career?node=${p.id}`} className="min-w-0 flex-1 font-bold text-ink">
                  {p.t}
                </Link>
                <span className="text-xs text-ink3">{p.when}</span>
                <button onClick={async () => (await api.del(`/api/saved/pathway/${p.id}`), mutate())} className="border-0 bg-transparent text-ink3" aria-label="Remove">
                  <Icon name="close" size={18} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2.5 rounded-[18px] px-6 py-12 text-center" style={{ border: "1.5px dashed var(--line)" }}>
            <Icon name="bookmark_add" size={34} className="text-ink3" />
            <div className="font-display text-lg font-semibold">No saved pathways yet</div>
            <div className="max-w-[44ch] text-ink2">When a combination or degree looks interesting in the Career Explorer, save it here to come back later.</div>
            <LinkButton href="/app/career?view=graph" variant="primary">Open pathway map</LinkButton>
          </div>
        ))}
    </div>
  );
}
