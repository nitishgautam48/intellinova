"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PasswordMeter, passwordScore } from "@/components/auth-shell";
import { avatarColor } from "@/components/student-shell";
import { Confirm, Modal } from "@/components/ui/dialog";
import { Button, Chip, ErrorState, Field, Icon, Input, LinkButton, Loading, PasswordInput, Pill, Select, Toggle } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { toneOf } from "@/lib/utils";

type Profile = {
  name: string; email: string | null; phone: string | null; nickname: string; school: string; city: string; avatar: number;
  board: string; class_level: string; languages: string[]; subject_ids: string[]; subjects: { id: string; name: string }[];
  interests: string[]; goals: string[]; exam_ids: string[]; exams: { id: string; name: string }[]; prefs: Record<string, boolean>; joined: string;
};
type Options = { boards: string[]; classes: string[]; subjects: { id: string; name: string }[]; languages: string[]; interests: string[] };
type Priv = { id: string; kind: string; status: string; created: string; download: boolean };

const SECS = [
  ["academic", "Academic profile", "school"],
  ["prefs", "Learning preferences", "tune"],
  ["interests", "Interests", "interests"],
  ["exams", "Exams", "flag"],
  ["career", "Career exploration", "explore"],
  ["saved", "Saved resources", "bookmark"],
  ["privacy", "Privacy and account", "lock"],
] as const;
const PREFS: [string, string][] = [
  ["short", "Prefer shorter resources when available"],
  ["hinglish", "Show Hinglish resources"],
  ["reminders", "Study reminders"],
  ["weekly", "Weekly progress email"],
  ["share", "Share progress with a parent or teacher"],
  ["research", "Allow anonymised data to improve recommendations"],
];

export default function ProfilePage() {
  const { data: p, error, mutate } = useApi<Profile>("/api/me/profile");
  const [sec, setSec] = useState<(typeof SECS)[number][0]>("academic");
  const [draft, setDraft] = useState<Profile | null>(null);
  const { data: opts } = useApi<Options>(draft ? `/api/me/options?board=${encodeURIComponent(draft.board)}&class_level=${encodeURIComponent(draft.class_level)}` : null, { keepPreviousData: true });
  const { data: priv, mutate: mutPriv } = useApi<Priv[]>(sec === "privacy" ? "/api/me/privacy" : null);
  const { data: saved } = useApi<{ resources: unknown[]; materials: unknown[]; pathways: unknown[] }>(sec === "saved" ? "/api/saved" : null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (p && !draft) setDraft(p);
  }, [p, draft]);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!p || !draft) return <Loading />;

  const save = async (patch: Partial<Profile>, msg = "Saved") => {
    setBusy(true);
    try {
      const r = await api.put<Profile>("/api/me/profile", patch);
      setDraft(r);
      mutate(r, false);
      toast(msg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const tog = (k: "languages" | "subject_ids" | "interests", v: string) =>
    setDraft({ ...draft, [k]: draft[k].includes(v) ? draft[k].filter((x) => x !== v) : [...draft[k], v] });
  const request = async (kind: string) => {
    try {
      await api.post("/api/me/privacy", { kind });
      toast(kind === "Data export" ? "Request sent. You'll be able to download your data here once it's ready." : "Request sent to the IntelliNova team.");
      mutPriv();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const changePw = async () => {
    const { len, num } = passwordScore(pw);
    if (!len || !num) return toast.error("Use at least 8 characters including a number.");
    try {
      await api.post("/api/auth/change-password", { password: pw });
      setPwOpen(false);
      setPw("");
      toast("Password changed");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const initials = (p.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex min-w-[220px] flex-[0_1_240px] flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-[52px] w-[52px] place-items-center rounded-full text-lg font-bold text-white" style={{ background: avatarColor(p.avatar) }}>
            {initials}
          </div>
          <div>
            <div className="font-display text-lg font-semibold">{p.name}</div>
            <div className="text-[13px] text-ink2">{[p.class_level, p.board].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {SECS.map(([k, l, icon]) => (
            <button key={k} onClick={() => setSec(k)} className="flex h-10 items-center gap-2.5 rounded-[10px] border-0 px-3 text-left font-semibold" style={{ background: sec === k ? "var(--pri-soft)" : "transparent", color: sec === k ? "var(--pri-ink)" : "var(--ink)" }}>
              <Icon name={icon} size={19} />
              {l}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[18px] rounded-[18px] border border-line bg-surface p-6">
        {sec === "academic" && (
          <div className="flex flex-col gap-4">
            <div className="font-display text-xl font-semibold">Academic profile</div>
            <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
              <Field label="Full name">
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Tutor calls you">
                <Input value={draft.nickname} onChange={(e) => setDraft({ ...draft, nickname: e.target.value })} />
              </Field>
              <Field label="Board">
                <Select value={draft.board} onChange={(e) => setDraft({ ...draft, board: e.target.value, subject_ids: [] })}>
                  {[...new Set([draft.board, ...(opts?.boards || []), "CBSE", "ICSE", "State board", "IB / IGCSE", "Other"])].filter(Boolean).map((b) => <option key={b}>{b}</option>)}
                </Select>
              </Field>
              <Field label="Class">
                <Select value={draft.class_level} onChange={(e) => setDraft({ ...draft, class_level: e.target.value, subject_ids: [] })}>
                  {[...new Set([draft.class_level, "Class 9", "Class 10", "Class 11", "Class 12", "Starting college", ...(opts?.classes || [])])].filter(Boolean).map((c) => <option key={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="School">
                <Input value={draft.school} onChange={(e) => setDraft({ ...draft, school: e.target.value })} />
              </Field>
              <Field label="City">
                <Input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
              </Field>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold">Languages</div>
              <div className="flex flex-wrap gap-1.5">
                {(opts?.languages || []).map((l) => <Chip key={l} on={draft.languages.includes(l)} onClick={() => tog("languages", l)}>{l}</Chip>)}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold">Subjects</div>
              {opts?.subjects.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {opts.subjects.map((s) => <Chip key={s.id} on={draft.subject_ids.includes(s.id)} onClick={() => tog("subject_ids", s.id)}>{s.name}</Chip>)}
                </div>
              ) : (
                <div className="text-[13px] text-ink2">No subjects are published for {draft.board} {draft.class_level} yet.</div>
              )}
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold">Profile colour</div>
              <div className="flex gap-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <button key={i} onClick={() => setDraft({ ...draft, avatar: i })} aria-label={`Colour ${i + 1}`} className="h-7 w-7 rounded-full border-0" style={{ background: avatarColor(i), boxShadow: i === draft.avatar ? `0 0 0 2px var(--surface),0 0 0 4px ${avatarColor(i)}` : "none" }} />
                ))}
              </div>
            </div>
            <Button variant="primary" className="self-start" loading={busy} onClick={() => save({ name: draft.name, nickname: draft.nickname, board: draft.board, class_level: draft.class_level, school: draft.school, city: draft.city, languages: draft.languages, subject_ids: draft.subject_ids, avatar: draft.avatar })}>
              Save changes
            </Button>
          </div>
        )}

        {sec === "prefs" && (
          <div className="flex flex-col gap-1">
            <div className="mb-2 font-display text-xl font-semibold">Learning preferences</div>
            {PREFS.map(([k, l]) => (
              <label key={k} className="flex cursor-pointer items-center justify-between gap-4 border-t border-line py-3.5 font-medium">
                {l}
                <Toggle on={!!p.prefs[k]} onChange={(v) => save({ prefs: { [k]: v } } as Partial<Profile>, "Preference saved")} label={l} />
              </label>
            ))}
          </div>
        )}

        {sec === "interests" && (
          <div className="flex flex-col gap-3">
            <div className="font-display text-xl font-semibold">Interests</div>
            <div className="text-[13px] text-ink2">Used only for Career Explorer suggestions.</div>
            <div className="flex flex-wrap gap-1.5">
              {(opts?.interests || []).map((x) => <Chip key={x} on={draft.interests.includes(x)} onClick={() => tog("interests", x)}>{x}</Chip>)}
            </div>
            <Button variant="primary" className="self-start" loading={busy} onClick={() => save({ interests: draft.interests })}>
              Save interests
            </Button>
          </div>
        )}

        {sec === "exams" && (
          <div className="flex flex-col gap-3">
            <div className="font-display text-xl font-semibold">Exams</div>
            {p.exams.map((e) => (
              <div key={e.id} className="flex items-center justify-between rounded-xl border border-line p-3.5">
                <div className="font-bold">{e.name}</div>
                <LinkButton href={`/app/exam/${e.id}`} size="sm">Manage</LinkButton>
              </div>
            ))}
            {!p.exams.length && <div className="text-[13px] text-ink2">You&apos;re not following any exams.</div>}
            <Link href="/app/exam?switch=1" className="self-start font-bold">+ Add an exam</Link>
          </div>
        )}

        {sec === "career" && (
          <div className="flex flex-col gap-3">
            <div className="font-display text-xl font-semibold">Career exploration</div>
            <div className="text-sm text-ink2">Your interests and saved pathways live in the Career Explorer.</div>
            <div className="flex gap-2">
              <LinkButton href="/app/career?view=interests">Update interests</LinkButton>
              <LinkButton href="/app/career?view=compare">Open comparison</LinkButton>
            </div>
          </div>
        )}

        {sec === "saved" && (
          <div className="flex flex-col gap-3">
            <div className="font-display text-xl font-semibold">Saved resources</div>
            <div className="text-ink2">{saved ? `${saved.resources.length} resources, ${saved.materials.length} study materials, ${saved.pathways.length} pathways.` : "…"}</div>
            <LinkButton href="/app/saved" className="self-start">Go to Saved</LinkButton>
          </div>
        )}

        {sec === "privacy" && (
          <div className="flex flex-col gap-3.5">
            <div className="font-display text-xl font-semibold">Privacy and account</div>
            <div className="flex justify-between border-t border-line py-3">
              <span>{p.email ? "Email" : "Mobile"}</span>
              <span className="text-ink2">{p.email || p.phone}</span>
            </div>
            <div className="flex justify-between border-t border-line py-3">
              <span>Member since</span>
              <span className="text-ink2">{p.joined}</span>
            </div>
            <div className="flex justify-between border-t border-line py-3">
              <span>Password</span>
              <button onClick={() => setPwOpen(true)} className="border-0 bg-transparent p-0 font-semibold text-pri-ink">Change</button>
            </div>
            <div className="flex justify-between border-t border-line py-3">
              <span>Download my data</span>
              <button onClick={() => request("Data export")} className="border-0 bg-transparent p-0 font-semibold text-pri-ink">Request</button>
            </div>
            <div className="flex justify-between border-t border-line py-3">
              <span>Correct something we hold about you</span>
              <button onClick={() => request("Data correction")} className="border-0 bg-transparent p-0 font-semibold text-pri-ink">Request</button>
            </div>
            {!!priv?.length && (
              <div className="rounded-xl border border-line">
                {priv.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 text-[13px] last:border-b-0">
                    <span className="flex-1 font-semibold">{r.kind}</span>
                    <span className="text-ink2">{r.created}</span>
                    <Pill tone={r.status === "completed" ? "ok" : r.status === "rejected" ? "err" : "pri"}>{r.status}</Pill>
                    {r.download && <a href={`/api/me/privacy/${r.id}/download`} className="font-semibold">Download</a>}
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-err-soft p-4">
              <div>
                <div className="font-bold text-err-ink">Delete account</div>
                <div className="text-xs text-ink2">Removes progress, notes and saved items permanently.</div>
              </div>
              <button onClick={() => setDelOpen(true)} className="h-9 rounded-[9px] border border-err bg-transparent px-3.5 font-bold text-err-ink">Delete</button>
            </div>
          </div>
        )}
      </div>

      <Modal open={pwOpen} onOpenChange={setPwOpen} title="Change password" footer={<Button variant="solid" onClick={changePw}>Save password</Button>}>
        <div className="flex flex-col gap-3">
          <Field label="New password">
            <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </Field>
          <PasswordMeter pw={pw} />
        </div>
      </Modal>
      <Confirm open={delOpen} onOpenChange={setDelOpen} title="Delete your account?" danger confirmLabel="Request deletion" onConfirm={async () => (setDelOpen(false), await request("Account deletion"))}>
        Your request goes to the IntelliNova team, who delete your account and all personal data within 30 days. You&apos;ll lose your progress, notes and saved items. This can&apos;t be undone.
      </Confirm>
    </div>
  );
}
