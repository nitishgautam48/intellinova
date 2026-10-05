"use client";

import { useState } from "react";
import { toast } from "sonner";

import { BarList, Panel, RowBars } from "@/components/admin/kit";
import { Button, ErrorState, Icon, Loading, Segmented } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Analytics = {
  range: string; label: string;
  kpis: { l: string; v: string; d: string }[];
  top: { t: string; n: number }[];
  zero: { t: string; n: number; task: boolean }[];
  chapters: { t: string; s: string; n: number; w: string }[];
  selection: { t: string; n: number; h: number | null }[];
  modules: { l: string; icon: string; c: string; tot: number; bars: number[] }[];
};
type Task = { id: string; title: string; status: string; when: string };

function deltaColor(l: string, d: string) {
  if (!/^[+−]/.test(d)) return "var(--ink2)";
  const up = d.startsWith("+");
  const good = l.startsWith("Zero") ? !up : up;
  return good ? "var(--ok-ink)" : "var(--err-ink)";
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-line py-4 text-[13px] text-ink2">{children}</div>;
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<"7d" | "30d" | "90d">("7d");
  const { data, error, mutate } = useApi<Analytics>(`/api/admin/analytics?range=${range}`, { keepPreviousData: true });
  const tasks = useApi<Task[]>("/api/admin/content-tasks");

  const createTask = async (t: string) => {
    try {
      await api.post("/api/admin/content-tasks", { title: t });
      toast.success("Content task created");
      mutate();
      tasks.mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const done = async (id: string) => {
    try {
      await api.post(`/api/admin/content-tasks/${id}/done`);
      tasks.mutate();
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const openTasks = tasks.data?.filter((t) => t.status === "open") || [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="text-[13px] text-ink2">Showing {data.label}</div>
        <Segmented value={range} onChange={setRange} options={[{ v: "7d", l: "7 days" }, { v: "30d", l: "30 days" }, { v: "90d", l: "90 days" }]} />
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        {data.kpis.map((k) => (
          <div key={k.l} className="rounded-[14px] border border-line bg-surface p-4">
            <div className="text-[13px] text-ink2">{k.l}</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-display text-[26px] font-semibold leading-none">{k.v}</span>
              <span className="font-mono text-xs font-semibold" style={{ color: deltaColor(k.l, k.d) }}>{k.d}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
        <Panel title="Top searches">
          {data.top.length ? <BarList items={data.top} /> : <Quiet>No searches with results in this period.</Quiet>}
        </Panel>
        <Panel title="Zero-result searches" sub="Each one is a gap in the catalog">
          {data.zero.length ? (
            data.zero.map((z) => (
              <div key={z.t} className="flex items-center gap-2.5 border-t border-line py-[9px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{z.t}</span>
                <span className="text-xs text-ink2">{z.n}</span>
                {z.task ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-ok-ink"><Icon name="check" size={15} />Task open</span>
                ) : (
                  <Button size="xs" onClick={() => createTask(z.t)}>Create task</Button>
                )}
              </div>
            ))
          ) : (
            <Quiet>Every search found something.</Quiet>
          )}
        </Panel>
        <Panel title="Popular chapters">
          {data.chapters.length ? <RowBars items={data.chapters} /> : <Quiet>No chapter views in this period.</Quiet>}
        </Panel>
        <Panel
          title="Most selected resources"
          right={
            <div className="flex gap-2.5 text-[11px] text-ink2">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-ok" />Helpful</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-err" />Not helpful</span>
            </div>
          }
        >
          {data.selection.length ? (
            data.selection.map((r) => (
              <div key={r.t} className="border-t border-line py-2">
                <div className="mb-1.5 flex justify-between gap-2 text-[13px]">
                  <span className="min-w-0 truncate font-semibold">{r.t}</span>
                  <span className="whitespace-nowrap text-ink2">{r.n} picks{r.h !== null ? ` · ${r.h}% helpful` : ""}</span>
                </div>
                {r.h !== null ? (
                  <div className="flex h-2 gap-0.5 overflow-hidden rounded">
                    <div className="bg-ok" style={{ width: `${r.h}%` }} />
                    <div className="bg-err" style={{ width: `${100 - r.h}%` }} />
                  </div>
                ) : (
                  <div className="h-2 rounded bg-surface2" title="No ratings yet" />
                )}
              </div>
            ))
          ) : (
            <Quiet>No resources opened in this period.</Quiet>
          )}
        </Panel>
        <div className="grid gap-4" style={{ gridColumn: "1 / -1", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
          {data.modules.map((m) => {
            const mx = Math.max(1, ...m.bars);
            return (
              <div key={m.l} className="rounded-[14px] border border-line bg-surface p-[18px]">
                <div className="flex items-center gap-2 text-[13px] text-ink2">
                  <Icon name={m.icon} size={18} style={{ color: `var(--${m.c})` }} />
                  {m.l}
                </div>
                <div className="mt-2 font-display text-2xl font-semibold leading-none">
                  {m.tot} <span className="font-sans text-xs font-medium text-ink2">events</span>
                </div>
                <div className="mt-3.5 flex h-16 items-end gap-1.5">
                  {m.bars.map((b, i) => (
                    <div key={i} title={String(b)} className="flex-1 rounded-t-[4px] rounded-b-[2px] opacity-85" style={{ height: `${Math.max(4, (100 * b) / mx)}%`, background: b ? `var(--${m.c})` : "var(--surface2)" }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <Panel title="Open content tasks" sub="Created from zero-result searches" className="col-span-full">
          {openTasks.length ? (
            openTasks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 border-t border-line py-2.5">
                <Icon name="task_alt" className="text-ink2" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[13px]">{t.title}</div>
                  <div className="text-xs text-ink2">Created {t.when}</div>
                </div>
                <Button size="xs" icon="check" onClick={() => done(t.id)}>Done</Button>
              </div>
            ))
          ) : (
            <Quiet>No open tasks.</Quiet>
          )}
        </Panel>
      </div>
    </div>
  );
}
