"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthShell, AuthTitle, PasswordMeter, passwordScore } from "@/components/auth-shell";
import { BackLink, LocalMailHint } from "@/components/student-auth";
import { Alert, Button, Checkbox, Empty, Field, Icon, Input, Loading, PasswordInput, Pill } from "@/components/ui";
import { api, ApiError, safeNext, useApi } from "@/lib/api";

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function AdminLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [mode, setMode] = useState<"login" | "forgot" | "sent">(params.get("mode") === "forgot" ? "forgot" : "login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: settings } = useApi<{ admin_bootstrap: boolean }>("/api/auth/settings");

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk(email)) return setErr("Enter a valid email address.");
    if (!pw) return setErr("Enter your password.");
    setBusy(true);
    setErr("");
    try {
      await api.post("/api/auth/login", { email, password: pw, remember, portal: "admin" });
      router.replace(safeNext(next, true));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't log in");
    } finally {
      setBusy(false);
    }
  };

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk(email)) return setErr("Enter your admin email address.");
    setBusy(true);
    try {
      await api.post("/api/auth/recover", { email, portal: "admin" });
      setMode("sent");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't send the link");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell variant="admin">
      {mode === "login" && (
        <form className="flex flex-col gap-[18px]" onSubmit={login}>
          <div className="flex items-center gap-2">
            <Pill tone="teal" icon="shield_person">
              Admin console
            </Pill>
          </div>
          <AuthTitle title="Log in to the admin console" sub="For teachers and content teams who manage curriculum, resources and quality." />
          {settings?.admin_bootstrap && (
            <Alert tone="pri" icon="rocket_launch">
              This is a new installation with no admin yet. <Link href="/admin/signup">Create the first admin account</Link>.
            </Alert>
          )}
          <Field label="Work email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.org" autoComplete="email" />
          </Field>
          <Field
            label="Password"
            right={
              <button type="button" onClick={() => (setErr(""), setMode("forgot"))} className="border-0 bg-transparent p-0 text-[13px] font-semibold text-pri-ink">
                Forgot password?
              </button>
            }
          >
            <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </Field>
          <Checkbox checked={remember} onChange={setRemember} className="items-center">
            Keep me logged in on this device
          </Checkbox>
          {err && <Alert>{err}</Alert>}
          <Button type="submit" variant="cta" size="xl" loading={busy}>
            Log in
          </Button>
          <div className="text-center text-sm text-ink2">
            Have an invite?{" "}
            <Link href="/admin/signup" className="font-bold">
              Create your admin account
            </Link>
          </div>
          <div className="text-center text-xs text-ink3">
            Looking for the student app? <Link href="/login">Student log in</Link>
          </div>
        </form>
      )}
      {mode === "forgot" && (
        <form className="flex flex-col gap-[18px]" onSubmit={forgot}>
          <BackLink onClick={() => setMode("login")}>Back to log in</BackLink>
          <AuthTitle title="Reset your password" sub="We'll email you a link to choose a new password." />
          <Field label="Work email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          {err && <Alert>{err}</Alert>}
          <Button type="submit" variant="cta" size="xl" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      {mode === "sent" && (
        <div className="flex flex-col gap-[18px]">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ok-soft">
            <Icon name="mark_email_read" size={28} style={{ color: "var(--ok)" }} />
          </span>
          <AuthTitle title="Check your inbox" sub={<>A reset link is on its way to <b className="text-ink">{email}</b>. It expires in one hour.</>} />
          <LocalMailHint />
          <Button variant="cta" size="xl" onClick={() => setMode("login")}>
            Back to log in
          </Button>
        </div>
      )}
    </AuthShell>
  );
}

type Invite = { email: string; role: string; expires_at: string };

export function AdminSignup() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("invite");
  const { data: settings, isLoading: sLoading } = useApi<{ admin_bootstrap: boolean; admin_bootstrap_needs_token: boolean }>("/api/auth/settings");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteErr, setInviteErr] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [setup, setSetup] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .get<Invite>(`/api/auth/admin/invite/${encodeURIComponent(token)}`)
      .then((i) => {
        setInvite(i);
        setEmail(i.email);
      })
      .catch((e: ApiError) => setInviteErr(e.message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { len, num } = passwordScore(pw);
    if (name.trim().length < 2) return setErr("Enter your full name.");
    if (!emailOk(email)) return setErr("Enter a valid email address.");
    if (!len || !num) return setErr("Use at least 8 characters including a number.");
    setBusy(true);
    setErr("");
    try {
      await api.post("/api/auth/admin/signup", { name, email, password: pw, invite_token: token || undefined, bootstrap_token: setup || undefined });
      router.replace("/admin");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't create the account");
    } finally {
      setBusy(false);
    }
  };

  if (sLoading || (token && !invite && !inviteErr)) return <AuthShell variant="admin"><Loading /></AuthShell>;

  const bootstrap = !token && settings?.admin_bootstrap;
  if (!token && !bootstrap) {
    return (
      <AuthShell variant="admin">
        <Empty icon="lock" title="Admin accounts are invite-only" action={<Link href="/admin/login" className="font-bold">Go to admin log in</Link>}>
          Ask an existing admin to invite you from <b>Admin console › Users</b>. The invite email has a link that opens this page.
        </Empty>
      </AuthShell>
    );
  }
  if (inviteErr) {
    return (
      <AuthShell variant="admin">
        <Empty icon="link_off" title="This invite can't be used" action={<Link href="/admin/login" className="font-bold">Go to admin log in</Link>}>
          {inviteErr}
        </Empty>
      </AuthShell>
    );
  }

  return (
    <AuthShell variant="admin">
      <form className="flex flex-col gap-[18px]" onSubmit={submit}>
        <div className="flex items-center gap-2">
          <Pill tone="teal" icon="shield_person">
            {bootstrap ? "First-time setup" : `Invited as ${invite?.role === "admin" ? "Admin" : "Curator"}`}
          </Pill>
        </div>
        <AuthTitle
          title={bootstrap ? "Create the first admin account" : "Create your admin account"}
          sub={bootstrap ? "This account can invite curators and other admins. Later sign-ups need an invite." : "Set your name and a password to accept the invite."}
        />
        <Field label="Full name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Work email" hint={invite ? "The invite is tied to this address." : undefined}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={!!invite} className={invite ? "text-ink2" : ""} autoComplete="email" />
        </Field>
        <Field label="Password">
          <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
        </Field>
        <PasswordMeter pw={pw} />
        {bootstrap && settings?.admin_bootstrap_needs_token && (
          <Field label="Setup token" hint="Set as ADMIN_BOOTSTRAP_TOKEN in the server's .env file.">
            <Input value={setup} onChange={(e) => setSetup(e.target.value)} className="font-mono" />
          </Field>
        )}
        {err && <Alert>{err}</Alert>}
        <Button type="submit" variant="cta" size="xl" loading={busy}>
          Create account
        </Button>
        <div className="text-center text-sm text-ink2">
          Already set up? <Link href="/admin/login" className="font-bold">Log in</Link>
        </div>
      </form>
    </AuthShell>
  );
}
