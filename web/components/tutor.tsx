"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Drawer, Modal } from "@/components/ui/dialog";
import { Button, Checkbox, CiteBadge, Empty, Icon, Loading, PageHead, Segmented, Select, Spinner, Toggle } from "@/components/ui";
import { api, PORTAL_HEADER, useApi } from "@/lib/api";
import { canRecord, recordUtterance, type Capture } from "@/lib/voice";

type Cite = { n: number; unit_id: string; source_title: string; source_type: string; icon: string; kind: string; location: string; excerpt: string };
type Msg = { id: string; role: "user" | "assistant"; content: string; lang: string; citations: Cite[]; status: string; pending?: boolean; searched?: string | null };
type Scope = { kind: "all" | "subject" | "chapter" | "mine" | "sources"; id?: string; ids?: string[]; label: string };
type Scopes = {
  subjects: { id: string; name: string; chapters: { id: string; name: string }[] }[];
  sources: { id: string; title: string; type: string; icon: string; mine: boolean; subject: string }[];
};
type Conv = { id: string; title: string; lang: string; source_only: boolean; updated: string; intake: boolean; greeting: string | null; scope?: Scope; messages?: Msg[] };
const ALL: Scope = { kind: "all", label: "All my material" };
type Sugg = { chapter: { id: string; name: string; subject: string } | null; prompts: string[]; sources: { icon: string; t: string; n: number }[]; units: number };
type UnitCtx = {
  unit_id: string; title: string; type: string; icon: string; loc: string; kind: string; excerpt: string; topic: string | null; open_url: string | null;
  head?: string; lines?: string[]; labels?: string[]; desc?: string; image_url?: string | null;
  transcript?: { time: string; t: string; hi: boolean }[]; pct?: string | null; paras?: { t: string; hi: boolean }[]; time?: string;
};

const LANGS = [
  { v: "en", l: "English" },
  { v: "hing", l: "Hinglish" },
  { v: "hi", l: "हिंदी" },
] as const;

/* ------------------------------------------------------------ speech (Whisper + Piper on the server, browser fallback) */

const SR_ = () => (typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null);

function micError(e: unknown) {
  const n = (e as { name?: string })?.name;
  if (n === "NotAllowedError" || n === "SecurityError") return "Microphone access is blocked. Allow it in the browser's site settings.";
  if (n === "NotFoundError") return "No microphone found.";
  return (e as Error)?.message || "Voice input failed.";
}

function useSpeech(lang: string) {
  const { data: caps } = useApi<{ stt: boolean; tts: boolean }>(`/api/tutor/voice?lang=${lang}`);
  const cap = useRef<Capture | null>(null);
  const rec = useRef<any>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const done = useRef<(() => void) | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);
  // Browser capabilities are only known after the first render; checking them during it made the server HTML
  // (no mic button) differ from the browser's (mic button) and React threw a hydration error.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const server = mounted && !!caps?.stt && canRecord();
  const supported = mounted && (server || !!SR_());

  /** Records one spoken question and returns its text ("" if nothing was heard). */
  const capture = async (): Promise<string> => {
    setListening(true);
    try {
      if (server) {
        const c = recordUtterance({ onLevel: setLevel });
        cap.current = c;
        const blob = await c.done;
        setListening(false);
        if (!blob) return "";
        setTranscribing(true);
        const fd = new FormData();
        fd.set("audio", blob, `question.${blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm"}`);
        fd.set("lang", lang);
        return ((await api.upload<{ text: string }>("/api/tutor/transcribe", fd)).text || "").trim();
      }
      const SR = SR_();
      if (!SR) throw new Error("Voice input isn't available in this browser.");
      return await new Promise<string>((resolve, reject) => {
        const r = new SR();
        r.lang = lang === "hi" ? "hi-IN" : "en-IN";
        r.interimResults = false;
        r.maxAlternatives = 1;
        let text = "";
        r.onresult = (e: any) => (text = e.results[0][0].transcript);
        r.onerror = (e: any) => (e.error === "no-speech" || e.error === "aborted" ? resolve("") : reject(new Error(`Voice input error: ${e.error}`)));
        r.onend = () => resolve(text.trim());
        rec.current = r;
        r.start();
      });
    } finally {
      cap.current = null;
      rec.current = null;
      setListening(false);
      setTranscribing(false);
      setLevel(0);
    }
  };
  /** Stop listening now (whatever was said so far is still transcribed). */
  const stop = () => {
    cap.current?.stop();
    rec.current?.stop();
  };
  /** Speak an answer; resolves when it has finished (or was hushed). */
  const speak = (text: string) =>
    new Promise<void>(async (resolve) => {
      done.current = resolve;
      const clean = text.replace(/\[\d+\]/g, "");
      try {
        if (caps?.tts !== false) {
          const res = await fetch("/api/tutor/tts", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", [PORTAL_HEADER]: "student" }, body: JSON.stringify({ text: clean, lang }) });
          if (res.ok) {
            const a = new Audio(URL.createObjectURL(await res.blob()));
            audio.current = a;
            a.onended = a.onerror = () => resolve();
            await a.play();
            return;
          }
        }
      } catch {}
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(clean);
        u.lang = lang === "hi" ? "hi-IN" : "en-IN";
        u.onend = u.onerror = () => resolve();
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } else resolve();
    });
  const hush = () => {
    audio.current?.pause();
    audio.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    done.current?.();
  };
  return { listening, transcribing, level, supported, server, capture, stop, speak, hush };
}

/* ------------------------------------------------------------ rendering */

function withCites(text: string, sel: number | null, onPick: (n: number) => void) {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[(\d+)\]$/);
    if (m) {
      const n = Number(m[1]);
      return <CiteBadge key={i} n={n} on={sel === n} onClick={() => onPick(n)} />;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

function Widen({ m, onWiden }: { m: Msg; onWiden?: () => void }) {
  if (!m.searched || !onWiden) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink2">
      <Icon name="filter_alt" size={16} />
      <span>
        Only searched <strong className="text-ink">{m.searched}</strong>.
      </span>
      <button onClick={onWiden} className="border-0 bg-transparent p-0 font-bold text-pri-ink">Search all my material instead</button>
    </div>
  );
}

function Answer({ m, sel, onPick, sourceOnly, onWiden }: { m: Msg; sel: { msg: string; n: number } | null; onPick: (msg: string, n: number) => void; sourceOnly: boolean; onWiden?: () => void }) {
  const selN = sel?.msg === m.id ? sel.n : null;
  if (m.status === "declined") {
    return (
      <div className="flex gap-3">
        <div className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-warn-soft text-warn-ink">
          <Icon name="report" size={18} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="rounded-[14px] bg-warn-soft px-4 py-3.5">
            <div className="font-bold text-warn-ink">Not covered in your material</div>
            <div className="mt-1 text-sm">{m.content}</div>
          </div>
          <Widen m={m} onWiden={onWiden} />
        </div>
      </div>
    );
  }
  if (m.status === "outside") {
    return (
      <div className="flex gap-3">
        <div className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-warn-soft text-warn-ink">
          <Icon name="report" size={18} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="rounded-[14px] bg-warn-soft px-4 py-3.5">
            <div className="font-bold text-warn-ink">Not covered in your material</div>
            <div className="mt-1 text-sm">I couldn&apos;t find this in your class material, so here is a general explanation instead.</div>
          </div>
          <div className="rounded-[14px] px-4 py-3.5" style={{ border: "1.5px dashed var(--ink3)" }}>
            <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-[0.06em] text-ink2">
              <Icon name="public" size={15} />
              OUTSIDE KNOWLEDGE · NOT FROM YOUR SOURCES
            </div>
            <div className="mt-1.5 whitespace-pre-wrap text-sm leading-[1.65]">{m.content}</div>
            <div className="mt-2 text-xs text-ink2">Not cited, not used in quizzes. Check with your teacher before relying on it.</div>
          </div>
          <Widen m={m} onWiden={onWiden} />
        </div>
      </div>
    );
  }
  const diagram = m.citations.find((c) => c.kind === "diagram");
  return (
    <div className="flex gap-3">
      <div className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-pri-soft text-pri">
        <Icon name="auto_awesome" size={18} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="m-0 whitespace-pre-wrap text-[15px] leading-[1.7] [text-wrap:pretty]">{withCites(m.content, selN, (n) => onPick(m.id, n))}</p>
        {m.lang !== "en" && (
          <div className="flex items-center gap-1.5 text-xs text-teal-ink">
            <Icon name="translate" size={16} />
            Explanation translated. Quoted excerpts stay in the source language.
          </div>
        )}
        {m.citations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {m.citations.map((c) => {
              const on = selN === c.n;
              return (
                <button key={c.n} onClick={() => onPick(m.id, c.n)} className="flex min-w-0 flex-[1_1_180px] flex-col gap-1 rounded-xl px-3 py-2.5 text-left" style={{ border: `1.5px solid ${on ? "var(--pri)" : "var(--line)"}`, background: on ? "var(--pri-soft)" : "var(--surface)" }}>
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    <span className="font-mono text-[11px] font-semibold text-pri-ink">[{c.n}]</span>
                    <Icon name={c.icon} size={15} />
                    {c.location}
                  </span>
                  <span className="line-clamp-2 text-xs text-ink2">{c.excerpt}</span>
                </button>
              );
            })}
          </div>
        )}
        {diagram && (
          <div className="flex items-center gap-3 rounded-xl border border-line p-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1 font-mono text-[11px] font-semibold tracking-[0.04em] text-teal-ink">
                <Icon name="image_search" size={15} />
                READ FROM THE FIGURE
              </div>
              <div className="mt-1 text-[13px]">Labels and layout were extracted from the image at {diagram.location}, not only from its caption.</div>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ok-ink">
          <Icon name="verified" size={16} fill />
          Linked to your class material{sourceOnly ? " · sources only" : ""}
        </div>
      </div>
    </div>
  );
}

export function SourceViewer({ unitId, n }: { unitId: string | null; n: number | null }) {
  const { data: u, isLoading } = useApi<UnitCtx>(unitId ? `/api/units/${unitId}` : null);
  if (!unitId) {
    return (
      <div className="flex flex-col gap-2 text-[13px] text-ink2">
        <div className="font-mono text-[11px] font-semibold tracking-[0.06em] text-ink3">SOURCE VIEWER</div>
        Tap a number in an answer to see the exact page, slide, figure or video moment it came from.
      </div>
    );
  }
  if (isLoading || !u) return <Loading />;
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="rounded-md px-[7px] py-0.5 font-mono text-[11px] font-semibold text-on-pri" style={{ background: "var(--grad)" }}>
          [{n}]
        </span>
        <span className="font-mono text-[11px] font-semibold tracking-[0.06em] text-ink3">SOURCE VIEWER</span>
      </div>
      <div className="flex items-center gap-2.5">
        <Icon name={u.icon} size={22} className="text-pri" />
        <div className="min-w-0">
          <div className="text-sm font-bold">{u.title}</div>
          <div className="font-mono text-xs font-medium text-ink2">
            {u.type} · {u.loc}
          </div>
        </div>
      </div>
      {u.kind === "slide" && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-bg p-[18px]" style={{ aspectRatio: "16/10" }}>
          <div className="font-display text-lg font-semibold">{u.head}</div>
          {(u.lines || []).map((l, i) => (
            <div key={i} className="flex gap-2 text-[13px]">
              <span className="text-pri">•</span>
              {l}
            </div>
          ))}
          <div className="mt-auto self-end font-mono text-[11px] font-medium text-ink3">{u.loc}</div>
        </div>
      )}
      {u.kind === "diagram" && (
        <div className="flex flex-col gap-2.5">
          <div className="grid place-items-center overflow-hidden rounded-xl" style={{ aspectRatio: "4/3", background: "repeating-linear-gradient(135deg,var(--surface2) 0 10px,var(--stripe) 10px 20px)" }}>
            {u.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u.image_url} alt={u.desc || ""} className="h-full w-full object-contain" />
            ) : (
              <span className="font-mono text-[11px] font-medium text-ink3">{u.loc}</span>
            )}
          </div>
          {!!u.labels?.length && (
            <>
              <div className="font-mono text-[11px] font-semibold tracking-[0.06em] text-teal-ink">LABELS READ FROM THE FIGURE</div>
              <div className="flex flex-wrap gap-1.5">
                {u.labels.map((l) => (
                  <span key={l} className="rounded-md bg-teal-soft px-2 py-[3px] text-xs font-semibold text-teal-ink">
                    {l}
                  </span>
                ))}
              </div>
            </>
          )}
          <div className="text-[13px] text-ink2">{u.desc}</div>
        </div>
      )}
      {u.kind === "transcript" && (
        <div className="flex flex-col gap-2.5">
          <div className="relative grid place-items-center rounded-xl" style={{ aspectRatio: "16/9", background: "oklch(0.2 0.02 268)" }}>
            <Icon name="play_circle" size={40} fill style={{ color: "#fff" }} />
            {u.pct && (
              <div className="absolute bottom-3 left-3 right-3 h-1 rounded-sm bg-white/25">
                <div className="h-full rounded-sm bg-pri" style={{ width: u.pct }} />
              </div>
            )}
          </div>
          {(u.transcript || []).map((l, i) => (
            <div key={i} className="flex gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px]" style={{ background: l.hi ? "var(--pri-soft)" : "transparent", fontWeight: l.hi ? 600 : 400 }}>
              <span className="font-mono text-xs font-medium text-pri-ink">{l.time}</span>
              <span className="line-clamp-4">{l.t}</span>
            </div>
          ))}
        </div>
      )}
      {u.kind === "page" && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-bg p-[18px]">
          {(u.paras || []).map((p, i) => (
            <div key={i} className="rounded-md px-1.5 py-1 text-[13px] leading-relaxed" style={{ background: p.hi ? "var(--warn-soft)" : "transparent" }}>
              {p.t}
            </div>
          ))}
          <div className="self-center font-mono text-[11px] font-medium text-ink3">{u.loc}</div>
        </div>
      )}
      {u.topic && <div className="text-xs text-ink2">Topic: {u.topic}</div>}
      {u.open_url && (
        <a href={u.open_url} target="_blank" rel="noopener" className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] font-semibold text-on-pri hover:no-underline" style={{ background: "var(--grad)" }}>
          <Icon name="open_in_new" size={18} />
          Open at {u.time || u.loc}
        </a>
      )}
    </>
  );
}

function ScopePicker({ open, onOpenChange, value, onApply }: { open: boolean; onOpenChange: (v: boolean) => void; value: Scope; onApply: (s: Scope) => void }) {
  const { data } = useApi<Scopes>(open ? "/api/tutor/scopes" : null);
  const [kind, setKind] = useState<Scope["kind"]>(value.kind);
  const [subject, setSubject] = useState("");
  const [chapter, setChapter] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!open) return;
    setKind(value.kind);
    setSubject(value.kind === "subject" ? value.id || "" : "");
    setChapter(value.kind === "chapter" ? value.id || "" : "");
    setFiles(value.kind === "sources" ? value.ids || [] : []);
    setQ("");
  }, [open, value]);
  const subjects = data?.subjects || [];
  const sources = data?.sources || [];
  const mine = sources.filter((s) => s.mine);
  const shown = sources.filter((s) => !q || `${s.title} ${s.subject} ${s.type}`.toLowerCase().includes(q.toLowerCase()));
  const sub = subjects.find((x) => x.id === subject) || subjects[0];
  const chapters = subjects.flatMap((x) => x.chapters.map((c) => ({ ...c, subject: x.name })));

  const build = (): Scope | null => {
    if (kind === "all") return ALL;
    if (kind === "mine") return mine.length ? { kind, label: "My uploads" } : null;
    if (kind === "subject") return sub ? { kind, id: sub.id, label: sub.name } : null;
    if (kind === "chapter") {
      const c = chapters.find((x) => x.id === chapter) || chapters[0];
      return c ? { kind, id: c.id, label: `${c.subject} · ${c.name}` } : null;
    }
    return files.length ? { kind, ids: files, label: files.length === 1 ? sources.find((s) => s.id === files[0])?.title || "1 file" : `${files.length} files` } : null;
  };
  const choice = build();
  const opt = (k: Scope["kind"], icon: string, title: string, sub2: string, disabled = false, extra?: React.ReactNode) => (
    <div
      className="rounded-xl border p-3"
      style={{ borderColor: kind === k ? "var(--pri)" : "var(--line)", background: kind === k ? "var(--pri-soft)" : "var(--surface)", opacity: disabled ? 0.55 : 1 }}
    >
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="radio" name="scope" checked={kind === k} disabled={disabled} onChange={() => setKind(k)} className="mt-1 accent-[var(--pri)]" />
        <Icon name={icon} size={20} className="mt-px flex-none" />
        <span className="min-w-0">
          <span className="block font-semibold">{title}</span>
          <span className="block text-xs text-ink2">{sub2}</span>
        </span>
      </label>
      {kind === k && extra && <div className="mt-2.5 pl-[30px]">{extra}</div>}
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="What should the tutor answer from?"
      sub="Narrow it to a subject, a chapter or particular files. You can change this any time; it applies from your next question."
      width={600}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!choice} onClick={() => choice && onApply(choice)}>Use this</Button>
        </>
      }
    >
      {!data ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-2">
          {opt("all", "library_books", "All my material", "Everything your school has added, plus your own uploads")}
          {opt("subject", "school", "One subject", subjects.length ? "Only material for the subject you pick" : "No subjects with material yet", !subjects.length,
            <Select value={sub?.id || ""} onChange={(e) => setSubject(e.target.value)} aria-label="Subject">
              {subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>)}
          {opt("chapter", "menu_book", "One chapter", chapters.length ? "Only material filed under, or tagged to, that chapter" : "No published chapters yet", !chapters.length,
            <Select value={chapter || chapters[0]?.id || ""} onChange={(e) => setChapter(e.target.value)} aria-label="Chapter">
              {subjects.map((x) => (
                <optgroup key={x.id} label={x.name}>
                  {x.chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </Select>)}
          {opt("mine", "upload_file", "Only my uploads", mine.length ? `${mine.length} file${mine.length === 1 ? "" : "s"} you added in Study AI` : "You haven't added material yet (Study AI › add your notes)", !mine.length)}
          {opt("sources", "checklist", "Particular files", "Pick one or more textbooks, slide decks, videos or notes", !sources.length,
            <div className="flex flex-col gap-1.5">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter files" aria-label="Filter files" className="h-9 rounded-lg border border-line bg-surface px-3 text-[13px] outline-none" />
              <div className="flex max-h-[220px] flex-col gap-0.5 overflow-auto">
                {shown.map((s) => (
                  <Checkbox key={s.id} checked={files.includes(s.id)} onChange={(v) => setFiles((f) => (v ? [...f, s.id] : f.filter((x) => x !== s.id)))}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Icon name={s.icon} size={16} className="flex-none text-ink2" />
                      <span className="truncate">{s.title}</span>
                      <span className="flex-none text-xs text-ink3">{s.mine ? "· yours" : s.subject ? `· ${s.subject}` : ""}</span>
                    </span>
                  </Checkbox>
                ))}
                {!shown.length && <span className="text-xs text-ink2">No files match.</span>}
              </div>
            </div>)}
        </div>
      )}
    </Modal>
  );
}

export function Tutor({ conversationId, initialQ }: { conversationId?: string; initialQ?: string }) {
  const router = useRouter();
  const { data: sugg } = useApi<Sugg>("/api/tutor/suggestions");
  const { data: conv, mutate } = useApi<Conv>(conversationId ? `/api/tutor/conversations/${conversationId}` : null);
  const { data: history, mutate: mutateHist } = useApi<Conv[]>("/api/tutor/conversations");
  const [lang, setLang] = useState<string>("en");
  const [srcOnly, setSrcOnly] = useState(false);
  const [scope, setScope] = useState<Scope>(ALL);
  const [picking, setPicking] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(initialQ || "");
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(false);
  const [sel, setSel] = useState<{ msg: string; n: number } | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const speech = useSpeech(lang);

  useEffect(() => {
    if (conv) {
      setMsgs(conv.messages || []);
      setLang(conv.lang);
      setSrcOnly(conv.source_only);
      setScope(conv.scope || ALL);
      const last = [...(conv.messages || [])].reverse().find((m) => m.role === "assistant" && m.citations.length);
      if (last) setSel({ msg: last.id, n: 1 });
    }
  }, [conv]);
  useEffect(() => {
    // Block body on purpose: newer browsers return a Promise from scrollIntoView, and an effect must
    // return nothing or a cleanup function (React calls anything else on unmount and crashes).
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length, busy]);

  const selectedCite = sel ? msgs.find((m) => m.id === sel.msg)?.citations.find((c) => c.n === sel.n) : undefined;

  const ensureConv = async (): Promise<string> => {
    if (conversationId) return conversationId;
    const c = await api.post<Conv>("/api/tutor/conversations", { lang, source_only: srcOnly, scope });
    window.history.replaceState(null, "", `/app/tutor/${c.id}`);
    return c.id;
  };
  const cidRef = useRef<string | undefined>(conversationId);

  const send = async (content: string, speakReply = true): Promise<Msg | null> => {
    const t = content.trim();
    if (!t || busy) return null;
    setText("");
    setBusy(true);
    const temp: Msg = { id: `tmp-${Date.now()}`, role: "user", content: t, lang, citations: [], status: "answered", pending: true };
    setMsgs((m) => [...m, temp]);
    try {
      const cid = cidRef.current || (await ensureConv());
      cidRef.current = cid;
      const r = await api.post<{ user: Msg; assistant: Msg }>(`/api/tutor/conversations/${cid}/messages`, { content: t });
      setMsgs((m) => [...m.filter((x) => x.id !== temp.id), r.user, r.assistant]);
      if (r.assistant.citations.length) {
        setSel({ msg: r.assistant.id, n: 1 });
      }
      if (voice && speakReply) speech.speak(r.assistant.content);
      mutateHist();
      return r.assistant;
    } catch (e) {
      setMsgs((m) => m.filter((x) => x.id !== temp.id));
      setText(t);
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const patch = async (p: { lang?: string; source_only?: boolean }) => {
    if (p.lang) setLang(p.lang);
    if (p.source_only !== undefined) setSrcOnly(p.source_only);
    if (cidRef.current) await api.patch(`/api/tutor/conversations/${cidRef.current}`, p).catch(() => {});
  };

  // What the tutor answers from (all material, a subject, a chapter, my uploads or chosen files). Applies from the next question.
  const applyScope = async (next: Scope): Promise<boolean> => {
    try {
      if (cidRef.current) {
        const c = await api.patch<Conv>(`/api/tutor/conversations/${cidRef.current}`, { scope: next });
        setScope(c.scope || ALL);
      } else {
        setScope(next);
      }
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };
  const widen = async (answerId: string) => {
    const i = msgs.findIndex((x) => x.id === answerId);
    const q = [...msgs.slice(0, i)].reverse().find((x) => x.role === "user");
    if ((await applyScope(ALL)) && q) await send(q.content);
  };

  // One spoken question; the answer is read aloud.
  const startVoice = async () => {
    setVoice(true);
    try {
      const t = await speech.capture();
      if (t) await send(t);
      else toast("Didn't catch that. Tap the mic and try again.");
    } catch (e) {
      toast.error(micError(e));
    }
  };

  // Hands-free voice session (6e): listen → answer aloud → listen again, until the student ends it.
  const [talk, setTalk] = useState<null | "listening" | "thinking" | "speaking">(null);
  const talkOn = useRef(false);
  const startTalk = async () => {
    talkOn.current = true;
    setVoice(true);
    let misses = 0;
    try {
      while (talkOn.current) {
        setTalk("listening");
        const t = await speech.capture();
        if (!talkOn.current) break;
        if (!t) {
          if (++misses >= 2) {
            toast("Voice mode paused: no speech heard.");
            break;
          }
          continue;
        }
        misses = 0;
        setTalk("thinking");
        const a = await send(t, false);
        if (!talkOn.current || !a) break;
        setTalk("speaking");
        await speech.speak(a.content);
      }
    } catch (e) {
      toast.error(micError(e));
    }
    talkOn.current = false;
    setTalk(null);
  };
  const endTalk = () => {
    talkOn.current = false;
    speech.stop();
    speech.hush();
    setTalk(null);
  };
  useEffect(() => () => {
    talkOn.current = false;
  }, []);

  const pick = (msg: string, n: number) => {
    setSel({ msg, n });
    if (window.innerWidth < 1100) setViewerOpen(true);
  };

  const greeting = conv?.greeting && !msgs.length ? conv.greeting : null;

  return (
    <div className="flex flex-col gap-[18px]">
      <PageHead
        title="Ask Tutor"
        sub={`Ask anything from your ${sugg?.chapter ? sugg.chapter.name + " lessons" : "class material"}. Tap a number in an answer to see exactly where it comes from.`}
        right={
          <>
            <Segmented value={lang} onChange={(v) => patch({ lang: v })} options={LANGS.map((l) => ({ v: l.v, l: l.l }))} />
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-semibold">
              Sources only
              <Toggle on={srcOnly} onChange={(v) => patch({ source_only: v })} label="Sources only" />
            </label>
            <Button size="md" icon="history" onClick={() => setHistOpen(true)}>
              History
            </Button>
            <Button size="md" icon="add" onClick={() => router.push("/app/tutor?new=1")}>
              New
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px]">
        <span className="text-ink2">Answering from</span>
        <button
          onClick={() => setPicking(true)}
          aria-label="Choose what the tutor answers from"
          className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-semibold"
          style={{ borderColor: scope.kind === "all" ? "var(--line)" : "var(--pri)", background: scope.kind === "all" ? "var(--surface)" : "var(--pri-soft)", color: scope.kind === "all" ? "var(--ink)" : "var(--pri-ink)" }}
        >
          <Icon name={scope.kind === "all" ? "library_books" : "filter_alt"} size={16} />
          <span className="max-w-[260px] truncate">{scope.label}</span>
          <Icon name="expand_more" size={16} />
        </button>
        {scope.kind === "all" && (sugg?.sources.length ? (
          sugg.sources.map((x) => (
            <span key={x.t} className="flex items-center gap-1 rounded-lg bg-surface2 px-[9px] py-[3px] font-semibold">
              <Icon name={x.icon} size={15} />
              {x.t}
            </span>
          ))
        ) : (
          <span className="font-semibold">no class material yet</span>
        ))}
        {scope.kind === "all" && <span className="text-ink2">· {(sugg?.units || 0).toLocaleString("en-IN")} content units</span>}
        <Link href="/app/study" className="ml-auto font-semibold">
          Add your own material
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-h-[520px] min-w-0 flex-[1.5_1_480px] flex-col rounded-[18px] border border-line bg-surface">
          <div className="flex flex-1 flex-col gap-[22px] p-[22px]">
            {greeting && (
              <div className="flex gap-3">
                <div className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-pri-soft text-pri">
                  <Icon name="auto_awesome" size={18} />
                </div>
                <p className="m-0 text-[15px] leading-[1.7]">{greeting}</p>
              </div>
            )}
            {!msgs.length && !greeting && !conversationId && (
              <Empty icon="forum" title="Ask your first question" className="my-auto border-0">
                Answers come only from your class material, with a numbered source for every point. If your material doesn&apos;t cover something, the tutor says so instead of guessing.
              </Empty>
            )}
            {conversationId && !conv && <Loading />}
            {msgs.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="max-w-[80%] self-end whitespace-pre-wrap rounded-[16px_16px_4px_16px] px-4 py-3 font-medium text-on-pri" style={{ background: "var(--grad)", opacity: m.pending ? 0.8 : 1 }}>
                  {m.content}
                </div>
              ) : (
                <Answer key={m.id} m={m} sel={sel} onPick={pick} sourceOnly={srcOnly} onWiden={busy ? undefined : () => widen(m.id)} />
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 text-[13px] text-ink2">
                <Spinner size={18} /> Checking your material…
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="flex flex-col gap-2.5 border-t border-line px-4 py-3.5">
            {!!sugg?.prompts.length && msgs.length < 2 && (
              <div className="flex flex-wrap gap-1.5">
                {sugg.prompts.map((p) => (
                  <button key={p} onClick={() => (p.startsWith("Quiz me") ? router.push("/app/practice") : send(p))} className="h-8 rounded-full border border-line bg-surface px-3 text-xs font-semibold">
                    {p}
                  </button>
                ))}
              </div>
            )}
            {talk || speech.listening || speech.transcribing ? (
              <div className="flex items-center gap-3.5 rounded-[14px] bg-pri-soft px-3.5 py-3">
                <div className="relative grid h-11 w-11 flex-none place-items-center rounded-full text-on-pri" style={{ background: "var(--grad)" }}>
                  {speech.listening && <span className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 ${3 + Math.round(speech.level * 9)}px var(--pri-soft)`, transition: "box-shadow 60ms" }} />}
                  {speech.transcribing || talk === "thinking" ? <Spinner size={22} /> : <Icon name={talk === "speaking" ? "volume_up" : "mic"} size={24} fill />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-pri-ink">
                    {speech.transcribing ? "Writing down your question…" : talk === "thinking" ? "Checking your material…" : talk === "speaking" ? "Answering…" : "Listening…"}
                  </div>
                  <div className="text-xs text-ink2">
                    {talk
                      ? "Voice mode: ask, listen, then just ask the next question. It stops listening when you pause."
                      : "Speak in English, Hindi or both, then pause. The answer is read aloud and appears above with its citations."}
                    {speech.server ? " Your voice is transcribed on this server, not by a cloud service." : ""}
                  </div>
                </div>
                {talk ? (
                  <Button size="sm" onClick={endTalk} className="border-pri text-pri-ink">End voice mode</Button>
                ) : (
                  speech.listening && <Button size="sm" onClick={speech.stop} className="border-pri text-pri-ink">Done</Button>
                )}
              </div>
            ) : (
              <form onSubmit={(e) => (e.preventDefault(), send(text))} className="flex h-[50px] items-center gap-2.5 rounded-[14px] bg-bg pl-4 pr-2" style={{ border: "1.5px solid var(--line)" }}>
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about anything in your sources…" className="min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none" />
                {speech.supported && (
                  <>
                    <button type="button" onClick={startVoice} disabled={busy} aria-label="Speak your question" title="Speak one question" className="h-9 w-9 rounded-[10px] border-0 bg-transparent text-ink2 hover:bg-surface2" style={{ color: voice ? "var(--pri)" : undefined }}>
                      <Icon name="mic" />
                    </button>
                    <button type="button" onClick={startTalk} disabled={busy} aria-label="Hands-free voice mode" title="Hands-free voice mode: talk with the tutor" className="h-9 w-9 rounded-[10px] border-0 bg-transparent text-ink2 hover:bg-surface2">
                      <Icon name="record_voice_over" />
                    </button>
                  </>
                )}
                <button type="submit" aria-label="Send" disabled={busy || !text.trim()} className="h-9 w-9 rounded-[10px] border-0 text-on-pri disabled:opacity-50" style={{ background: "var(--grad)" }}>
                  <Icon name="arrow_upward" />
                </button>
              </form>
            )}
            {voice && !speech.listening && !talk && (
              <div className="flex items-center justify-between text-xs text-ink2">
                Voice replies are on.
                <button onClick={() => (setVoice(false), speech.hush())} className="border-0 bg-transparent p-0 font-semibold text-pri-ink">
                  Turn off
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="sticky top-0 hidden min-w-0 flex-[1_1_340px] flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-[18px] min-[1100px]:flex">
          <SourceViewer unitId={selectedCite?.unit_id || null} n={selectedCite?.n || null} />
        </div>
      </div>

      <Drawer open={viewerOpen && !!selectedCite} onOpenChange={setViewerOpen} title="Source">
        <div className="flex flex-col gap-3.5">
          <SourceViewer unitId={selectedCite?.unit_id || null} n={selectedCite?.n || null} />
        </div>
      </Drawer>

      <ScopePicker open={picking} onOpenChange={setPicking} value={scope} onApply={async (s) => (await applyScope(s)) && setPicking(false)} />
      <Drawer open={histOpen} onOpenChange={setHistOpen} title="Your conversations" width={400}>
        {!history?.length ? (
          <div className="text-[13px] text-ink2">No conversations yet.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {history.map((h) => (
              <Link key={h.id} href={`/app/tutor/${h.id}`} onClick={() => setHistOpen(false)} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-ink hover:bg-surface2 hover:no-underline" style={{ background: h.id === conversationId ? "var(--pri-soft)" : undefined }}>
                <Icon name="forum" size={18} className="text-ink2" />
                <span className="min-w-0 flex-1 truncate font-semibold">{h.title}</span>
                <span className="text-xs text-ink3">{h.updated}</span>
              </Link>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}
