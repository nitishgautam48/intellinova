"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Kicker, Panel, StatusPill, TopicSearch } from "@/components/admin/kit";
import { FlowMap, type FlowMapT } from "@/components/flow-map";
import { Button, Empty, ErrorState, Field, Icon, Input, Loading, Pill, Select, Textarea } from "@/components/ui";
import { Confirm, Modal } from "@/components/ui/dialog";
import { api, useApi } from "@/lib/api";

type SubjectRow = { id: string; board: string; class_level: string; stream: string | null; name: string; version: number; draft: boolean; chapters: number };
type TopicT = { id: string; n: number; name: string; slug: string; est: number; summary: string; published: boolean; res: number; pre: { id: string; name: string }[]; subtopics: string[] };
type ChapterT = { id: string; n: string; name: string; disabled: boolean; published: boolean; topics: TopicT[] };
type Tree = { id: string; board: string; class_level: string; stream: string | null; name: string; version: number; draft: boolean; chapters: ChapterT[]; versions: { v: string; l: string; m: string; tone: string }[] };

const uniq = <T,>(a: T[]) => [...new Set(a)];

function move<T>(arr: T[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return null;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function IconBtn({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className="grid h-7 w-7 flex-none place-items-center rounded-[7px] border-0 bg-transparent text-ink2 hover:bg-surface2 disabled:opacity-30">
      <Icon name={icon} size={17} />
    </button>
  );
}

function NameModal({ open, title, label, initial = "", onClose, onSave, extra }: { open: boolean; title: string; label: string; initial?: string; onClose: () => void; onSave: (v: string) => Promise<void>; extra?: React.ReactNode }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setV(initial);
  }, [initial, open]);
  const save = async () => {
    if (v.trim().length < 2) return toast.error("Enter at least 2 characters.");
    setBusy(true);
    try {
      await onSave(v.trim());
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={title} width={440} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <form onSubmit={(e) => (e.preventDefault(), save())} className="flex flex-col gap-3">
        <Field label={label}><Input autoFocus value={v} onChange={(e) => setV(e.target.value)} /></Field>
        {extra}
      </form>
    </Modal>
  );
}

function NewSubject({ open, onClose, onCreated, defaults }: { open: boolean; onClose: () => void; onCreated: (id: string) => void; defaults: { board: string; class_level: string } }) {
  const [f, setF] = useState({ board: "", class_level: "", stream: "", name: "", icon: "menu_book" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ board: defaults.board || "CBSE", class_level: defaults.class_level || "Class 10", stream: "", name: "", icon: "menu_book" });
  }, [open, defaults.board, defaults.class_level]);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: string }>("/api/admin/curriculum/subjects", { ...f, stream: f.stream || null });
      toast.success("Subject created");
      onCreated(r.id);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="New subject" width={480} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Create</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Board"><Input value={f.board} onChange={(e) => setF({ ...f, board: e.target.value })} placeholder="CBSE" /></Field>
        <Field label="Class"><Input value={f.class_level} onChange={(e) => setF({ ...f, class_level: e.target.value })} placeholder="Class 10" /></Field>
        <Field label="Stream" hint="Optional, for classes 11–12"><Input value={f.stream} onChange={(e) => setF({ ...f, stream: e.target.value })} placeholder="Science" /></Field>
        <Field label="Icon" hint="Material Symbols name"><Input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} /></Field>
        <Field label="Subject name" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Science" /></Field>
      </div>
    </Modal>
  );
}

function TopicEditor({ t, chapterName, onSaved, onDelete, onRefresh }: { t: TopicT; chapterName: string; onSaved: (tree: Tree) => void; onDelete: () => void; onRefresh: () => void }) {
  const [finding, setFinding] = useState(false);
  const findVideos = async () => {
    setFinding(true);
    try {
      const d = await api.post<{ status: string; added: number }>(`/api/admin/curriculum/topics/${t.id}/discover`);
      if (d.status === "done") toast.success(d.added ? `Added ${d.added} video${d.added === 1 ? "" : "s"} from YouTube` : "No new videos passed the syllabus check");
      else if (d.status === "failed") toast.error("The YouTube search failed. See Resources › Search log for details.");
      else toast.success("Searching YouTube. New videos will appear in Resources shortly.");
      onRefresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFinding(false);
    }
  };
  const [f, setF] = useState({ name: t.name, slug: t.slug, est: t.est, summary: t.summary });
  const [pre, setPre] = useState(t.pre);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF({ name: t.name, slug: t.slug, est: t.est, summary: t.summary });
    setPre(t.pre);
  }, [t]);
  const dirty = f.name !== t.name || f.slug !== t.slug || f.est !== t.est || f.summary !== t.summary || pre.map((p) => p.id).join() !== t.pre.map((p) => p.id).join();
  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: f.name, est_minutes: Number(f.est) || 15, summary: f.summary, prereq_ids: pre.map((p) => p.id) };
      if (f.slug !== t.slug) body.slug = f.slug;
      onSaved(await api.patch<Tree>(`/api/admin/curriculum/topics/${t.id}`, body));
      toast.success("Topic saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <Kicker>EDIT TOPIC</Kicker>
        {!t.published && <Pill className="text-[11px]">Draft</Pill>}
      </div>
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "minmax(0,1fr) 90px" }}>
        <Field label="Slug"><Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} className="font-mono text-xs text-ink2" /></Field>
        <Field label="Minutes"><Input type="number" min={1} max={600} value={f.est} onChange={(e) => setF({ ...f, est: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Summary" hint="Shown to students and used to tag content."><Textarea rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
      <div className="flex flex-col gap-1.5">
        <div className="text-[13px] font-semibold">Subtopics</div>
        {t.subtopics.length ? (
          <div className="flex flex-wrap gap-1.5">{t.subtopics.map((x) => <span key={x} className="rounded-md bg-surface2 px-2 py-0.5 text-xs font-semibold">{x}</span>)}</div>
        ) : (
          <span className="text-xs text-ink2">Found automatically once material tagged to this topic is uploaded in Knowledge base.</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-semibold">Prerequisites</div>
        <div className="flex flex-wrap gap-1.5">
          {pre.map((p) => (
            <span key={p.id} className="flex items-center gap-1 rounded-full bg-pri-soft py-1 pl-2.5 pr-1.5 text-xs font-semibold text-pri-ink">
              {p.name}
              <button onClick={() => setPre(pre.filter((x) => x.id !== p.id))} className="grid border-0 bg-transparent p-0 text-inherit" aria-label={`Remove ${p.name}`}><Icon name="close" size={14} /></button>
            </span>
          ))}
          {!pre.length && <span className="text-xs text-ink2">None. This topic can be studied first.</span>}
        </div>
        <TopicSearch exclude={[t.id, ...pre.map((p) => p.id)]} onPick={(h) => setPre([...pre, { id: h.id, name: h.chapter !== chapterName ? `${h.chapter} › ${h.name}` : h.name }])} placeholder="+ Add a prerequisite…" />
      </div>
      <div className="flex items-center justify-between border-t border-line pt-2.5 text-[13px]">
        <span className="flex items-center gap-1.5"><Icon name="video_library" size={18} className="text-ink2" />{t.res} mapped resource{t.res === 1 ? "" : "s"}</span>
        <Link href={`/admin/resources?q=${encodeURIComponent(t.name)}`}>View in Resources</Link>
      </div>
      <Button size="sm" icon="travel_explore" loading={finding} onClick={findVideos} title="Search YouTube for videos that teach this topic, check them against the syllabus and add the best">
        Find videos on YouTube
      </Button>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" disabled={!dirty} loading={busy} onClick={save}>Save topic</Button>
        {!t.published && <Button variant="danger" icon="delete" onClick={onDelete}>Delete</Button>}
      </div>
    </div>
  );
}

export default function Curriculum() {
  const subjects = useApi<SubjectRow[]>("/api/admin/curriculum/subjects");
  const { data: suggestions } = useApi<{ id: string }[]>("/api/admin/kb/proposals");
  const [sid, setSid] = useState<string | null>(null);
  const [tree, setTree] = useState<Tree | null>(null);
  const [treeErr, setTreeErr] = useState<unknown>(null);
  const [chId, setChId] = useState<string | null>(null);
  const [tId, setTId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "subject" | "chapter" | "topic" | "rename" | "publish" | "map">(null);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<null | { title: string; body: string; run: () => Promise<Tree | void> }>(null);

  const flow = useApi<FlowMapT>(modal === "map" && sid ? `/api/admin/curriculum/subjects/${sid}/map` : null);
  const rows = useMemo(() => subjects.data || [], [subjects.data]);
  const cur = rows.find((s) => s.id === sid) || null;
  const [board, setBoard] = useState("");
  const [cls, setCls] = useState("");

  useEffect(() => {
    if (!rows.length || sid) return;
    const first = rows[0];
    setSid(first.id);
    setBoard(first.board);
    setCls(first.class_level);
  }, [rows, sid]);

  // Keep the board and class pickers in step with the selected subject (e.g. after creating one).
  useEffect(() => {
    if (!cur) return;
    setBoard(cur.board);
    setCls(cur.class_level);
  }, [cur]);

  useEffect(() => {
    if (!sid) return;
    setTreeErr(null);
    api.get<Tree>(`/api/admin/curriculum/subjects/${sid}`).then(setTree).catch(setTreeErr);
  }, [sid]);

  const apply = (t: Tree | void) => {
    if (t) setTree(t);
    subjects.mutate();
  };
  const run = async (fn: () => Promise<Tree | void>, msg?: string) => {
    try {
      apply(await fn());
      if (msg) toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (subjects.error) return <ErrorState error={subjects.error} retry={() => subjects.mutate()} />;
  if (!subjects.data) return <Loading />;

  const boards = uniq(rows.map((s) => s.board));
  const classes = uniq(rows.filter((s) => s.board === board).map((s) => s.class_level));
  const subs = rows.filter((s) => s.board === board && s.class_level === cls);
  const chapter = tree?.chapters.find((c) => c.id === chId) || tree?.chapters[0] || null;
  const topic = chapter?.topics.find((t) => t.id === tId) || chapter?.topics[0] || null;

  const pickSubject = (id: string) => {
    setSid(id);
    setChId(null);
    setTId(null);
    setTree(null);
  };

  if (!rows.length) {
    return (
      <>
        <Empty icon="account_tree" title="No curriculum yet" action={<Button variant="primary" icon="add" onClick={() => setModal("subject")}>Add a subject</Button>}>
          Build the Board › Class › Subject › Chapter › Topic tree that students learn from. Everything else (resources, tutor tags, quizzes) hangs off topics.
        </Empty>
        <NewSubject open={modal === "subject"} onClose={() => setModal(null)} defaults={{ board: "", class_level: "" }} onCreated={(id) => (subjects.mutate(), pickSubject(id))} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Select aria-label="Board" value={board} className="h-9 w-auto" onChange={(e) => {
            const b = e.target.value;
            setBoard(b);
            const s = rows.find((x) => x.board === b);
            if (s) (setCls(s.class_level), pickSubject(s.id));
          }}>
            {boards.map((b) => <option key={b}>{b}</option>)}
          </Select>
          <Select aria-label="Class" value={cls} className="h-9 w-auto" onChange={(e) => {
            const c = e.target.value;
            setCls(c);
            const s = rows.find((x) => x.board === board && x.class_level === c);
            if (s) pickSubject(s.id);
          }}>
            {classes.map((c) => <option key={c} value={c}>{/^\d+$/.test(c) ? `Class ${c}` : c}</option>)}
          </Select>
          <Select aria-label="Subject" value={sid || ""} className="h-9 w-auto" onChange={(e) => pickSubject(e.target.value)}>
            {subs.map((s) => <option key={s.id} value={s.id}>{s.stream ? `${s.stream} · ` : ""}{s.name}</option>)}
          </Select>
          <Button size="sm" variant="ghost" icon="add" onClick={() => setModal("subject")}>Subject</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cur?.draft && <Pill tone="warn">Unpublished changes</Pill>}
          <Button size="sm" variant="ghost" icon="schema" onClick={() => (flow.mutate(), setModal("map"))} disabled={!tree}>Flow map</Button>
          <Button size="sm" icon="add" onClick={() => setModal("chapter")} disabled={!tree}>Chapter</Button>
          <Button size="sm" variant={cur?.draft ? "primary" : "secondary"} icon="publish" disabled={!cur?.draft} onClick={() => (setNote(""), setModal("publish"))}>
            {cur?.draft ? `Publish v${(cur?.version || 0) + 1}` : `Published v${cur?.version || 0}`}
          </Button>
        </div>
      </div>
      <div className="font-mono text-xs font-medium text-ink3">Board › Class › Stream › Subject › Chapter › Topic › Subtopic</div>
      {!!suggestions?.length && (
        <Link href="/admin/kb" className="flex items-center gap-2.5 rounded-xl bg-pri-soft px-4 py-3 text-[13px] font-semibold text-pri-ink hover:no-underline">
          <Icon name="auto_awesome" size={18} />
          {suggestions.length} topic{suggestions.length === 1 ? " was" : "s were"} found in your uploaded material but aren&apos;t in the curriculum yet. Review in Knowledge base
          <Icon name="arrow_forward" size={16} />
        </Link>
      )}

      {treeErr ? (
        <ErrorState error={treeErr} retry={() => sid && api.get<Tree>(`/api/admin/curriculum/subjects/${sid}`).then(setTree).catch(setTreeErr)} />
      ) : !tree ? (
        <Loading />
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          <Panel pad={false} className="flex-[1.3_1_340px] overflow-hidden" title="Chapters" right={<span className="text-xs text-ink2">Order is what students see</span>}>
            {tree.chapters.length ? (
              tree.chapters.map((c, i) => {
                const on = chapter?.id === c.id;
                return (
                  <div key={c.id} className="flex items-center gap-1.5 border-t border-line py-1.5 pl-2.5 pr-2" style={{ background: on ? "var(--pri-soft)" : undefined, boxShadow: on ? "inset 3px 0 0 var(--pri)" : undefined }}>
                    <button onClick={() => (setChId(c.id), setTId(null))} className="flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent py-1.5 text-left" style={{ opacity: c.disabled ? 0.5 : 1 }}>
                      <span className="font-mono text-xs text-ink3">{c.n}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{c.name}</span>
                      <span className="text-xs text-ink2">{c.topics.length}</span>
                    </button>
                    <StatusPill s={c.disabled ? "Disabled" : c.published ? "Published" : "Draft"} />
                    <IconBtn icon="arrow_upward" label="Move up" disabled={i === 0} onClick={() => {
                      const ids = move(tree.chapters.map((x) => x.id), i, -1);
                      if (ids) run(() => api.post<Tree>(`/api/admin/curriculum/subjects/${tree.id}/reorder`, { ids }));
                    }} />
                    <IconBtn icon="arrow_downward" label="Move down" disabled={i === tree.chapters.length - 1} onClick={() => {
                      const ids = move(tree.chapters.map((x) => x.id), i, 1);
                      if (ids) run(() => api.post<Tree>(`/api/admin/curriculum/subjects/${tree.id}/reorder`, { ids }));
                    }} />
                    <IconBtn icon={c.disabled ? "visibility_off" : "visibility"} label={c.disabled ? "Show to students" : "Hide from students"} onClick={() => run(() => api.patch<Tree>(`/api/admin/curriculum/chapters/${c.id}`, { disabled: !c.disabled }), c.disabled ? "Chapter visible" : "Chapter hidden")} />
                  </div>
                );
              })
            ) : (
              <div className="border-t border-line px-4 py-8 text-center text-[13px] text-ink2">No chapters yet. Add the first one.</div>
            )}
          </Panel>

          <Panel pad={false} className="flex-[1_1_280px] overflow-hidden">
            {chapter ? (
              <>
                <div className="flex items-center justify-between gap-2 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="truncate font-display text-[15px] font-semibold">{chapter.name}</div>
                    <div className="text-xs text-ink2">{chapter.topics.length} topic{chapter.topics.length === 1 ? "" : "s"}</div>
                  </div>
                  <div className="flex flex-none items-center gap-1">
                    <IconBtn icon="edit" label="Rename chapter" onClick={() => setModal("rename")} />
                    {!chapter.published && (
                      <IconBtn icon="delete" label="Delete chapter" onClick={() => setConfirm({ title: "Delete this chapter?", body: `“${chapter.name}” and its ${chapter.topics.length} draft topics will be removed.`, run: () => api.del<Tree>(`/api/admin/curriculum/chapters/${chapter.id}`) })} />
                    )}
                    <Button size="xs" onClick={() => setModal("topic")}>+ Topic</Button>
                  </div>
                </div>
                {chapter.topics.map((t, i) => {
                  const on = topic?.id === t.id;
                  return (
                    <div key={t.id} className="flex items-center gap-1 border-t border-line pr-2" style={{ background: on ? "var(--pri-soft)" : undefined }}>
                      <button onClick={() => setTId(t.id)} className="flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent py-2.5 pl-4 text-left">
                        <span className="w-[18px] font-mono text-xs text-ink3">{t.n}</span>
                        <span className="min-w-0 flex-1 truncate text-[13px]" style={{ fontWeight: on ? 700 : 500 }}>{t.name}</span>
                        <span title="Prerequisites" className="flex items-center gap-0.5 text-[11px] text-ink2"><Icon name="subdirectory_arrow_right" size={14} />{t.pre.length}</span>
                        <span title="Mapped resources" className="flex items-center gap-0.5 text-[11px] text-ink2"><Icon name="video_library" size={14} />{t.res}</span>
                      </button>
                      <IconBtn icon="arrow_upward" label="Move up" disabled={i === 0} onClick={() => {
                        const ids = move(chapter.topics.map((x) => x.id), i, -1);
                        if (ids) run(() => api.post<Tree>(`/api/admin/curriculum/chapters/${chapter.id}/reorder`, { ids }));
                      }} />
                      <IconBtn icon="arrow_downward" label="Move down" disabled={i === chapter.topics.length - 1} onClick={() => {
                        const ids = move(chapter.topics.map((x) => x.id), i, 1);
                        if (ids) run(() => api.post<Tree>(`/api/admin/curriculum/chapters/${chapter.id}/reorder`, { ids }));
                      }} />
                    </div>
                  );
                })}
                {!chapter.topics.length && <div className="border-t border-line px-4 py-8 text-center text-[13px] text-ink2">No topics in this chapter yet.</div>}
              </>
            ) : (
              <div className="px-4 py-8 text-center text-[13px] text-ink2">Select a chapter.</div>
            )}
          </Panel>

          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
            <Panel>
              {topic && chapter ? (
                <TopicEditor
                  key={topic.id}
                  t={topic}
                  chapterName={chapter.name}
                  onSaved={apply}
                  onRefresh={() => api.get<Tree>(`/api/admin/curriculum/subjects/${tree.id}`).then(setTree).catch(() => {})}
                  onDelete={() => setConfirm({ title: "Delete this topic?", body: `“${topic.name}” is still a draft, so no student progress is lost.`, run: () => api.del<Tree>(`/api/admin/curriculum/topics/${topic.id}`) })}
                />
              ) : (
                <div className="text-[13px] text-ink2">Select a topic to edit its name, summary and prerequisites.</div>
              )}
            </Panel>
            <Panel>
              <Kicker className="mb-2">VERSION HISTORY · {tree.name.toUpperCase()}</Kicker>
              {tree.versions.length ? (
                tree.versions.map((v) => (
                  <div key={v.v + v.l} className="flex items-center gap-2.5 border-t border-line py-[9px]">
                    <span className="w-8 font-mono text-[13px] font-semibold">{v.v}</span>
                    <div className="min-w-0 flex-1 text-xs text-ink2">{v.m}</div>
                    <StatusPill s={v.l} />
                  </div>
                ))
              ) : (
                <div className="border-t border-line py-3 text-xs text-ink2">Nothing published yet.</div>
              )}
            </Panel>
          </div>
        </div>
      )}

      <NewSubject open={modal === "subject"} onClose={() => setModal(null)} defaults={{ board, class_level: cls }} onCreated={(id) => {
        subjects.mutate().then((list) => {
          const s = list?.find((x) => x.id === id);
          if (s) (setBoard(s.board), setCls(s.class_level));
        });
        pickSubject(id);
      }} />
      <NameModal open={modal === "chapter"} title="Add chapter" label="Chapter name" onClose={() => setModal(null)} onSave={async (name) => {
        const t = await api.post<Tree>(`/api/admin/curriculum/subjects/${tree!.id}/chapters`, { name });
        apply(t);
        setChId(t.chapters[t.chapters.length - 1]?.id || null);
      }} />
      <NameModal open={modal === "rename"} title="Rename chapter" label="Chapter name" initial={chapter?.name} onClose={() => setModal(null)} onSave={async (name) => apply(await api.patch<Tree>(`/api/admin/curriculum/chapters/${chapter!.id}`, { name }))} />
      <NameModal open={modal === "topic"} title={`Add topic to ${chapter?.name || "chapter"}`} label="Topic name" onClose={() => setModal(null)} onSave={async (name) => {
        const t = await api.post<Tree>(`/api/admin/curriculum/chapters/${chapter!.id}/topics`, { name });
        apply(t);
        const ch = t.chapters.find((c) => c.id === chapter!.id);
        setTId(ch?.topics[ch.topics.length - 1]?.id || null);
      }} />
      <Modal open={modal === "publish"} onOpenChange={(o) => !o && setModal(null)} title={`Publish ${tree?.name || ""} v${(cur?.version || 0) + 1}`} sub="Students see the new chapter order, topics and prerequisites immediately. The previous version is archived." width={480} footer={
        <>
          <Button onClick={() => setModal(null)}>Cancel</Button>
          <Button variant="primary" icon="publish" onClick={async () => {
            setModal(null);
            await run(() => api.post<Tree>(`/api/admin/curriculum/subjects/${tree!.id}/publish`, { note }), "Published");
          }}>Publish</Button>
        </>
      }>
        <Field label="Change note" hint="Optional. Shown in version history."><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Added Magnetic Effects topics" /></Field>
      </Modal>
      <Modal open={modal === "map"} onOpenChange={(o) => !o && setModal(null)} title={`${tree?.name || ""} flow map`} sub="Chapters in teaching order with prerequisite links, including unpublished drafts. Click a topic to edit it." width={1180}>
        {flow.error ? <ErrorState error={flow.error} retry={() => flow.mutate()} /> : !flow.data ? <Loading /> : (
          <FlowMap admin data={flow.data} onPick={(n) => {
            if (n.state === "external") return;
            setChId(n.chapter_id);
            setTId(n.id);
            setModal(null);
          }} />
        )}
      </Modal>
      <Confirm open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title || ""} danger confirmLabel="Delete" onConfirm={() => {
        const c = confirm!;
        setConfirm(null);
        run(c.run, "Deleted");
      }}>
        {confirm?.body}
      </Confirm>
    </div>
  );
}
