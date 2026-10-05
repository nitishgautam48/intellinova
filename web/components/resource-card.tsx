"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Modal } from "@/components/ui/dialog";
import { Button, Field, Icon, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";

export type ResourceCardT = {
  id: string;
  title: string;
  creator: string;
  type: string;
  icon: string;
  dur: string;
  diff: string;
  lang: string;
  thumb: string;
  url: string;
  platform: string;
  why: string;
  topics: string[];
  unavailable: boolean;
  saved: boolean;
  helpful: "up" | "down" | null;
  progress: string | null;
  /** Found automatically on YouTube (not hand-picked by the content team). */
  auto?: boolean;
};

export function AutoBadge({ className }: { className?: string }) {
  return (
    <span title="Found automatically on YouTube and checked against your syllabus" className={`inline-flex items-center gap-1 rounded-md bg-surface px-2 py-[3px] text-[11px] font-semibold text-ink2 ${className || ""}`}>
      <Icon name="travel_explore" size={14} />
      Auto-found
    </span>
  );
}

export function useResourceActions(r: ResourceCardT, onChange?: () => void) {
  const [saved, setSaved] = useState(r.saved);
  const [helpful, setHelpful] = useState(r.helpful);
  const [done, setDone] = useState(r.progress === "completed");
  const toggleSave = async () => {
    const on = !saved;
    setSaved(on);
    try {
      if (on) await api.post("/api/saved", { kind: "resource", ref_id: r.id, label: r.title });
      else await api.del(`/api/saved/resource/${r.id}`);
      toast(on ? "Saved to your library" : "Removed from Saved");
      onChange?.();
    } catch (e) {
      setSaved(!on);
      toast.error((e as Error).message);
    }
  };
  const rate = async (v: "up" | "down") => {
    const nv = helpful === v ? null : v;
    setHelpful(nv);
    await api.post(`/api/resources/${r.id}/feedback`, { helpful: nv }).catch(() => {});
    toast("Thanks — this tunes your recommendations");
  };
  const open = () => {
    api.post(`/api/resources/${r.id}/progress`, { status: "started" }).catch(() => {});
    api.get(`/api/resources/${r.id}`).catch(() => {});
    window.open(r.url, "_blank", "noopener");
  };
  const complete = async () => {
    setDone(true);
    await api.post(`/api/resources/${r.id}/progress`, { status: "completed" }).catch(() => {});
    toast("Marked as finished");
    onChange?.();
  };
  return { saved, helpful, done, toggleSave, rate, open, complete };
}

function Thumb({ r, big }: { r: ResourceCardT; big?: boolean }) {
  return (
    <div
      className="relative grid place-items-center overflow-hidden"
      style={{ aspectRatio: big ? "16/9" : "16/8", background: "repeating-linear-gradient(135deg,var(--surface2) 0 10px,var(--stripe) 10px 20px)" }}
    >
      {r.thumb && !r.unavailable ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="font-mono text-[11px] font-medium text-ink3">{r.unavailable ? "unavailable" : r.platform}</span>
      )}
      <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-md bg-surface px-2 py-[3px] text-[11px] font-semibold text-ink">
        <Icon name={r.icon} size={14} />
        {r.type}
      </span>
      {r.auto && <AutoBadge className="absolute right-2.5 top-2.5" />}
    </div>
  );
}

export function ReportButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Link is broken or video removed");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/api/resources/${id}/report`, { reason, note });
      toast("Reported. The content team will take a look.");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Report a problem" className="grid h-[34px] w-[34px] place-items-center rounded-[9px] border-0 bg-transparent text-ink3 hover:bg-surface2">
        <Icon name="flag" size={18} />
      </button>
      <Modal open={open} onOpenChange={setOpen} title="Report a problem" sub="Tell us what's wrong with this resource." footer={<Button variant="solid" loading={busy} onClick={send}>Send report</Button>}>
        <div className="flex flex-col gap-3">
          <Field label="What's wrong?">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {["Link is broken or video removed", "Tagged to the wrong class or chapter", "Contains a factual error", "Poor quality or hard to follow", "Inappropriate content", "Other"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="Details (optional)">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything that helps us fix it" />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/** Compact card (dashboard, alternatives, saved). */
export function ResourceCard({ r, onChange }: { r: ResourceCardT; onChange?: () => void }) {
  const a = useResourceActions(r, onChange);
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface" style={{ opacity: r.unavailable ? 0.6 : 1 }}>
      <Thumb r={r} />
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="font-semibold leading-[1.3]">{r.title}</div>
        <div className="text-xs text-ink2">{[r.creator, r.dur, r.lang].filter(Boolean).join(" · ")}</div>
        {r.unavailable ? (
          <div className="flex gap-1.5 rounded-[10px] bg-err-soft px-2.5 py-2 text-xs text-err-ink">
            <Icon name="link_off" size={16} /> No longer available. The content team has been told.
          </div>
        ) : (
          r.why && (
            <div className="flex gap-1.5 rounded-[10px] bg-teal-soft px-2.5 py-2 text-xs text-teal-ink">
              <Icon name="lightbulb" size={16} className="mt-px" />
              {r.why}
            </div>
          )
        )}
        <div className="mt-auto flex items-center justify-between pt-1">
          {!r.unavailable ? (
            <button onClick={a.open} className="border-0 bg-transparent p-0 font-semibold text-pri-ink">
              Open
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1">
            <button onClick={() => a.rate("up")} aria-label="Helpful" className="grid h-[34px] w-[34px] place-items-center rounded-[9px] border-0 bg-transparent hover:bg-surface2" style={{ color: a.helpful === "up" ? "var(--ok)" : "var(--ink3)" }}>
              <Icon name="thumb_up" size={18} fill={a.helpful === "up"} />
            </button>
            <button onClick={a.toggleSave} aria-label={a.saved ? "Remove from saved" : "Save"} className="grid h-[34px] w-[34px] place-items-center rounded-[9px] border border-line bg-surface" style={{ color: a.saved ? "var(--pri)" : "var(--ink2)" }}>
              <Icon name="bookmark" size={19} fill={a.saved} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Large "best match" card (search results, chapter view). */
export function BestResource({ r, whyList, allTopics, onChange }: { r: ResourceCardT; whyList?: string[]; allTopics?: string[]; onChange?: () => void }) {
  const a = useResourceActions(r, onChange);
  return (
    <div className="flex flex-wrap overflow-hidden rounded-[20px] border border-line bg-surface">
      <div className="min-w-0 flex-[1_1_300px]">
        <Thumb r={r} big />
      </div>
      <div className="flex min-w-0 flex-[1.3_1_340px] flex-col gap-3 p-5">
        <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-pri-ink">BEST MATCH FOR YOU</div>
        <div className="font-display text-[22px] font-semibold leading-tight">{r.title}</div>
        <div className="text-[13px] text-ink2">{[r.creator, r.dur, r.diff, r.lang].filter(Boolean).join(" · ")}</div>
        {(whyList?.length || r.why) && (
          <div className="flex flex-col gap-1.5 rounded-xl bg-teal-soft p-3 text-[13px] text-teal-ink">
            {(whyList?.length ? whyList : [r.why]).map((w) => (
              <div key={w} className="flex gap-2">
                <Icon name="check" size={16} className="mt-0.5" />
                {w}
              </div>
            ))}
          </div>
        )}
        {!!(allTopics?.length || r.topics.length) && (
          <div className="flex flex-wrap gap-1.5">
            {(allTopics || r.topics).map((t) => (
              <span key={t} className="rounded-md border px-2 py-0.5 text-[11px]" style={{ borderColor: r.topics.includes(t) ? "var(--pri)" : "var(--line)", color: r.topics.includes(t) ? "var(--pri-ink)" : "var(--ink3)" }}>
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" size="lg" icon="play_arrow" onClick={a.open} disabled={r.unavailable}>
            {r.progress ? "Continue" : "Start"}
          </Button>
          <Button size="lg" icon="bookmark" onClick={a.toggleSave} style={{ color: a.saved ? "var(--pri-ink)" : undefined }}>
            {a.saved ? "Saved" : "Save"}
          </Button>
          {r.progress === "started" && !a.done && (
            <Button size="lg" variant="ghost" icon="task_alt" onClick={a.complete}>
              I finished it
            </Button>
          )}
          <span className="flex-1" />
          <span className="text-xs text-ink3">Helpful?</span>
          <button onClick={() => a.rate("up")} aria-label="Helpful" className="grid h-[34px] w-[34px] place-items-center rounded-[9px] border-0 bg-transparent hover:bg-surface2" style={{ color: a.helpful === "up" ? "var(--ok)" : "var(--ink3)" }}>
            <Icon name="thumb_up" size={18} fill={a.helpful === "up"} />
          </button>
          <button onClick={() => a.rate("down")} aria-label="Not helpful" className="grid h-[34px] w-[34px] place-items-center rounded-[9px] border-0 bg-transparent hover:bg-surface2" style={{ color: a.helpful === "down" ? "var(--err)" : "var(--ink3)" }}>
            <Icon name="thumb_down" size={18} fill={a.helpful === "down"} />
          </button>
          <ReportButton id={r.id} />
        </div>
      </div>
    </div>
  );
}

/** Row style used for alternatives lists. */
export function ResourceRow({ r, onChange }: { r: ResourceCardT; onChange?: () => void }) {
  const a = useResourceActions(r, onChange);
  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-line bg-surface p-3.5" style={{ opacity: r.unavailable ? 0.6 : 1 }}>
      <span className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-surface2 text-ink2">
        <Icon name={r.icon} size={24} />
      </span>
      <div className="min-w-[200px] flex-1">
        <div className="font-semibold">{r.title}</div>
        <div className="text-xs text-ink2">{[r.creator, r.type, r.dur, r.diff, r.lang, r.auto ? "Auto-found" : ""].filter(Boolean).join(" · ")}</div>
        {r.unavailable ? (
          <div className="mt-1 text-xs text-err-ink">No longer available</div>
        ) : (
          r.why && <div className="mt-1 text-xs text-teal-ink">{r.why}</div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!r.unavailable && (
          <Button size="sm" onClick={a.open}>
            Open
          </Button>
        )}
        <button onClick={a.toggleSave} aria-label="Save" className="grid h-[34px] w-[34px] place-items-center rounded-[9px] border border-line bg-surface" style={{ color: a.saved ? "var(--pri)" : "var(--ink2)" }}>
          <Icon name="bookmark" size={19} fill={a.saved} />
        </button>
      </div>
    </div>
  );
}
