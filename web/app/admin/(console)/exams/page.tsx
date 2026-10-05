"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Panel, StatusPill, Table, Row, TopicSearch } from "@/components/admin/kit";
import { Button, Checkbox, Empty, ErrorState, Field, Icon, Input, LinkButton, Loading, Select, Textarea } from "@/components/ui";
import { Confirm, Modal } from "@/components/ui/dialog";
import { api, useApi } from "@/lib/api";

type ExamRow = { id: string; n: string; code: string; full: string; st: string; topics: number; res: number; stale: boolean };
type ETopic = { id: string; name: string; priority: string; prereq_id: string | null; topic_id: string | null; topic_name: string | null; resources: { id: string; name: string }[] };
type EUnit = { id: string; n: string; t: number; p: number; r: number; topics: ETopic[] };
type Fact = { id: string; k: string; v: string; src: string; url: string; d: string; s: string };
type Exam = { id: string; n: string; code: string; full: string; description: string; st: string; stats: { l: string; v: number }[]; subjects: { id: string; name: string; units: EUnit[] }[]; facts: Fact[] };

function IconBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid h-7 w-7 flex-none place-items-center rounded-[7px] border-0 bg-transparent text-ink2 hover:bg-surface2">
      <Icon name={icon} size={17} />
    </button>
  );
}

function ResourceSearch({ onPick, exclude }: { onPick: (r: { id: string; name: string }) => void; exclude: string[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; t: string; plat: string; s: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => api.get<{ rows: { id: string; t: string; plat: string; s: string }[] }>(`/api/admin/resources?q=${encodeURIComponent(q.trim())}`).then((r) => setHits(r.rows.slice(0, 8))).catch(() => setHits([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  const shown = hits.filter((h) => !exclude.includes(h.id));
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="+ Map a resource (search by title)…" className="h-9 w-full rounded-[9px] border border-line bg-surface px-3 text-[13px] outline-none focus:border-pri" />
      {shown.length > 0 && (
        <div className="absolute left-0 right-0 top-10 z-10 max-h-64 overflow-auto rounded-[10px] border border-line bg-surface p-1 shadow-card">
          {shown.map((o) => (
            <button key={o.id} onClick={() => (onPick({ id: o.id, name: o.t }), setQ(""), setHits([]))} className="block w-full rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-left hover:bg-surface2">
              <span className="block truncate text-[13px] font-semibold">{o.t}</span>
              <span className="block text-[11px] text-ink2">{o.plat} · {o.s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TopicModal({ exam, topic, unitTopics, onClose, onSaved }: { exam: Exam; topic: ETopic | null; unitTopics: ETopic[]; onClose: () => void; onSaved: (e: Exam) => void }) {
  const [f, setF] = useState<ETopic | null>(topic);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF(topic);
  }, [topic]);
  if (!f) return null;
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api.patch<Exam>(`/api/admin/exams/${exam.id}/structure/topic/${f.id}`, { name: f.name, priority: f.priority, prereq_id: f.prereq_id, topic_id: f.topic_id, resource_ids: f.resources.map((r) => r.id) }));
      toast.success("Topic saved");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Exam topic" width={560} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3.5">
        <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 140px" }}>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              {["High", "Medium", "Low"].map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Prerequisite within this unit">
          <Select value={f.prereq_id || ""} onChange={(e) => setF({ ...f, prereq_id: e.target.value || null })}>
            <option value="">None</option>
            {unitTopics.filter((t) => t.id !== f.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Linked curriculum topic" hint="Lets the tutor and practice use school content for this exam topic.">
          <div className="flex flex-col gap-2">
            {f.topic_id ? (
              <span className="flex items-center gap-1 self-start rounded-lg bg-pri-soft px-2.5 py-1 text-xs font-semibold text-pri-ink">
                {f.topic_name || "Linked topic"}
                <button onClick={() => setF({ ...f, topic_id: null, topic_name: null })} className="grid border-0 bg-transparent p-0 text-inherit" aria-label="Unlink"><Icon name="close" size={14} /></button>
              </span>
            ) : (
              <span className="text-xs text-ink2">Not linked</span>
            )}
            <TopicSearch onPick={(t) => setF({ ...f, topic_id: t.id, topic_name: t.name })} placeholder="Search curriculum topics…" />
          </div>
        </Field>
        <Field label="Mapped resources" hint="Target: 2 per topic.">
          <div className="flex flex-col gap-2">
            {f.resources.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px]">
                <Icon name="video_library" size={16} className="text-ink2" />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <IconBtn icon="close" label="Remove" onClick={() => setF({ ...f, resources: f.resources.filter((x) => x.id !== r.id) })} />
              </div>
            ))}
            <ResourceSearch exclude={f.resources.map((r) => r.id)} onPick={(r) => setF({ ...f, resources: [...f.resources, r] })} />
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function StructureEditor({ exam, apply }: { exam: Exam; apply: (fn: () => Promise<Exam>, msg?: string) => Promise<void> }) {
  const [adding, setAdding] = useState<null | { kind: "subject" | "unit" | "topic"; parent?: string; title: string }>(null);
  const [name, setName] = useState("");
  const [rename, setRename] = useState<null | { kind: string; id: string; name: string }>(null);
  const [editTopic, setEditTopic] = useState<{ t: ETopic; unit: EUnit } | null>(null);
  const [del, setDel] = useState<null | { kind: string; id: string; name: string }>(null);
  const url = `/api/admin/exams/${exam.id}/structure`;

  return (
    <Panel title="Structure" sub="Subjects › units › topics. Students plan and track at topic level." right={<Button size="xs" icon="add" onClick={() => (setName(""), setAdding({ kind: "subject", title: "Add subject" }))}>Subject</Button>}>
      {!exam.subjects.length && <div className="border-t border-line py-4 text-[13px] text-ink2">No subjects yet. Add the exam&apos;s sections or subjects first.</div>}
      {exam.subjects.map((s) => (
        <div key={s.id} className="border-t border-line py-2.5">
          <div className="flex items-center gap-1.5">
            <Icon name="folder" size={18} className="text-ink2" />
            <strong className="flex-1">{s.name}</strong>
            <IconBtn icon="edit" label="Rename" onClick={() => setRename({ kind: "subject", id: s.id, name: s.name })} />
            <IconBtn icon="delete" label="Delete" onClick={() => setDel({ kind: "subject", id: s.id, name: s.name })} />
            <Button size="xs" variant="ghost" icon="add" onClick={() => (setName(""), setAdding({ kind: "unit", parent: s.id, title: `Add unit to ${s.name}` }))}>Unit</Button>
          </div>
          {s.units.map((u) => (
            <div key={u.id} className="ml-6 mt-1.5 rounded-[10px] border border-line">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                <span className="flex-1 text-[13px] font-semibold">{u.n}</span>
                <span className="text-xs text-ink2">{u.t} topics · {u.r} resources</span>
                <IconBtn icon="edit" label="Rename" onClick={() => setRename({ kind: "unit", id: u.id, name: u.n })} />
                <IconBtn icon="delete" label="Delete" onClick={() => setDel({ kind: "unit", id: u.id, name: u.n })} />
                <Button size="xs" variant="ghost" icon="add" onClick={() => (setName(""), setAdding({ kind: "topic", parent: u.id, title: `Add topic to ${u.n}` }))}>Topic</Button>
              </div>
              {u.topics.map((t) => (
                <div key={t.id} className="flex items-center gap-2 border-t border-line px-2.5 py-1.5 text-[13px]">
                  <button onClick={() => setEditTopic({ t, unit: u })} className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left hover:text-pri-ink">{t.name}</button>
                  {t.topic_name && <span title="Linked curriculum topic" className="flex items-center gap-0.5 text-[11px] text-ink2"><Icon name="link" size={14} />{t.topic_name}</span>}
                  <span className="flex items-center gap-0.5 text-[11px] text-ink2" title="Mapped resources"><Icon name="video_library" size={14} />{t.resources.length}</span>
                  <StatusPill s={t.priority} />
                  <IconBtn icon="edit" label="Edit topic" onClick={() => setEditTopic({ t, unit: u })} />
                  <IconBtn icon="delete" label="Delete" onClick={() => setDel({ kind: "topic", id: t.id, name: t.name })} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      <Modal open={!!adding} onOpenChange={(o) => !o && setAdding(null)} title={adding?.title || ""} width={420} footer={
        <>
          <Button onClick={() => setAdding(null)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            if (!name.trim()) return;
            const a = adding!;
            setAdding(null);
            await apply(() => api.post<Exam>(url, { kind: a.kind, parent_id: a.parent || null, name: name.trim() }));
          }}>Add</Button>
        </>
      }>
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </Modal>
      <Modal open={!!rename} onOpenChange={(o) => !o && setRename(null)} title="Rename" width={420} footer={
        <>
          <Button onClick={() => setRename(null)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            const r = rename!;
            setRename(null);
            await apply(() => api.patch<Exam>(`${url}/${r.kind}/${r.id}`, { name: r.name }));
          }}>Save</Button>
        </>
      }>
        {rename && <Field label="Name"><Input autoFocus value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} /></Field>}
      </Modal>
      <TopicModal exam={exam} topic={editTopic?.t || null} unitTopics={editTopic?.unit.topics || []} onClose={() => setEditTopic(null)} onSaved={(e) => apply(async () => e)} />
      <Confirm open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete this ${del?.kind}?`} danger confirmLabel="Delete" onConfirm={async () => {
        const d = del!;
        setDel(null);
        await apply(() => api.del<Exam>(`${url}/${d.kind}/${d.id}`), "Deleted");
      }}>
        “{del?.name}”{del?.kind !== "topic" ? " and everything inside it" : ""} will be removed. Students&apos; plan entries for these topics are removed too.
      </Confirm>
    </Panel>
  );
}

function FactModal({ exam, fact, onClose, apply }: { exam: Exam; fact: Fact | "new" | null; onClose: () => void; apply: (fn: () => Promise<Exam>, msg?: string) => Promise<void> }) {
  const [f, setF] = useState({ key: "", value: "", source_name: "", source_url: "", verify: false });
  useEffect(() => {
    if (fact === "new") setF({ key: "", value: "", source_name: "", source_url: "", verify: false });
    else if (fact) setF({ key: fact.k, value: fact.v, source_name: fact.src, source_url: fact.url, verify: false });
  }, [fact]);
  if (!fact) return null;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={fact === "new" ? "Add fact" : "Edit fact"} sub="Only facts verified against an official source in the last 12 months are shown without a warning." width={560} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={async () => {
          if (f.verify && !f.source_name.trim()) return toast.error("Add the official source before marking this verified.");
          onClose();
          await apply(() => (fact === "new" ? api.post<Exam>(`/api/admin/exams/${exam.id}/facts`, f) : api.patch<Exam>(`/api/admin/exams/${exam.id}/facts/${fact.id}`, f)), "Fact saved");
        }}>Save</Button>
      </>
    }>
      <div className="flex flex-col gap-3">
        <Field label="Fact"><Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="e.g. Eligibility" /></Field>
        <Field label="Value"><Textarea rows={3} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Official source"><Input value={f.source_name} onChange={(e) => setF({ ...f, source_name: e.target.value })} placeholder="e.g. IIM Indore IPM brochure 2025" /></Field>
          <Field label="Source URL"><Input value={f.source_url} onChange={(e) => setF({ ...f, source_url: e.target.value })} placeholder="https://" /></Field>
        </div>
        <Checkbox checked={f.verify} onChange={(v) => setF({ ...f, verify: v })}>I checked this against the source today (mark verified)</Checkbox>
      </div>
    </Modal>
  );
}

export default function ExamsAdmin() {
  const list = useApi<ExamRow[]>("/api/admin/exams");
  const [sel, setSel] = useState<string | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [newExam, setNewExam] = useState(false);
  const [nf, setNf] = useState({ code: "", name: "", full_name: "" });
  const [fact, setFact] = useState<Fact | "new" | null>(null);
  const [delFact, setDelFact] = useState<Fact | null>(null);

  const id = sel || list.data?.[0]?.id || null;
  useEffect(() => {
    if (!id) return;
    setErr(null);
    setExam(null);
    api.get<Exam>(`/api/admin/exams/${id}`).then(setExam).catch(setErr);
  }, [id]);

  const apply = async (fn: () => Promise<Exam>, msg?: string) => {
    try {
      setExam(await fn());
      list.mutate();
      if (msg) toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (list.error) return <ErrorState error={list.error} retry={() => list.mutate()} />;
  if (!list.data) return <Loading />;

  const units = exam?.subjects.flatMap((s) => s.units.map((u) => ({ ...u, sub: s.name }))) || [];
  const cols = "1.2fr 1.4fr .6fr .8fr .8fr 1.4fr";
  const fcols = "1.1fr 1.7fr 1.5fr .9fr 1fr 110px";

  return (
    <div className="flex flex-wrap items-start gap-4">
      <Panel pad={false} className="min-w-[240px] flex-[0_1_270px] overflow-hidden" title="Exams" right={<Button size="xs" onClick={() => (setNf({ code: "", name: "", full_name: "" }), setNewExam(true))}>+ New exam</Button>}>
        {list.data.map((e) => (
          <button key={e.id} onClick={() => (setSel(e.id), setEditing(false))} className="flex w-full items-center gap-2.5 border-0 border-t border-line px-4 py-3 text-left" style={{ background: e.id === id ? "var(--pri-soft)" : "transparent" }}>
            <div className="min-w-0 flex-1">
              <div className="font-bold">{e.n}</div>
              <div className="text-xs text-ink2">{e.topics} topics · {e.res} resources</div>
            </div>
            {e.stale && <span title="Facts need re-verification"><Icon name="warning" size={18} style={{ color: "var(--warn)" }} /></span>}
            <StatusPill s={e.st} />
          </button>
        ))}
        {!list.data.length && <div className="border-t border-line px-4 py-6 text-[13px] text-ink2">No exams yet.</div>}
      </Panel>

      <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-4">
        {!list.data.length ? (
          <Empty icon="flag" title="Add your first entrance exam" action={<Button variant="primary" onClick={() => setNewExam(true)}>New exam</Button>}>
            Students see exam overviews, a topic plan and verified facts such as eligibility and dates.
          </Empty>
        ) : err ? (
          <ErrorState error={err} retry={() => id && api.get<Exam>(`/api/admin/exams/${id}`).then(setExam).catch(setErr)} />
        ) : !exam ? (
          <Loading />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="font-display text-[26px] font-semibold leading-[1.1]">{exam.n}</div>
                  <StatusPill s={exam.st} />
                </div>
                <div className="mt-1 text-[13px] text-ink2">{exam.full || exam.code.toUpperCase()}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => apply(() => api.patch<Exam>(`/api/admin/exams/${exam.id}`, { status: exam.st === "Active" ? "Draft" : "Active" }), exam.st === "Active" ? "Hidden from students" : "Now visible to students")}>
                  {exam.st === "Active" ? "Move to draft" : "Make active"}
                </Button>
                <LinkButton size="sm" href={`/app/exam/${exam.id}`} target="_blank">Preview as student</LinkButton>
                <Button size="sm" variant={editing ? "secondary" : "primary"} onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit structure"}</Button>
              </div>
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))" }}>
              {exam.stats.map((x) => (
                <div key={x.l} className="rounded-xl border border-line bg-surface p-3.5">
                  <div className="font-display text-[22px] font-semibold leading-none" style={{ color: x.l.startsWith("Facts") && x.v ? "var(--warn-ink)" : undefined }}>{x.v}</div>
                  <div className="mt-1.5 text-xs text-ink2">{x.l}</div>
                </div>
              ))}
            </div>
            {editing ? (
              <StructureEditor exam={exam} apply={apply} />
            ) : (
              <Table cols={cols} minWidth={640} title="Units and resource mapping" right={<span className="text-xs text-ink2">Target: 2 resources per topic</span>} headers={["Subject", "Unit", "Topics", "With prereq", "Resources", "Coverage"]} empty={<>No units yet. <button className="border-0 bg-transparent p-0 font-semibold text-pri-ink" onClick={() => setEditing(true)}>Open the structure editor</button></>}>
                {units.map((u) => {
                  const cov = u.t ? Math.min(100, Math.round((100 * u.r) / (2 * u.t))) : 0;
                  return (
                    <Row key={u.id} cols={cols}>
                      <span className="text-ink2">{u.sub}</span>
                      <strong>{u.n}</strong>
                      <span>{u.t}</span>
                      <span>{u.p}</span>
                      <span>{u.r}</span>
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 rounded-[3px] bg-surface2"><span className="block h-full rounded-[3px] bg-teal" style={{ width: `${cov}%` }} /></span>
                        <span className="w-[34px] font-mono text-[11px] text-ink2">{cov}%</span>
                      </span>
                    </Row>
                  );
                })}
              </Table>
            )}
            <Table cols={fcols} minWidth={760} title="Verified facts" sub="Only Verified facts are shown to students without a warning" right={<Button size="xs" icon="add" onClick={() => setFact("new")}>Fact</Button>} headers={["Fact", "Value", "Source", "Verified", "Status", ""]} empty="No facts yet.">
              {exam.facts.map((f) => (
                <Row key={f.id} cols={fcols}>
                  <strong>{f.k}</strong>
                  <span className="whitespace-pre-line">{f.v || <span className="text-ink3">Not filled in</span>}</span>
                  <span className="min-w-0">
                    <span className="block">{f.src || "—"}</span>
                    {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-[11px]">{f.url}</a>}
                  </span>
                  <span className="font-mono text-xs text-ink2">{f.d || "—"}</span>
                  <span><StatusPill s={f.s} /></span>
                  <span className="flex justify-end gap-0.5">
                    {f.s !== "Verified" && f.src && (
                      <Button size="xs" onClick={() => apply(() => api.patch<Exam>(`/api/admin/exams/${exam.id}/facts/${f.id}`, { verify: true }), "Marked verified")}>Verify</Button>
                    )}
                    <IconBtn icon="edit" label="Edit" onClick={() => setFact(f)} />
                    <IconBtn icon="delete" label="Delete" onClick={() => setDelFact(f)} />
                  </span>
                </Row>
              ))}
            </Table>
          </>
        )}
      </div>

      <Modal open={newExam} onOpenChange={setNewExam} title="New exam" width={480} footer={
        <>
          <Button onClick={() => setNewExam(false)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            try {
              const r = await api.post<{ id: string }>("/api/admin/exams", nf);
              setNewExam(false);
              await list.mutate();
              setSel(r.id);
              setEditing(true);
              toast.success("Exam created as a draft");
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}>Create</Button>
        </>
      }>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Short name"><Input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="IPMAT" /></Field>
          <Field label="Code" hint="Lowercase, unique"><Input value={nf.code} onChange={(e) => setNf({ ...nf, code: e.target.value })} placeholder="ipmat" /></Field>
          <Field label="Full name" className="col-span-2"><Input value={nf.full_name} onChange={(e) => setNf({ ...nf, full_name: e.target.value })} placeholder="Integrated Programme in Management Aptitude Test" /></Field>
        </div>
      </Modal>
      {exam && <FactModal exam={exam} fact={fact} onClose={() => setFact(null)} apply={apply} />}
      <Confirm open={!!delFact} onOpenChange={(o) => !o && setDelFact(null)} title="Delete this fact?" danger confirmLabel="Delete" onConfirm={async () => {
        const f = delFact!;
        setDelFact(null);
        await apply(() => api.del<Exam>(`/api/admin/exams/${exam!.id}/facts/${f.id}`), "Deleted");
      }}>
        “{delFact?.k}”
      </Confirm>
    </div>
  );
}
