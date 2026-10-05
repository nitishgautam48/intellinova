"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FilterChips, LANGS, MultiPick, Row, StatusPill, Table, type Structure } from "@/components/admin/kit";
import { Alert, Button, ErrorState, Field, Icon, Input, LinkButton, Loading, Select, Textarea } from "@/components/ui";
import { Confirm, Drawer } from "@/components/ui/dialog";
import { api, qs, useApi } from "@/lib/api";
import { toneOf } from "@/lib/utils";

type ResRow = { id: string; t: string; plat: string; type: string; cls: string; sub: string; chap: string; lang: string; diff: string; q: string; s: string; chk: string; url: string; auto: boolean };
type List = { counts: Record<string, number>; rows: ResRow[] };
type Detail = ResRow & {
  creator: string; dur: string; description: string; thumb: string; languages: string[]; difficulty: string; quality: string | null;
  subject_id: string | null; chapter_id: string | null; class_level: string; topics: { id: string; name: string }[];
  reports: { id: string; reason: string; note: string; when: string; resolved: boolean }[]; signal: Record<string, number | string | null | undefined>; check_ok: boolean; created: string;
  discovery: { reason: string; relevance: number | null; search: string; source: string; reddit: { posts: number; upvotes: number; subreddits: string[] } | null; when: string } | null;
};

const STATUSES = ["All", "Active", "Needs Review", "Draft", "Unavailable", "Disabled"] as const;
const COLS = "2.4fr .9fr .8fr .5fr .8fr 1fr .7fr .8fr .6fr 1fr .8fr";
const fmtN = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

function ResourceDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data: d, error, mutate } = useApi<Detail>(id ? `/api/admin/resources/${id}` : null);
  const { data: tree } = useApi<Structure>(id ? "/api/admin/structure" : null);
  const [f, setF] = useState<{ title: string; status: string; quality: string; difficulty: string; languages: string[]; subject_id: string; chapter_id: string; topic_ids: string[]; description: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [del, setDel] = useState(false);

  useEffect(() => {
    if (d) setF({ title: d.t, status: d.s, quality: d.quality || "", difficulty: d.difficulty, languages: d.languages || [], subject_id: d.subject_id || "", chapter_id: d.chapter_id || "", topic_ids: d.topics.map((t) => t.id), description: d.description || "" });
  }, [d]);

  const subj = tree?.find((s) => s.id === f?.subject_id);
  const chapters = subj?.chapters || [];
  const topicOpts = (chapters.find((c) => c.id === f?.chapter_id)?.topics || chapters.flatMap((c) => c.topics)).map((t) => ({ id: t.id, name: t.name }));
  const knownTopics = [...topicOpts, ...(d?.topics || [])];

  const save = async () => {
    if (!f) return;
    setBusy(true);
    try {
      await api.patch(`/api/admin/resources/${id}`, {
        title: f.title, status: f.status, quality: f.quality || null, difficulty: f.difficulty, languages: f.languages, description: f.description,
        subject_id: f.subject_id || null, chapter_id: f.chapter_id || null, topic_ids: f.topic_ids, class_level: subj?.class_level ?? d?.class_level ?? "",
      });
      toast.success("Saved");
      mutate();
      onChanged();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const recheck = async () => {
    setChecking(true);
    try {
      const r = await api.post<{ ok: boolean; status: string }>(`/api/admin/resources/${id}/recheck`);
      toast[r.ok ? "success" : "error"](r.ok ? "Link is reachable" : "Link is unreachable. Marked unavailable.");
      mutate();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Drawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={d?.t || "Resource"}
      sub={d && <a href={d.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-[11px]">{d.url}</a>}
      width={500}
      footer={
        <>
          <Button variant="danger" icon="delete" onClick={() => setDel(true)} disabled={!d}>Delete</Button>
          <div className="flex-1" />
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!f}>Save changes</Button>
        </>
      }
    >
      {error ? (
        <ErrorState error={error} retry={() => mutate()} />
      ) : !d || !f ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-[18px]">
          {d.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.thumb} alt="" className="aspect-[16/8] w-full rounded-xl object-cover" />
          ) : (
            <div className="grid aspect-[16/8] place-items-center rounded-xl" style={{ background: "repeating-linear-gradient(135deg,var(--surface2) 0 10px,var(--stripe) 10px 20px)" }}>
              <span className="font-mono text-[11px] text-ink3">no thumbnail</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              ["Platform", `${d.plat} · ${d.type}`], ["Creator", d.creator || "—"], ["Duration", d.dur || "—"], ["Added", d.created],
              ["Views", fmtN(d.signal.views as number)], ["Like ratio", d.signal.like_ratio ? `${(100 * (d.signal.like_ratio as number)).toFixed(1)}%` : "—"],
              ["Positive comments", typeof d.signal.positive_share === "number" ? `${Math.round(100 * d.signal.positive_share)}% of ${d.signal.comments_sampled}` : "—"], ["Class", d.cls],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[10px] bg-bg px-3 py-2.5">
                <div className="text-[11px] text-ink2">{k}</div>
                <div className="truncate text-[13px] font-semibold">{v}</div>
              </div>
            ))}
          </div>
          {d.discovery && (
            <div className="flex flex-col gap-1.5 rounded-xl bg-pri-soft px-3.5 py-3 text-[13px] text-pri-ink">
              <div className="flex items-center gap-1.5 font-bold"><Icon name="travel_explore" size={17} />Found automatically on {d.discovery.when}</div>
              {d.discovery.reason && <div>“{d.discovery.reason}”</div>}
              <div className="font-mono text-[11px]">
                relevance {d.discovery.relevance ?? "—"} · search “{d.discovery.search}” · via {d.discovery.source}
                {d.discovery.reddit?.posts ? ` · ${d.discovery.reddit.posts} Reddit posts (r/${d.discovery.reddit.subreddits.join(", r/")})` : ""}
              </div>
              <div className="text-xs text-ink2">Set the status to Disabled to remove it. It won&apos;t be added again.</div>
            </div>
          )}
          <div>
            <div className="mb-2 text-[13px] font-bold">Status</div>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.slice(1).map((s) => {
                const on = f.status === s;
                const tone = toneOf(s);
                return (
                  <button key={s} onClick={() => setF({ ...f, status: s })} className="h-8 rounded-full border-[1.5px] px-3 text-xs font-bold" style={{ borderColor: on ? `var(--${tone === "mute" ? "ink2" : tone})` : "var(--line)", background: on ? `var(--${tone === "mute" ? "surface2" : `${tone}-soft`})` : "var(--surface)", color: on ? `var(--${tone === "mute" ? "ink" : `${tone}-ink`})` : "var(--ink2)" }}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Subject">
              <Select value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value, chapter_id: "", topic_ids: [] })}>
                <option value="">—</option>
                {tree?.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>
            <Field label="Chapter">
              <Select value={f.chapter_id} onChange={(e) => setF({ ...f, chapter_id: e.target.value })} disabled={!chapters.length}>
                <option value="">—</option>
                {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Difficulty">
              <Select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}>
                {["Beginner", "Intermediate", "Advanced"].map((x) => <option key={x}>{x}</option>)}
              </Select>
            </Field>
            <Field label="Quality">
              <Select value={f.quality} onChange={(e) => setF({ ...f, quality: e.target.value })}>
                <option value="">Not rated</option>
                {["High", "Medium", "Low"].map((x) => <option key={x}>{x}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Topics covered">
            <MultiPick value={f.topic_ids} onChange={(v) => setF({ ...f, topic_ids: v })} options={knownTopics} placeholder={topicOpts.length ? "Add a topic…" : "Pick a subject first"} />
          </Field>
          <Field label="Languages">
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...LANGS, ...f.languages])].map((l) => {
                const on = f.languages.includes(l);
                return (
                  <button key={l} onClick={() => setF({ ...f, languages: on ? f.languages.filter((x) => x !== l) : [...f.languages, l] })} className="h-7 rounded-full border px-2.5 text-xs font-semibold" style={{ borderColor: on ? "var(--pri)" : "var(--line)", background: on ? "var(--pri-soft)" : "var(--surface)", color: on ? "var(--pri-ink)" : "var(--ink2)" }}>
                    {l}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Description"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <div className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-3">
            <Icon name={d.check_ok ? "link" : "link_off"} className={d.check_ok ? "text-ink2" : "text-err"} />
            <div className="flex-1">
              <div className="text-[13px] font-semibold">Availability</div>
              <div className="font-mono text-[11px] text-ink2">Last checked {d.chk} · daily</div>
            </div>
            <Button size="xs" loading={checking} onClick={recheck}>Re-check</Button>
          </div>
          {!!d.reports.length && (
            <div className="flex flex-col gap-2">
              <div className="text-[13px] font-bold">Student reports</div>
              {d.reports.map((r) => (
                <div key={r.id} className="rounded-xl px-3.5 py-2.5" style={{ background: r.resolved ? "var(--surface2)" : "var(--err-soft)" }}>
                  <div className="flex justify-between gap-2 text-xs font-bold" style={{ color: r.resolved ? "var(--ink2)" : "var(--err-ink)" }}>
                    <span>{r.reason}</span>
                    <span>{r.resolved ? "Resolved" : r.when}</span>
                  </div>
                  {r.note && <div className="mt-1 text-[13px]">{r.note}</div>}
                </div>
              ))}
              <div className="text-xs text-ink2">Setting the status to Active resolves open reports.</div>
            </div>
          )}
        </div>
      )}
      <Confirm open={del} onOpenChange={setDel} title="Delete this resource?" danger confirmLabel="Delete" onConfirm={async () => {
        setDel(false);
        try {
          await api.del(`/api/admin/resources/${id}`);
          toast.success("Resource deleted");
          onChanged();
          onClose();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}>
        It will disappear from recommendations, saved lists and search. To hide it temporarily, set the status to Disabled instead.
      </Confirm>
    </Drawer>
  );
}

export default function Resources() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  const [autoOnly, setAutoOnly] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [q, setQ] = useState(params.get("q") || "");
  const [qd, setQd] = useState(q);
  const open = params.get("open");
  useEffect(() => {
    setQ(params.get("q") || "");
  }, [params]);
  useEffect(() => {
    const t = setTimeout(() => setQd(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, mutate } = useApi<List>(`/api/admin/resources${qs({ status, q: qd, origin: autoOnly ? "auto" : "" })}`, { keepPreviousData: true });

  const setOpen = (id: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (id) p.set("open", id);
    else p.delete("open");
    router.replace(`${path}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };

  if (error) return <ErrorState error={error} retry={() => mutate()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChips value={status} onChange={setStatus} options={STATUSES.map((s) => ({ v: s, n: data?.counts[s] ?? 0 }))} />
          <button onClick={() => setAutoOnly(!autoOnly)} aria-pressed={autoOnly} title="Videos found automatically on YouTube" className="flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold" style={{ borderColor: autoOnly ? "var(--pri)" : "var(--line)", background: autoOnly ? "var(--pri-soft)" : "var(--surface)", color: autoOnly ? "var(--pri-ink)" : "var(--ink)" }}>
            <Icon name="travel_explore" size={15} />Auto-found<span className="font-mono text-[11px] font-medium opacity-70">{data?.counts["Auto-found"] ?? 0}</span>
          </button>
          <button onClick={() => setShowLog(true)} className="flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs font-semibold">
            <Icon name="history" size={15} />Search log
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 w-[240px] items-center gap-2 rounded-[10px] border border-line bg-surface px-3">
            <Icon name="search" size={18} className="text-ink3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title" className="min-w-0 flex-1 border-0 bg-transparent outline-none" />
          </label>
          <LinkButton href="/admin/resources/new" variant="primary" icon="add">Add resource</LinkButton>
        </div>
      </div>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="hidden md:block">
            <Table cols={COLS} minWidth={1020} headers={["Title", "Platform", "Type", "Class", "Subject", "Chapter", "Lang", "Difficulty", "Quality", "Status", "Checked"]} empty={qd || status !== "All" ? "No resources match." : "The catalog is empty. Add the first resource."}>
              {data.rows.map((r) => (
                <Row key={r.id} cols={COLS} onClick={() => setOpen(r.id)}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    {r.auto && <span title="Found automatically"><Icon name="travel_explore" size={16} className="flex-none text-pri" /></span>}
                    <span className="truncate font-semibold">{r.t}</span>
                  </span>
                  <span className="text-ink2">{r.plat}</span>
                  <span>{r.type}</span>
                  <span>{r.cls}</span>
                  <span className="truncate">{r.sub}</span>
                  <span className="truncate">{r.chap}</span>
                  <span className="truncate">{r.lang}</span>
                  <span>{r.diff}</span>
                  <span>{r.q}</span>
                  <span><StatusPill s={r.s} /></span>
                  <span className="font-mono text-xs text-ink2">{r.chk}</span>
                </Row>
              ))}
            </Table>
          </div>
          <div className="flex flex-col gap-2.5 md:hidden">
            {data.rows.map((r) => (
              <button key={r.id} onClick={() => setOpen(r.id)} className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface p-3.5 text-left">
                <div className="flex justify-between gap-2">
                  <div className="font-bold">{r.t}</div>
                  <StatusPill s={r.s} className="self-start" />
                </div>
                <div className="text-xs text-ink2">{r.type} · {r.plat} · Class {r.cls} {r.sub} · {r.chap}</div>
                <div className="font-mono text-[11px] text-ink3">{r.lang} · {r.diff} · checked {r.chk}</div>
              </button>
            ))}
            {!data.rows.length && <Alert tone="mute">No resources match.</Alert>}
          </div>
        </>
      )}
      <ResourceDrawer id={open} onClose={() => setOpen(null)} onChanged={() => mutate()} />
      <DiscoveryLog open={showLog} onClose={() => setShowLog(false)} />
    </div>
  );
}

type Disc = { id: string; label: string; kind: string; lang: string; status: string; added: number; error: string; when: string; stats: Record<string, number | string | boolean> };

function DiscoveryLog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, error, mutate } = useApi<Disc[]>(open ? "/api/admin/discoveries" : null, {
    refreshInterval: (x) => (x?.some((d) => d.status === "queued" || d.status === "running") ? 4000 : 0),
  });
  const tone: Record<string, string> = { done: "Ready", running: "Processing", queued: "Processing", failed: "Failed", skipped: "Skipped" };
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} title="Automatic video searches" sub="When a topic has too few videos, IntelliNova searches YouTube, checks each result against the syllabus and adds the best." width={560}>
      {error ? (
        <ErrorState error={error} retry={() => mutate()} />
      ) : !data ? (
        <Loading />
      ) : !data.length ? (
        <div className="text-[13px] text-ink2">No searches yet. They start when students open a chapter or search a topic with few videos, or from Curriculum › topic › Find videos.</div>
      ) : (
        <div className="flex flex-col">
          {data.map((d) => (
            <div key={d.id} className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{d.label}</span>
                <StatusPill s={tone[d.status] || d.status} />
              </div>
              <div className="text-xs text-ink2">
                {d.kind} · {d.lang === "hi" ? "Hindi" : "English"} · {d.when}
                {d.status === "done" && ` · ${d.stats.found ?? 0} found → ${d.stats.passed_filters ?? 0} passed filters → ${d.stats.relevant ?? 0} judged relevant → ${d.added} added`}
                {d.status === "skipped" && " · not a study topic"}
              </div>
              {d.error && <div className="text-xs text-err-ink">{d.error}</div>}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
