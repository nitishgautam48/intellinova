"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { FilterChips, Kicker, Panel, StageDots, StatCard, StatGrid, StatusPill, Table, Row, TopicSearch } from "@/components/admin/kit";
import { SourceViewer } from "@/components/tutor";
import { Alert, Button, Checkbox, Empty, ErrorState, Field, Icon, Input, Loading, Segmented, Select, Textarea } from "@/components/ui";
import { Confirm, Modal } from "@/components/ui/dialog";
import { api, qs, useApi } from "@/lib/api";

type Source = { id: string; t: string; type: string; icon: string; size: string; units: number | null; figs: number | null; low: number; s: string; stage: number; error: string; when: string; url: string | null };
type KB = { stats: { l: string; v: string; d: string; icon: string }[]; stages: string[]; sources: Source[]; pending_proposals: number };
type Proposal = {
  id: string; topic: string; summary: string; subtopics: string[]; chapter: string; chapter_id: string | null; new_chapter: boolean;
  subject: string | null; subject_id: string | null; units: number; source: string; when: string; samples: { loc: string; text: string }[];
};
type Unit = { id: string; ex: string; text: string; kind: string; src: string; icon: string; source_title: string; source_id: string; loc: string; topic: string | null; topic_id: string | null; subtopic: string; concepts: string[]; pre: string[]; pre_ids: string[]; conf: number; low: boolean; labels: string[]; image_url: string | null };
type Units = { counts: Record<string, number>; units: Unit[]; page: number };
type Structure = { id: string; label: string; chapters: { id: string; name: string }[] }[];

const COLS = "2.4fr 1fr .8fr 1.6fr .6fr .6fr 1fr 70px";
const KINDS = ["All", "Text", "Transcript", "Slide", "Diagram"] as const;

function confTone(c: number) {
  return c >= 85 ? ["var(--ok-soft)", "var(--ok-ink)"] : c >= 70 ? ["var(--warn-soft)", "var(--warn-ink)"] : ["var(--err-soft)", "var(--err-ink)"];
}

function AddSource({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { data: tree } = useApi<Structure>(open ? "/api/admin/structure" : null);
  const [kind, setKind] = useState<"textbook" | "slides" | "video">("textbook");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [subject, setSubject] = useState("");
  const [chapter, setChapter] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const chapters = tree?.find((s) => s.id === subject)?.chapters || [];
  const accept = { textbook: ".pdf", slides: ".pptx,.pdf", video: ".mp4,.webm,.mkv,.mov,.mp3,.m4a,.wav" }[kind];

  const submit = async () => {
    setErr("");
    const f = new FormData();
    f.set("kind", kind);
    f.set("title", title);
    f.set("subject_id", subject);
    f.set("chapter_id", chapter);
    if (kind === "video" && url.trim()) f.set("url", url.trim());
    else if (file) f.set("file", file);
    else return setErr(kind === "video" ? "Paste a YouTube link or choose a video file." : "Choose a file to upload.");
    setBusy(true);
    try {
      await api.upload("/api/admin/kb/sources", f);
      toast.success("Source added. Processing has started.");
      setTitle("");
      setUrl("");
      setFile(null);
      onOpenChange(false);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add source"
      sub="Lectures, textbooks and slides are transcribed, segmented and tagged to topics."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit} icon="upload">Add and process</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Segmented value={kind} onChange={(v) => (setKind(v), setFile(null))} options={[{ v: "textbook", l: "Textbook PDF" }, { v: "slides", l: "Slide deck" }, { v: "video", l: "Lecture video" }]} />
        <Field label="Title" hint="Optional. Defaults to the file or video name.">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. NCERT Science Class 10" />
        </Field>
        {kind === "video" && (
          <Field label="YouTube link" hint="A video or playlist. Captions are used when available, otherwise audio is transcribed.">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          </Field>
        )}
        {!(kind === "video" && url.trim()) && (
          <Field label={kind === "video" ? "…or upload a file" : "File"}>
            <label className="flex h-[88px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-line bg-bg text-[13px] text-ink2 hover:border-pri">
              <Icon name="upload_file" size={24} />
              {file ? <span className="font-semibold text-ink">{file.name}</span> : <span>Choose {accept.replaceAll(",", ", ")}</span>}
              <input type="file" accept={accept} className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Subject" hint="Narrows topic tagging">
            <Select value={subject} onChange={(e) => (setSubject(e.target.value), setChapter(""))}>
              <option value="">Any subject</option>
              {tree?.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Chapter">
            <Select value={chapter} onChange={(e) => setChapter(e.target.value)} disabled={!chapters.length}>
              <option value="">Any chapter</option>
              {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        {err && <Alert>{err}</Alert>}
      </div>
    </Modal>
  );
}

function UnitEditor({ u, onSaved }: { u: Unit; onSaved: (u: Unit) => void }) {
  const [edit, setEdit] = useState(false);
  const [topic, setTopic] = useState<{ id: string; name: string } | null>(null);
  const [concepts, setConcepts] = useState("");
  const [subtopic, setSubtopic] = useState("");
  const [pre, setPre] = useState<{ id: string; name: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState(false);

  useEffect(() => {
    setEdit(false);
    setTopic(u.topic_id ? { id: u.topic_id, name: u.topic || "Topic" } : null);
    setConcepts(u.concepts.join(", "));
    setSubtopic(u.subtopic || "");
    setPre(u.pre_ids.map((id, i) => ({ id, name: u.pre[i] || "Topic" })));
    setText(u.text);
  }, [u]);

  const save = async (approve: boolean) => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { approved: approve || !u.low };
      if (edit) {
        body.topic_id = topic?.id ?? null;
        body.concepts = concepts.split(",").map((c) => c.trim()).filter(Boolean);
        body.subtopic = subtopic;
        body.prereq_topic_ids = pre.map((p) => p.id);
        if (text.trim() && text !== u.text) body.text = text;
      }
      const out = await api.patch<Unit>(`/api/admin/kb/units/${u.id}`, body);
      toast.success(approve ? "Tags approved" : "Saved");
      setEdit(false);
      onSaved(out);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const [bg, fg] = confTone(u.conf);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-2">
        <Kicker>CONTENT UNIT · {u.kind.toUpperCase()}</Kicker>
        <span className="rounded-md px-[7px] py-[3px] font-mono text-[11px] font-semibold" style={{ background: bg, color: fg }}>
          {u.low ? `Tag confidence ${u.conf}%` : "Approved"}
        </span>
      </div>
      {u.kind === "Diagram" && (
        <>
          {u.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u.image_url} alt={u.ex} className="w-full rounded-xl border border-line bg-white object-contain" style={{ maxHeight: 260 }} />
          ) : (
            <div className="grid aspect-[4/3] place-items-center rounded-xl" style={{ background: "repeating-linear-gradient(135deg,var(--surface2) 0 10px,var(--stripe) 10px 20px)" }}>
              <span className="font-mono text-[11px] text-ink3">figure</span>
            </div>
          )}
          {!!u.labels.length && (
            <>
              <Kicker className="text-teal-ink">READ FROM THE IMAGE</Kicker>
              <div className="flex flex-wrap gap-1.5">
                {u.labels.map((l) => <span key={l} className="rounded-md bg-teal-soft px-2 py-[3px] text-xs font-semibold text-teal-ink">{l}</span>)}
              </div>
            </>
          )}
        </>
      )}
      {edit ? (
        <Field label="Text"><Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      ) : (
        <div className="max-h-[220px] overflow-auto whitespace-pre-wrap text-sm leading-[1.55]">{u.text}</div>
      )}
      <div className="flex items-center gap-2.5 rounded-[10px] bg-bg px-3 py-2.5">
        <Icon name={u.icon} className="text-pri" />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-ink2">Origin</div>
          <div className="truncate text-[13px] font-semibold">{u.source_title} · <span className="font-mono">{u.loc}</span></div>
        </div>
        <Button size="xs" onClick={() => setViewer(true)}>Open</Button>
      </div>
      <div>
        <div className="mb-1.5 text-xs font-bold text-ink2">Topic</div>
        {topic ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-pri-soft px-2.5 py-1 text-xs font-semibold text-pri-ink">
            {topic.name}
            {edit && <button onClick={() => setTopic(null)} className="grid border-0 bg-transparent p-0 text-inherit" aria-label="Clear topic"><Icon name="close" size={14} /></button>}
          </span>
        ) : (
          <span className="text-xs text-ink2">Not tagged</span>
        )}
        {edit && <div className="mt-2"><TopicSearch onPick={(t) => setTopic({ id: t.id, name: t.name })} placeholder="Change topic…" /></div>}
      </div>
      <div>
        <div className="mb-1.5 text-xs font-bold text-ink2">Subtopic</div>
        {edit ? (
          <Input value={subtopic} onChange={(e) => setSubtopic(e.target.value)} placeholder="e.g. Series combination formula" />
        ) : u.subtopic ? (
          <span className="rounded-lg bg-surface2 px-2.5 py-1 text-xs font-semibold">{u.subtopic}</span>
        ) : (
          <span className="text-xs text-ink2">None</span>
        )}
      </div>
      <div>
        <div className="mb-1.5 text-xs font-bold text-ink2">Key concepts</div>
        {edit ? (
          <Input value={concepts} onChange={(e) => setConcepts(e.target.value)} placeholder="Comma-separated" />
        ) : u.concepts.length ? (
          <div className="flex flex-wrap gap-1.5">{u.concepts.map((x) => <span key={x} className="rounded-lg bg-surface2 px-2.5 py-1 text-xs font-semibold">{x}</span>)}</div>
        ) : (
          <span className="text-xs text-ink2">None</span>
        )}
      </div>
      <div>
        <div className="mb-1.5 text-xs font-bold text-ink2">Prerequisites</div>
        <div className="flex flex-wrap gap-1.5">
          {pre.map((x) => (
            <span key={x.id} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold">
              <Icon name="subdirectory_arrow_right" size={14} />
              {x.name}
              {edit && <button onClick={() => setPre(pre.filter((p) => p.id !== x.id))} className="grid border-0 bg-transparent p-0 text-ink2" aria-label="Remove"><Icon name="close" size={14} /></button>}
            </span>
          ))}
          {!pre.length && <span className="text-xs text-ink2">None</span>}
        </div>
        {edit && <div className="mt-2"><TopicSearch onPick={(t) => setPre([...pre, { id: t.id, name: t.name }])} exclude={[...pre.map((p) => p.id), topic?.id || ""]} placeholder="Add a prerequisite topic…" /></div>}
      </div>
      <div className="flex gap-2">
        {u.low || edit ? (
          <Button variant="primary" className="flex-1" loading={busy} onClick={() => save(true)}>{edit ? "Save and approve" : "Approve tags"}</Button>
        ) : (
          <div className="flex flex-1 items-center gap-1.5 text-[13px] text-ok-ink"><Icon name="check_circle" size={18} /> Approved</div>
        )}
        {edit ? <Button onClick={() => setEdit(false)}>Cancel</Button> : <Button icon="edit" onClick={() => setEdit(true)}>Edit</Button>}
      </div>
      <Modal open={viewer} onOpenChange={setViewer} title="Source" width={560}>
        <SourceViewer unitId={viewer ? u.id : null} n={null} />
      </Modal>
    </div>
  );
}

/** Topics found in uploaded material that the curriculum doesn't have yet. */
function Suggestions({ onChanged }: { onChanged: () => void }) {
  const { data, mutate } = useApi<Proposal[]>("/api/admin/kb/proposals");
  const { data: tree } = useApi<Structure>("/api/admin/structure");
  const [acc, setAcc] = useState<Proposal | null>(null);
  const [f, setF] = useState({ subject_id: "", chapter_id: "", chapter_name: "", topic_name: "" });
  const [busy, setBusy] = useState(false);
  const open = (p: Proposal) => {
    setF({ subject_id: p.subject_id || "", chapter_id: p.new_chapter ? "" : p.chapter_id || "", chapter_name: p.new_chapter ? p.chapter : "", topic_name: p.topic });
    setAcc(p);
  };
  const done = () => (mutate(), onChanged());
  const accept = async () => {
    if (!acc) return;
    setBusy(true);
    try {
      await api.post(`/api/admin/kb/proposals/${acc.id}/accept`, {
        subject_id: f.subject_id || null, chapter_id: f.chapter_id || null, chapter_name: f.chapter_id ? "" : f.chapter_name, topic_name: f.topic_name,
      });
      toast.success("Topic added to the curriculum as a draft. Publish it in Curriculum when ready.");
      setAcc(null);
      done();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reject = async (p: Proposal) => {
    try {
      await api.post(`/api/admin/kb/proposals/${p.id}/reject`);
      done();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (!data?.length) return null;
  const chapters = tree?.find((s) => s.id === f.subject_id)?.chapters || [];
  return (
    <Panel title={<span className="flex items-center gap-2"><Icon name="auto_awesome" size={18} className="text-pri" />Suggested topics from your sources</span>}
      sub="This material didn't match any topic in the curriculum, so IntelliNova grouped it into topics and subtopics. Accept to add them as drafts.">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
        {data.map((p) => (
          <div key={p.id} className="flex flex-col gap-2 rounded-xl border border-line bg-bg p-3.5">
            <div className="text-xs text-ink2">{p.new_chapter ? "New chapter" : "Chapter"}: <strong className="text-ink">{p.chapter}</strong>{p.subject ? ` · ${p.subject}` : ""}</div>
            <div className="font-display text-[16px] font-semibold leading-tight">{p.topic}</div>
            {p.summary && <div className="text-[13px] text-ink2">{p.summary}</div>}
            {!!p.subtopics.length && (
              <div className="flex flex-wrap gap-1.5">{p.subtopics.map((x) => <span key={x} className="rounded-md bg-surface2 px-2 py-0.5 text-[11px] font-semibold">{x}</span>)}</div>
            )}
            <div className="text-xs text-ink3">{p.units} content units from “{p.source}” · {p.when}</div>
            {p.samples.slice(0, 2).map((x) => (
              <div key={x.loc + x.text} className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink2"><span className="font-mono text-ink3">{x.loc}</span> {x.text}</div>
            ))}
            <div className="mt-auto flex gap-2 pt-1">
              <Button size="xs" variant="primary" icon="check" onClick={() => open(p)}>Accept</Button>
              <Button size="xs" variant="ghost" onClick={() => reject(p)}>Dismiss</Button>
            </div>
          </div>
        ))}
      </div>
      <Modal open={!!acc} onOpenChange={(o) => !o && setAcc(null)} title="Add this topic" sub="It's created as a draft with its subtopics, and the content units are tagged to it." width={520}
        footer={<><Button onClick={() => setAcc(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={accept}>Add topic</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Topic name"><Input value={f.topic_name} onChange={(e) => setF({ ...f, topic_name: e.target.value })} /></Field>
          <Field label="Subject">
            <Select value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value, chapter_id: "" })}>
              <option value="">Choose…</option>
              {tree?.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Chapter">
            <Select value={f.chapter_id} onChange={(e) => setF({ ...f, chapter_id: e.target.value })}>
              <option value="">New chapter…</option>
              {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          {!f.chapter_id && <Field label="New chapter name"><Input value={f.chapter_name} onChange={(e) => setF({ ...f, chapter_name: e.target.value })} /></Field>}
        </div>
      </Modal>
    </Panel>
  );
}

export default function KnowledgeBase() {
  const { data, error, mutate } = useApi<KB>("/api/admin/kb", {
    refreshInterval: (d) => (d?.sources.some((s) => s.s === "Processing") ? 3000 : 0),
  });
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("All");
  const [lowOnly, setLowOnly] = useState(false);
  const [source, setSource] = useState<string>("");
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [delSrc, setDelSrc] = useState<Source | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQDeb(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const unitsKey = `/api/admin/kb/units${qs({ kind, low: lowOnly || null, source_id: source || null, q: qDeb })}`;
  const units = useApi<Units>(unitsKey);
  const selected = useMemo(() => units.data?.units.find((u) => u.id === sel) || units.data?.units[0] || null, [units.data, sel]);
  // Reload units whenever a source finishes (or changes) processing.
  const srcSig = data?.sources.map((s) => `${s.id}:${s.s}:${s.units ?? ""}:${s.low}`).join("|");
  const reloadUnits = units.mutate;
  useEffect(() => {
    if (srcSig !== undefined) reloadUnits();
  }, [srcSig, reloadUnits]);

  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.success(msg);
      mutate();
      units.mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const srcName = data.sources.find((s) => s.id === source)?.t;

  return (
    <div className="flex flex-col gap-4">
      <StatGrid>{data.stats.map((x) => <StatCard key={x.l} {...x} />)}</StatGrid>
      {data.pending_proposals > 0 && <Suggestions onChanged={() => (mutate(), units.mutate())} />}

      <Table
        cols={COLS}
        minWidth={900}
        title="Sources"
        sub="Upload lectures, textbooks or slides. IntelliNova transcribes them, reads the diagrams and sorts everything into topics."
        right={<Button variant="primary" size="sm" icon="upload" onClick={() => setAdding(true)}>Add source</Button>}
        headers={["Source", "Type", "Size", "Pipeline", "Units", "Figures", "Status", ""]}
        empty={<Empty icon="folder_open" title="No sources yet" className="border-0">Add a textbook PDF, slide deck or lecture video to build the tutor&apos;s knowledge base.</Empty>}
      >
        {data.sources.map((k) => (
          <Row key={k.id} cols={COLS}>
            <button onClick={() => setSource(source === k.id ? "" : k.id)} className="flex min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left" title="Show this source's units">
              <Icon name={k.icon} size={18} className="text-ink2" />
              <span className="min-w-0">
                <strong className="block truncate">{k.t}</strong>
                {k.s === "Failed" && k.error && <span className="block truncate text-[11px] text-err-ink">{k.error}</span>}
              </span>
            </button>
            <span>{k.type}</span>
            <span className="text-ink2">{k.size}</span>
            <span title={k.s === "Processing" ? data.stages[k.stage] : undefined}><StageDots stages={data.stages} stage={k.stage} status={k.s} /></span>
            <span className="font-mono">{k.units ?? "—"}</span>
            <span className="font-mono">{k.figs ?? "—"}</span>
            <span><StatusPill s={k.s} /></span>
            <span className="flex justify-end gap-0.5">
              <button title="Reprocess" onClick={() => act(() => api.post(`/api/admin/kb/sources/${k.id}/reprocess`), "Reprocessing")} disabled={k.s === "Processing"} className="grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-ink2 hover:bg-surface2 disabled:opacity-40">
                <Icon name="refresh" size={17} />
              </button>
              <button title="Delete" onClick={() => setDelSrc(k)} className="grid h-7 w-7 place-items-center rounded-[7px] border-0 bg-transparent text-ink2 hover:bg-surface2">
                <Icon name="delete" size={17} />
              </button>
            </span>
          </Row>
        ))}
        {data.sources.length > 0 && (
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 border-t border-line px-4 py-2.5 font-mono text-[11px] font-medium text-ink3">
            PIPELINE:{data.stages.map((g, i) => <span key={g}>{i + 1} {g}</span>)}
          </div>
        )}
      </Table>

      <div className="flex flex-wrap items-start gap-4">
        <Panel pad={false} className="min-w-0 flex-[2_1_520px] overflow-hidden" title={srcName ? `Content units · ${srcName}` : "Content units"} right={<FilterChips size="sm" value={kind} onChange={setKind} options={KINDS.map((k) => ({ v: k, n: units.data?.counts[k] ?? 0 }))} />}>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5">
            <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-[9px] border border-line bg-bg px-3">
              <Icon name="search" size={18} className="text-ink3" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search unit text" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none" />
            </label>
            <Checkbox checked={lowOnly} onChange={setLowOnly}>Needs review only</Checkbox>
            {source && <Button size="xs" variant="ghost" icon="close" onClick={() => setSource("")}>All sources</Button>}
          </div>
          {units.error ? (
            <div className="p-4"><ErrorState error={units.error} retry={() => units.mutate()} /></div>
          ) : !units.data ? (
            <Loading />
          ) : units.data.units.length ? (
            units.data.units.map((u) => {
              const [bg, fg] = confTone(u.conf);
              return (
                <button key={u.id} onClick={() => setSel(u.id)} className="flex w-full items-center gap-3 border-0 border-t border-line px-4 py-[11px] text-left hover:bg-bg" style={{ background: selected?.id === u.id ? "var(--pri-soft)" : undefined }}>
                  <Icon name={u.icon} className="text-ink2" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{u.ex}</div>
                    <div className="truncate text-xs text-ink2">{u.kind} · <span className="font-mono">{u.loc}</span> · {u.topic || "Untagged"}{u.subtopic ? ` › ${u.subtopic}` : ""}</div>
                  </div>
                  <span className="rounded-md px-[7px] py-[3px] font-mono text-[11px] font-semibold" style={{ background: bg, color: fg }}>{u.low ? `${u.conf}%` : "OK"}</span>
                </button>
              );
            })
          ) : (
            <div className="border-t border-line px-4 py-8 text-center text-[13px] text-ink2">No content units match.</div>
          )}
        </Panel>
        <Panel className="flex-[1_1_320px]">
          {selected ? (
            <UnitEditor u={selected} onSaved={() => (units.mutate(), mutate())} />
          ) : (
            <div className="text-[13px] text-ink2">Select a content unit to review its topic tags.</div>
          )}
        </Panel>
      </div>

      <AddSource open={adding} onOpenChange={setAdding} onDone={() => mutate()} />
      <Confirm
        open={!!delSrc}
        onOpenChange={(v) => !v && setDelSrc(null)}
        title="Delete this source?"
        danger
        confirmLabel="Delete"
        onConfirm={() => {
          const s = delSrc!;
          setDelSrc(null);
          act(() => api.del(`/api/admin/kb/sources/${s.id}`), "Source deleted");
        }}
      >
        “{delSrc?.t}” and all {delSrc?.units ?? 0} of its content units will be removed. The tutor will no longer cite it.
      </Confirm>
    </div>
  );
}
