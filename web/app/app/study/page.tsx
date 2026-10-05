"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button, Icon, LinkButton, PageHead, Segmented, Select, Textarea } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type Row = { id: string; t: string; s: string; when: string; status: string; fav: boolean; kind: string; icon: string };
const INPUTS = [
  { v: "link", l: "Lecture video", icon: "smart_display" },
  { v: "file", l: "Textbook", icon: "menu_book" },
  { v: "slides", l: "Slide deck", icon: "slideshow" },
  { v: "text", l: "Paste text", icon: "content_paste" },
] as const;
const OUTPUTS = ["Full notes", "Short notes", "Key concepts", "Formulas", "Concept map", "Revision sheet", "Flashcards", "Audio brief"];
const isYT = (u: string) => /(?:youtube\.com\/(?:watch|playlist|shorts|embed|live)|youtu\.be\/)/i.test(u);

export default function StudyAI() {
  const router = useRouter();
  const { data: lib } = useApi<Row[]>("/api/study/materials");
  const [kind, setKind] = useState<(typeof INPUTS)[number]["v"]>("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [lang, setLang] = useState("en");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const ok = kind === "link" ? isYT(url) : kind === "text" ? text.trim().length >= 200 : !!file;
  const start = async () => {
    if (!ok) {
      toast.error(kind === "link" ? "Paste a YouTube video or playlist link." : kind === "text" ? "Paste at least a few paragraphs." : "Choose a file first.");
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.set("input_kind", kind);
    fd.set("lang", lang);
    if (kind === "link") fd.set("url", url.trim());
    if (kind === "text") fd.set("text", text);
    if (file && (kind === "file" || kind === "slides")) fd.set("file", file);
    try {
      const m = await api.upload<{ id: string }>("/api/study/materials", fd);
      router.push(`/app/study/${m.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  const accept = kind === "file" ? ".pdf" : ".pptx,.pdf";
  const drop = (
    <div
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) setFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className="grid h-[140px] cursor-pointer place-items-center rounded-[14px] text-center text-ink2"
      style={{ border: `1.5px dashed ${drag ? "var(--pri)" : "var(--line)"}`, background: drag ? "var(--pri-soft)" : undefined }}
    >
      <input ref={inputRef} type="file" accept={accept} hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <div>
        <Icon name={file ? "description" : kind === "file" ? "menu_book" : "slideshow"} size={28} />
        <div className="font-semibold text-ink">{file ? file.name : kind === "file" ? "Drop a textbook PDF, or click to choose" : "Drop your teacher's slide deck, or click to choose"}</div>
        <div className="text-xs">
          {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · click to change` : kind === "file" ? "Scans work too. Text, diagrams and figures are read automatically." : "PPTX or PDF. Every note links back to its slide number."}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Study AI" sub="Turn a lesson you're watching or reading into structured study material." right={<LinkButton href="/app/study/library" icon="folder_open">My study material</LinkButton>} />
      <div className="flex flex-col gap-[18px] rounded-[22px] border border-line bg-surface p-6 shadow-card">
        <Segmented value={kind} onChange={(v) => (setKind(v), setFile(null))} className="self-start" options={INPUTS.map((t) => ({ v: t.v, l: <span className="flex items-center gap-1.5"><Icon name={t.icon} size={18} />{t.l}</span> }))} />
        {kind === "link" && (
          <label className="flex h-14 items-center gap-2.5 rounded-[14px] bg-bg px-4" style={{ border: "1.5px solid var(--line)" }}>
            <Icon name="link" size={22} className="text-ink3" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube lecture or playlist link" className="min-w-0 flex-1 border-0 bg-transparent font-mono text-sm font-medium outline-none" />
            {url && (
              <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: isYT(url) ? "var(--ok-ink)" : "var(--err-ink)" }}>
                <Icon name={isYT(url) ? "check_circle" : "error"} size={16} />
                {isYT(url) ? "Supported" : "Not a YouTube link"}
              </span>
            )}
          </label>
        )}
        {kind === "text" && <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste text from your textbook or class notes…" className="min-h-[140px] rounded-[14px] bg-bg" />}
        {(kind === "file" || kind === "slides") && drop}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] text-ink2">Create:</span>
          {OUTPUTS.map((o) => (
            <span key={o} className="flex h-[30px] items-center gap-1 rounded-full bg-pri-soft px-2.5 text-xs font-semibold text-pri-ink">
              <Icon name="check" size={15} />
              {o}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="max-w-[46ch] text-xs text-ink2">Works with YouTube lectures, textbook PDFs, phone scans and slide decks. Tap any note to jump back to where it came from.</div>
            <label className="flex items-center gap-2 text-[13px] text-ink2">
              Notes in
              <Select value={lang} onChange={(e) => setLang(e.target.value)} className="h-9 w-auto rounded-[10px] py-0 text-[13px]">
                <option value="en">English</option>
                <option value="hing">Hinglish</option>
                <option value="hi">हिंदी</option>
              </Select>
            </label>
          </div>
          <Button variant="primary" className="h-12 rounded-xl px-[22px] text-[15px]" icon="auto_awesome" loading={busy} onClick={start} style={{ opacity: ok ? 1 : 0.6 }}>
            Generate study material
          </Button>
        </div>
      </div>
      {!!lib?.length && (
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <div className="font-display text-[17px] font-semibold">Recently generated</div>
            <Link href="/app/study/library" className="font-semibold">See all</Link>
          </div>
          <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
            {lib.slice(0, 3).map((p) => (
              <Link key={p.id} href={`/app/study/${p.id}`} className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-[18px] text-left text-ink hover:border-pri hover:no-underline">
                <div className="flex justify-between">
                  <Icon name={p.icon} size={24} className="text-pri" />
                  <span className="text-xs text-ink3">{p.when}</span>
                </div>
                <div>
                  <div className="font-mono text-[11px] font-semibold tracking-[0.05em] text-ink2">{p.status === "Ready" ? "STUDY PACK" : p.status.toUpperCase()}</div>
                  <div className="mt-0.5 font-bold">{p.t}</div>
                  <div className="text-xs text-ink2">{p.s}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
