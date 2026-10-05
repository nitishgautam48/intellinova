"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { LANGS, MultiPick, type Structure } from "@/components/admin/kit";
import { Alert, Button, Field, Icon, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Meta = {
  url: string; platform: string; rtype?: string; available: boolean; title: string; creator?: string; description?: string; thumbnail_url?: string;
  duration_seconds?: number | null; duration_label?: string; languages?: string[]; stats?: { views: number; likes: number; comments: number }; error?: string;
  duplicate_of?: { id: string; title: string; status: string };
};
type Suggestion = { subject_id: string | null; subject?: string; chapter_id: string | null; chapter?: string; class_level: string; board?: string; topic_ids: string[]; topics?: string[]; difficulty: string; languages: string[]; confidence: number; reason: string };
type Form = { title: string; subject_id: string; chapter_id: string; topic_ids: string[]; difficulty: string; quality: string; languages: string[]; status: string; description: string };

const STEPS = ["Paste URL", "Detect metadata", "Suggested classification", "Review and edit", "Approve"];
const LANG_CODES: Record<string, string> = { en: "English", hi: "Hindi", mr: "Marathi", ta: "Tamil", te: "Telugu", bn: "Bengali", kn: "Kannada", gu: "Gujarati" };
const langName = (l: string) => LANG_CODES[l.toLowerCase().split("-")[0]] || l;

function confColor(c: number) {
  return c >= 0.85 ? "var(--ok-ink)" : c >= 0.6 ? "var(--warn-ink)" : "var(--err-ink)";
}

export default function NewResource() {
  const { data: tree } = useApi<Structure>("/api/admin/structure");
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  const subj = tree?.find((s) => s.id === f?.subject_id);
  const chapters = subj?.chapters || [];
  const topicOpts = (chapters.find((c) => c.id === f?.chapter_id)?.topics || chapters.flatMap((c) => c.topics)).map((t) => ({ id: t.id, name: t.name }));

  const detect = async () => {
    setErr("");
    if (!/^https?:\/\//i.test(url.trim())) return setErr("Paste a full link starting with https://");
    setBusy(true);
    try {
      const r = await api.post<{ meta: Meta; suggestion: Suggestion | null }>("/api/admin/resources/detect", { url: url.trim() });
      setMeta(r.meta);
      setSug(r.suggestion);
      const langs = [...new Set([...(r.suggestion?.languages || []), ...(r.meta.languages || [])].map(langName))];
      setF({
        title: r.meta.title || "", subject_id: r.suggestion?.subject_id || "", chapter_id: r.suggestion?.chapter_id || "", topic_ids: r.suggestion?.topic_ids || [],
        difficulty: r.suggestion?.difficulty || "Beginner", quality: "", languages: langs.length ? langs : ["English"], status: r.meta.available === false ? "Needs Review" : "Active",
        description: r.meta.description || "",
      });
      setStep(1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!f || !meta) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.post<{ id: string }>("/api/admin/resources", {
        url: meta.url || url.trim(), title: f.title, platform: meta.platform || "Web", rtype: meta.rtype || "Article", creator: meta.creator || "",
        duration_label: meta.duration_label || "", duration_seconds: meta.duration_seconds || null, thumbnail_url: meta.thumbnail_url || "", description: f.description,
        class_level: subj?.class_level || "", subject_id: f.subject_id || null, chapter_id: f.chapter_id || null, topic_ids: f.topic_ids,
        languages: f.languages, difficulty: f.difficulty, quality: f.quality || null, status: f.status, stats: meta.stats || null,
      });
      setCreated(r.id);
      setStep(5);
      toast.success("Added to catalog");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep(0);
    setUrl("");
    setMeta(null);
    setSug(null);
    setF(null);
    setErr("");
    setCreated(null);
  };

  const next = () => {
    setErr("");
    if (step === 0) return detect();
    if (step === 3 && f) {
      if (f.title.trim().length < 2) return setErr("Add a title.");
      if (f.status === "Active" && !f.chapter_id) return setErr("Pick a chapter so the resource can be recommended, or save it as Draft.");
    }
    if (step === 4) return create();
    setStep(step + 1);
  };

  return (
    <div className="flex max-w-[820px] flex-col gap-5">
      <Link href="/admin/resources" className="flex items-center gap-1 self-start font-semibold text-pri-ink">
        <Icon name="arrow_back" size={18} />Resources
      </Link>
      <div className="flex flex-wrap gap-x-[18px] gap-y-2">
        {STEPS.map((l, i) => {
          const done = i < step, cur = i === step;
          return (
            <div key={l} className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full font-mono text-[11px] font-semibold" style={{ background: done ? "var(--pri)" : cur ? "var(--ink)" : "var(--surface2)", color: done ? "var(--on-pri)" : cur ? "var(--bg)" : "var(--ink2)" }}>
                {done ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <span className="text-[13px]" style={{ color: cur ? "var(--ink)" : "var(--ink2)", fontWeight: cur ? 700 : 500 }}>{l}</span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-4 rounded-[18px] border border-line bg-surface p-6">
        {step === 0 && (
          <div className="flex flex-col gap-2.5">
            <div className="font-display text-xl font-semibold">Paste a resource URL</div>
            <form onSubmit={(e) => (e.preventDefault(), detect())}>
              <label className="flex h-[50px] items-center gap-2.5 rounded-xl border-[1.5px] border-pri bg-bg px-3.5">
                <Icon name="link" className="text-ink3" />
                <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[13px] outline-none" />
              </label>
            </form>
            <div className="text-xs text-ink2">Supports YouTube videos and playlists, web articles and PDFs.</div>
          </div>
        )}

        {step === 1 && meta && (
          <div className="flex flex-col gap-3">
            <div className="font-display text-xl font-semibold">Detected metadata</div>
            {meta.duplicate_of && (
              <Alert tone="warn">
                This link is already in the catalog as “{meta.duplicate_of.title}” ({meta.duplicate_of.status}).{" "}
                <Link href={`/admin/resources?open=${meta.duplicate_of.id}`}>Open it</Link>
              </Alert>
            )}
            {meta.available === false && <Alert tone="warn">The link didn&apos;t respond or the video is private. You can still add it for review.</Alert>}
            {!meta.title && <Alert tone="warn">Couldn&apos;t read a title from this page. You can enter the details by hand in the review step.</Alert>}
            <div className="flex flex-wrap items-center gap-4">
              {meta.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={meta.thumbnail_url} alt="" className="aspect-[16/10] w-[160px] flex-none rounded-[10px] object-cover" />
              ) : (
                <div className="aspect-[16/10] w-[120px] flex-none rounded-[10px]" style={{ background: "repeating-linear-gradient(135deg,var(--surface2) 0 8px,var(--stripe) 8px 16px)" }} />
              )}
              <div className="grid gap-x-3.5 gap-y-1 text-[13px]" style={{ gridTemplateColumns: "auto 1fr" }}>
                <span className="text-ink2">Title</span><strong>{meta.title || "—"}</strong>
                <span className="text-ink2">Platform</span><span>{meta.platform}{meta.rtype ? ` · ${meta.rtype}` : ""}</span>
                {meta.creator && (<><span className="text-ink2">Creator</span><span>{meta.creator}</span></>)}
                <span className="text-ink2">Duration</span><span>{meta.duration_label || "—"}</span>
                <span className="text-ink2">Language</span><span>{meta.languages?.length ? meta.languages.map(langName).join(", ") : "Not stated"}</span>
                {meta.stats && (<><span className="text-ink2">Engagement</span><span>{meta.stats.views.toLocaleString()} views · {meta.stats.likes.toLocaleString()} likes</span></>)}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <div className="font-display text-xl font-semibold">Suggested classification</div>
            {sug && sug.chapter_id ? (
              <>
                <div className="text-xs text-ink2">{sug.reason || "Suggested from the title, description and your curriculum's topic list."}</div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
                  {[
                    ["Class · Subject", `Class ${sug.class_level} · ${sug.subject}`],
                    ["Chapter", sug.chapter],
                    ["Topics", sug.topics?.length ? sug.topics.join(", ") : "None matched"],
                    ["Difficulty", sug.difficulty],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-[10px] bg-surface2 p-3">
                      <div className="text-xs text-ink2">{k}</div>
                      <div className="font-bold">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="font-mono text-xs font-semibold" style={{ color: confColor(sug.confidence) }}>
                  {Math.round(sug.confidence * 100)}% confident{sug.confidence < 0.7 ? " · check the chapter and topics in the next step" : ""}
                </div>
              </>
            ) : (
              <Alert tone="warn">{sug?.reason || "No classification could be suggested. Pick the subject, chapter and topics in the next step."}</Alert>
            )}
          </div>
        )}

        {step === 3 && f && (
          <div className="flex flex-col gap-3">
            <div className="font-display text-xl font-semibold">Review and edit</div>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              <Field label="Title" className="col-span-full"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
              <Field label="Subject">
                <Select value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value, chapter_id: "", topic_ids: [] })}>
                  <option value="">—</option>
                  {tree?.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label="Chapter">
                <Select value={f.chapter_id} onChange={(e) => setF({ ...f, chapter_id: e.target.value, topic_ids: [] })} disabled={!chapters.length}>
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
              <MultiPick value={f.topic_ids} onChange={(v) => setF({ ...f, topic_ids: v })} options={topicOpts} placeholder={topicOpts.length ? "Add a topic…" : "Pick a subject first"} />
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
            <Field label="Status on save">
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option>Active</option>
                <option>Needs Review</option>
                <option>Draft</option>
              </Select>
            </Field>
          </div>
        )}

        {step === 4 && f && (
          <div className="flex flex-col gap-2.5">
            <div className="font-display text-xl font-semibold">Approve and add to catalog</div>
            <div className="text-sm text-ink2">
              “{f.title}” will be <strong className="text-ink">{f.status}</strong>
              {subj ? <> for {subj.label}{f.chapter_id ? ` · ${chapters.find((c) => c.id === f.chapter_id)?.name}` : ""}</> : ""}
              {f.topic_ids.length ? `, covering ${f.topic_ids.length} topic${f.topic_ids.length === 1 ? "" : "s"}` : ""}.
              {f.status === "Active" ? " It can appear in recommendations right away." : " It won't be shown to students until it's Active."} Availability is re-checked daily.
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col items-start gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-[14px] bg-ok-soft text-ok"><Icon name="check_circle" size={28} fill /></div>
            <div className="font-display text-xl font-semibold">Added to catalog</div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={reset}>Add another</Button>
              <LinkButton href={created ? `/admin/resources?open=${created}` : "/admin/resources"}>Open resource</LinkButton>
              <LinkButton href="/admin/resources" variant="ghost">Back to resources</LinkButton>
            </div>
          </div>
        )}

        {err && <Alert>{err}</Alert>}

        {step < 5 && (
          <div className="flex justify-between border-t border-line pt-3.5">
            <Button onClick={() => (setErr(""), setStep(Math.max(0, step - 1)))} disabled={step === 0}>Back</Button>
            <Button variant="primary" loading={busy} onClick={next}>
              {step === 0 ? "Detect" : step === 4 ? "Add to catalog" : "Continue"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
