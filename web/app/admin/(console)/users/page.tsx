"use client";

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FilterChips, Panel, StatusPill } from "@/components/admin/kit";
import { Alert, Button, ErrorState, Field, Icon, Input, Loading, Select, Textarea } from "@/components/ui";
import { Confirm, Modal } from "@/components/ui/dialog";
import { api, qs, useApi } from "@/lib/api";

type URow = { id: string; n: string; e: string; c: string; r: string; j: string; a: string; s: string; ini: string };
type Users = { stats: { l: string; v: string; icon: string }[]; rows: URow[] };
type Invite = { id: string; email: string; role: string; expires: string; expired: boolean; sent: string };
type Priv = { id: string; t: string; n: string; d: string; icon: string; details: string; status: string; download: boolean };
type Me = { id: string; role: string };

const ROLES = ["All", "Student", "Curator", "Admin"] as const;
const COLS = "2.2fr 1.3fr .8fr 1fr .9fr .9fr 36px";

function RowMenu({ u, me, onDone }: { u: URow; me: Me; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; body_json: Record<string, string>; danger?: boolean }>(null);
  if (me.role !== "admin" || u.s === "Invited") return <span />;
  const self = u.id === me.id;
  const role = u.r.toLowerCase();
  const items: { l: string; icon: string; body: Record<string, string>; title: string; text: string; danger?: boolean }[] = [];
  if (!self) {
    for (const r of ["student", "curator", "admin"]) {
      if (r !== role) items.push({ l: `Make ${r}`, icon: r === "admin" ? "shield_person" : r === "curator" ? "edit_note" : "school", body: { role: r }, title: `Make ${u.n} ${r === "admin" ? "an" : "a"} ${r}?`, text: r === "student" ? "They lose access to the admin console." : r === "admin" ? "Admins can invite staff, change roles and handle privacy requests." : "Curators can edit content but can't manage users." });
    }
    if (u.s === "Suspended") items.push({ l: "Reactivate", icon: "lock_open", body: { status: "active" }, title: `Reactivate ${u.n}?`, text: "They can sign in again." });
    else items.push({ l: "Suspend", icon: "block", body: { status: "suspended" }, title: `Suspend ${u.n}?`, text: "They are signed out on their next request and can't sign in until reactivated. Their data is kept.", danger: true });
  }
  if (!items.length) return <span />;
  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger aria-label="More actions" className="grid h-[30px] w-[30px] place-items-center rounded-lg border-0 bg-transparent text-ink2 hover:bg-surface2">
          <Icon name="more_horiz" size={18} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={4} className="z-50 w-[200px] rounded-xl border border-line bg-surface p-1 shadow-card">
            {items.map((it) => (
              <button key={it.l} onClick={() => (setOpen(false), setConfirm({ title: it.title, body: it.text, body_json: it.body, danger: it.danger }))} className="flex w-full items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-semibold hover:bg-surface2" style={{ color: it.danger ? "var(--err-ink)" : undefined }}>
                <Icon name={it.icon} size={18} />
                {it.l}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Confirm open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title || ""} danger={confirm?.danger} onConfirm={async () => {
        const c = confirm!;
        setConfirm(null);
        try {
          await api.patch(`/api/admin/users/${u.id}`, c.body_json);
          toast.success("Updated");
          onDone();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}>
        {confirm?.body}
      </Confirm>
    </>
  );
}

function InviteModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("curator");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ link: string; email_sent: boolean } | null>(null);
  useEffect(() => {
    if (open) (setEmail(""), setRole("curator"), setRes(null));
  }, [open]);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ link: string; email_sent: boolean }>("/api/admin/invites", { email: email.trim(), role });
      setRes(r);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Invite staff" sub="Staff sign up with the invite link. Links are single-use and expire." width={480} footer={
      res ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={send} icon="send">Send invite</Button></>
    }>
      {res ? (
        <div className="flex flex-col gap-3">
          <Alert tone={res.email_sent ? "ok" : "warn"}>{res.email_sent ? `Invite emailed to ${email}.` : "The email couldn't be sent (check SMTP settings). Share this link directly instead."}</Alert>
          <Field label="Invite link">
            <div className="flex gap-2">
              <Input readOnly value={res.link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button icon="content_copy" onClick={() => navigator.clipboard.writeText(res.link).then(() => toast.success("Copied"))}>Copy</Button>
            </div>
          </Field>
        </div>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), send())} className="flex flex-col gap-3">
          <Field label="Email"><Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@school.org" /></Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="curator">Curator: edits curriculum, resources, exams and career data</option>
              <option value="admin">Admin: also manages users, invites and privacy requests</option>
            </Select>
          </Field>
        </form>
      )}
    </Modal>
  );
}

function PrivacyModal({ p, onClose, onDone }: { p: Priv | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (!p) return null;
  const act = async (action: "complete" | "reject") => {
    setBusy(action);
    try {
      await api.post(`/api/admin/privacy/${p.id}`, { action });
      toast.success(action === "reject" ? "Request rejected" : p.t === "Data export" ? "Export ready to download" : "Request completed");
      onDone();
      if (p.t !== "Data export" || action === "reject") onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const what = {
    "Data export": "Builds a JSON file of everything stored about this student. Download it and send it to them.",
    "Account deletion": "Deletes the login and all personal data (profile, progress, notes, chats). This can't be undone.",
    "Data correction": "Make the correction the student asked for, then mark it complete.",
  }[p.t];
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${p.t} · ${p.n}`} sub={p.status === "open" ? p.d : `Status: ${p.status}`} width={520} footer={
      <>
        {p.download && <Button icon="download" onClick={() => window.open(`/api/admin/privacy/${p.id}/download`, "_blank")}>Download export</Button>}
        {p.status === "open" && (
          <>
            <Button variant="danger" loading={busy === "reject"} onClick={() => act("reject")}>Reject</Button>
            <Button variant="primary" loading={busy === "complete"} onClick={() => (p.t === "Account deletion" ? setConfirm(true) : act("complete"))}>
              {p.t === "Data export" ? "Generate export" : p.t === "Account deletion" ? "Delete account" : "Mark complete"}
            </Button>
          </>
        )}
      </>
    }>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="text-ink2">{what}</div>
        {p.details && (
          <div>
            <div className="mb-1 text-xs font-bold text-ink2">Student&apos;s note</div>
            <div className="whitespace-pre-wrap rounded-lg bg-bg px-3 py-2">{p.details}</div>
          </div>
        )}
      </div>
      <Confirm open={confirm} onOpenChange={setConfirm} title="Delete this account permanently?" danger confirmLabel="Delete account" onConfirm={() => (setConfirm(false), act("complete"))}>
        {p.n}&apos;s login and all their data will be erased.
      </Confirm>
    </Modal>
  );
}

export default function UsersPage() {
  const { data: me } = useApi<Me>("/api/auth/me");
  const isAdmin = me?.role === "admin";
  const [q, setQ] = useState("");
  const [qd, setQd] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("All");
  useEffect(() => {
    const t = setTimeout(() => setQd(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const users = useApi<Users>(`/api/admin/users${qs({ q: qd, role })}`, { keepPreviousData: true });
  const invites = useApi<Invite[]>(isAdmin ? "/api/admin/invites" : null);
  const [privStatus, setPrivStatus] = useState<"open" | "all">("open");
  const priv = useApi<Priv[]>(isAdmin ? `/api/admin/privacy?status=${privStatus}` : null);
  const [inviting, setInviting] = useState(false);
  const [openPriv, setOpenPriv] = useState<Priv | null>(null);
  const [revoke, setRevoke] = useState<Invite | null>(null);

  if (users.error) return <ErrorState error={users.error} retry={() => users.mutate()} />;
  if (!users.data || !me) return <Loading />;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        {users.data.stats.map((x) => (
          <div key={x.l} className="flex items-center gap-3 rounded-[14px] border border-line bg-surface p-4">
            <div className="grid h-[38px] w-[38px] place-items-center rounded-[10px] bg-surface2 text-ink2"><Icon name={x.icon} /></div>
            <div>
              <div className="font-display text-[22px] font-semibold leading-none">{x.v}</div>
              <div className="mt-1 text-xs text-ink2">{x.l}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-[38px] min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3">
              <Icon name="search" size={18} className="text-ink3" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="min-w-0 flex-1 border-0 bg-transparent outline-none" />
            </label>
            <FilterChips value={role} onChange={setRole} options={ROLES.map((r) => ({ v: r }))} />
            {isAdmin && <Button variant="primary" icon="person_add" onClick={() => setInviting(true)}>Invite staff</Button>}
          </div>
          <div className="overflow-auto rounded-[14px] border border-line bg-surface">
            <div className="min-w-[720px]">
              <div className="grid gap-2.5 bg-surface2 px-4 py-3 font-mono text-[11px] font-semibold uppercase text-ink2" style={{ gridTemplateColumns: COLS }}>
                <span>User</span><span>Class · board</span><span>Role</span><span>Joined</span><span>Last active</span><span>Status</span><span />
              </div>
              {users.data.rows.map((u) => (
                <div key={u.id} className="grid items-center gap-2.5 border-t border-line px-4 py-2.5 text-[13px]" style={{ gridTemplateColumns: COLS }}>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-teal-soft text-xs font-bold text-teal-ink">{u.ini}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold">{u.n}{u.id === me.id && <span className="ml-1.5 text-xs font-medium text-ink2">(you)</span>}</span>
                      <span className="block truncate font-mono text-[11px] text-ink2">{u.e}</span>
                    </span>
                  </span>
                  <span>{u.c}</span>
                  <span>{u.r}</span>
                  <span className="font-mono text-xs text-ink2">{u.j}</span>
                  <span className="text-ink2">{u.a}</span>
                  <span><StatusPill s={u.s} /></span>
                  <RowMenu u={u} me={me} onDone={() => (users.mutate(), invites.mutate())} />
                </div>
              ))}
              {!users.data.rows.length && (
                <div className="border-t border-line p-8 text-center text-ink2">
                  <div className="font-bold text-ink">No users match</div>Try a different name, email or role.
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
          {isAdmin ? (
            <>
              <Panel title="Privacy requests" sub="Raised from student Profile › Privacy and account" right={<FilterChips size="sm" value={privStatus} onChange={setPrivStatus} options={[{ v: "open", l: "Open" }, { v: "all", l: "All" }]} />}>
                {priv.data?.length ? (
                  priv.data.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 border-t border-line py-2.5">
                      <Icon name={p.icon} className="text-ink2" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{p.t} · {p.n}</div>
                        <div className="text-xs" style={{ color: p.status === "open" ? "var(--warn-ink)" : "var(--ink2)" }}>{p.status === "open" ? p.d : p.status}</div>
                      </div>
                      <Button size="xs" onClick={() => setOpenPriv(p)}>Open</Button>
                    </div>
                  ))
                ) : (
                  <div className="border-t border-line py-3 text-[13px] text-ink2">{priv.data ? "No requests." : "Loading…"}</div>
                )}
              </Panel>
              <Panel title="Pending invites">
                {invites.data?.length ? (
                  invites.data.map((i) => (
                    <div key={i.id} className="flex items-center gap-3 border-t border-line py-2.5">
                      <Icon name="mail" className="text-ink2" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{i.email}</div>
                        <div className="text-xs text-ink2">{i.role} · sent {i.sent} · {i.expired ? <span className="text-err-ink">expired</span> : `expires ${i.expires}`}</div>
                      </div>
                      <Button size="xs" variant="ghost" onClick={() => setRevoke(i)}>Revoke</Button>
                    </div>
                  ))
                ) : (
                  <div className="border-t border-line py-3 text-[13px] text-ink2">{invites.data ? "No pending invites." : "Loading…"}</div>
                )}
              </Panel>
            </>
          ) : (
            <Panel title="Staff management">
              <div className="text-[13px] text-ink2">Only admins can invite staff, change roles or handle privacy requests.</div>
            </Panel>
          )}
        </div>
      </div>
      <InviteModal open={inviting} onClose={() => setInviting(false)} onDone={() => (invites.mutate(), users.mutate())} />
      <PrivacyModal p={openPriv} onClose={() => setOpenPriv(null)} onDone={() => {
        priv.mutate().then((list) => {
          const fresh = list?.find((x) => x.id === openPriv?.id);
          if (fresh && openPriv) setOpenPriv(fresh);
        });
        users.mutate();
      }} />
      <Confirm open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)} title="Revoke this invite?" danger confirmLabel="Revoke" onConfirm={async () => {
        const i = revoke!;
        setRevoke(null);
        try {
          await api.del(`/api/admin/invites/${i.id}`);
          toast.success("Invite revoked");
          invites.mutate();
          users.mutate();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}>
        The link sent to {revoke?.email} will stop working.
      </Confirm>
    </div>
  );
}
