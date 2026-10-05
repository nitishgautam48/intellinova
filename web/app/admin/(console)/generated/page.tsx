"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { FilterChips, StatusPill, Table, Row } from "@/components/admin/kit";
import { Button, ErrorState, Icon, Loading, Tabs } from "@/components/ui";
import { Drawer } from "@/components/ui/dialog";
import { api, useApi } from "@/lib/api";

type Gen = { id: string; t: string; kind: string; src: string; sub: string; when: string; s: string; flags: { a: string; b: string; c: string }[]; views: number; ex: string };
type List = { counts: Record<string, number>; rows: Gen[] };
type Section = { h: string; p: string; def?: [string, string] | null; ex?: string | null; src?: { loc: string } };
type Outputs = {
  full?: Section[]; short?: string[]; key_points?: string[]; concepts?: { a: string; b: string }[]; formulas?: { n: string; f: string; u: string }[];
  confusions?: { a: string; b: string }[]; revision?: string[]; lang?: string;
};
type Detail = Gen & { outputs: Outputs; source: { title: string; url: string | null } | null };

const STATUSES = ["All", "Ready", "Flagged", "Processing", "Failed", "Disabled"] as const;
const COLS = "1.6fr 1fr 2fr .9fr 1fr .6fr .6fr 1fr";

function Preview({ o }: { o: Outputs }) {
  const [tab, setTab] = useState<"full" | "short" | "extras">("full");
  if (!o.full?.length) return <div className="text-[13px] text-ink2">Nothing has been generated yet.</div>;
  return (
    <div className="flex flex-col gap-3">
      <Tabs value={tab} onChange={setTab} tabs={[{ v: "full", l: "Full notes" }, { v: "short", l: "Short notes" }, { v: "extras", l: "Formulas & concepts" }]} />
      {tab === "full" &&
        o.full.map((s, i) => (
          <div key={i} className="rounded-xl border border-line p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-display text-[15px] font-semibold">{s.h}</div>
              {s.src?.loc && <span className="flex-none font-mono text-[11px] text-ink3">{s.src.loc}</span>}
            </div>
            <div className="mt-1 text-[13px] leading-[1.6]">{s.p}</div>
            {s.def && <div className="mt-2 rounded-lg bg-pri-soft px-3 py-2 text-[13px]"><strong>{s.def[0]}:</strong> {s.def[1]}</div>}
            {s.ex && <div className="mt-2 rounded-lg bg-surface2 px-3 py-2 text-[13px]"><strong>Example:</strong> {s.ex}</div>}
          </div>
        ))}
      {tab === "short" && (
        <ul className="m-0 flex flex-col gap-1.5 pl-5 text-[13px]">
          {[...(o.key_points || []), ...(o.short || [])].map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      )}
      {tab === "extras" && (
        <div className="flex flex-col gap-3 text-[13px]">
          {!!o.formulas?.length && (
            <div className="overflow-hidden rounded-xl border border-line">
              {o.formulas.map((f, i) => (
                <div key={i} className="grid gap-2 border-t border-line px-3 py-2 first:border-t-0" style={{ gridTemplateColumns: "1fr 1.4fr 50px" }}>
                  <span>{f.n}</span>
                  <span className="font-mono">{f.f}</span>
                  <span className="text-ink2">{f.u}</span>
                </div>
              ))}
            </div>
          )}
          {o.concepts?.map((c, i) => <div key={i}><strong>{c.a}</strong> — {c.b}</div>)}
          {o.confusions?.map((c, i) => <div key={i} className="rounded-lg bg-warn-soft px-3 py-2"><strong>{c.a}</strong> {c.b}</div>)}
        </div>
      )}
    </div>
  );
}

function GenDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data: d, error, mutate } = useApi<Detail>(id ? `/api/admin/generated/${id}` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (action: "approve" | "regenerate" | "disable") => {
    setBusy(action);
    try {
      await api.post(`/api/admin/generated/${id}`, { action });
      toast.success({ approve: "Approved. Flags cleared.", regenerate: "Regenerating…", disable: "Disabled for everyone" }[action]);
      mutate();
      onChanged();
      if (action !== "regenerate") onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Drawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      width={520}
      title={
        <span className="flex flex-col gap-1">
          {d && (
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold tracking-[0.06em] text-ink3">{d.kind.toUpperCase()}</span>
              <StatusPill s={d.s} />
            </span>
          )}
          <span>{d?.t || "Generated content"}</span>
        </span>
      }
      sub={d && `${d.sub} · generated ${d.when} · ${d.views} views`}
      footer={
        d && (
          <div className="flex w-full flex-wrap justify-end gap-2">
            {d.s !== "Disabled" && <Button variant="danger" loading={busy === "disable"} onClick={() => act("disable")}>Disable</Button>}
            <Button icon="refresh" loading={busy === "regenerate"} disabled={d.s === "Processing"} onClick={() => act("regenerate")}>Regenerate</Button>
            <Button variant="primary" loading={busy === "approve"} disabled={d.s === "Processing" || !d.outputs.full?.length} onClick={() => act("approve")}>{d.s === "Disabled" ? "Re-enable" : "Approve"}</Button>
          </div>
        )
      }
    >
      {error ? (
        <ErrorState error={error} retry={() => mutate()} />
      ) : !d ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5 rounded-xl bg-bg px-3.5 py-3">
            <Icon name="description" className="text-ink2" />
            <div className="min-w-0">
              <div className="text-[11px] text-ink2">Generated from</div>
              {d.source?.url ? (
                <a href={d.source.url} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-semibold">{d.source.title || d.src}</a>
              ) : (
                <div className="truncate text-[13px] font-semibold">{d.source?.title || d.src}</div>
              )}
            </div>
          </div>
          {!!d.flags.length && (
            <div className="flex flex-col gap-2">
              <div className="text-[13px] font-bold">Student flags</div>
              {d.flags.map((f, i) => (
                <div key={i} className="rounded-xl bg-err-soft px-3.5 py-3">
                  <div className="flex justify-between gap-2 text-xs font-bold text-err-ink"><span>{f.a}</span><span>{f.c}</span></div>
                  <div className="mt-1 text-[13px]">{f.b}</div>
                </div>
              ))}
            </div>
          )}
          {d.s === "Failed" && <div className="rounded-xl bg-err-soft px-3.5 py-3 text-[13px] text-err-ink">{d.ex}</div>}
          {d.s === "Processing" && <div className="text-[13px] text-ink2">{d.ex}</div>}
          <div>
            <div className="mb-2 text-[13px] font-bold">Preview</div>
            <Preview o={d.outputs} />
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default function Generated() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  const { data, error, mutate } = useApi<List>(`/api/admin/generated?status=${encodeURIComponent(status)}`, {
    keepPreviousData: true,
    refreshInterval: (d) => (d?.rows.some((r) => r.s === "Processing") ? 4000 : 0),
  });
  const open = params.get("open");
  const setOpen = (id: string | null) => router.replace(id ? `${path}?open=${id}` : path, { scroll: false });

  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  return (
    <div className="flex flex-col gap-4">
      <FilterChips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ v: s, n: data?.counts[s] ?? 0 }))} />
      {!data ? (
        <Loading />
      ) : (
        <Table cols={COLS} minWidth={860} headers={["Title", "Kind", "Source", "Subject", "Generated", "Flags", "Views", "Status"]} empty={status === "All" ? "No study material has been generated yet." : `Nothing is ${status.toLowerCase()}.`}>
          {data.rows.map((g) => (
            <Row key={g.id} cols={COLS} onClick={() => setOpen(g.id)} active={g.flags.length > 0 && g.s === "Flagged"}>
              <strong className="truncate">{g.t}</strong>
              <span>{g.kind}</span>
              <span className="truncate text-ink2">{g.src}</span>
              <span className="truncate">{g.sub}</span>
              <span className="font-mono text-xs text-ink2">{g.when}</span>
              <span className="flex items-center gap-1 text-ink2"><Icon name="flag" size={15} />{g.flags.reduce((a, f) => a + parseInt(f.c), 0)}</span>
              <span className="font-mono text-xs">{g.views}</span>
              <span><StatusPill s={g.s} /></span>
            </Row>
          ))}
        </Table>
      )}
      <GenDrawer id={open} onClose={() => setOpen(null)} onChanged={() => mutate()} />
    </div>
  );
}
