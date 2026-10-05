"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AuthShell, AuthTitle, GoogleMark, OrDivider, OtpInput, PasswordMeter, SocialButton, passwordScore } from "@/components/auth-shell";
import { Alert, Button, Checkbox, Field, Icon, Input, PasswordInput } from "@/components/ui";
import { api, safeNext, useApi } from "@/lib/api";

type Mode = "login" | "signup" | "phone" | "verify" | "forgot" | "sent";
type Settings = { google: boolean; phone: boolean; email_verification: boolean };
type Me = { is_staff: boolean; onboarded: boolean };

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function StudentAuth({ initial }: { initial: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "";
  const { data: settings } = useApi<Settings>("/api/auth/settings");
  const [mode, setMode] = useState<Mode>(initial);
  const [from, setFrom] = useState<"login" | "signup">(initial === "signup" ? "signup" : "login");
  const [via, setVia] = useState<"email" | "phone">("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") || "");
  const [pw, setPw] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [agree, setAgree] = useState(false);
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const go = (m: Mode) => {
    setErr("");
    setMode(m);
    if (m === "login" || m === "signup") window.history.replaceState(null, "", `/${m}${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  };

  const done = (user: Me) => {
    if (!user.onboarded && !user.is_staff) router.replace("/onboarding");
    else router.replace(safeNext(next));
  };

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const doLogin = () => {
    if (!emailOk(email)) return setErr("Enter a valid email address.");
    if (pw.length < 8) return setErr("Password must be at least 8 characters.");
    run(async () => {
      const r = await api.post<{ status?: string; user?: Me }>("/api/auth/login", { email, password: pw, remember });
      if (r.status === "verify") {
        // Signed up before but never entered the code: a fresh one was just sent.
        setVia("email");
        setFrom("signup");
        setOtp("");
        setMode("verify");
        toast("Verify your email first. We've sent you a new 6-digit code.");
        return;
      }
      if (r.user) done(r.user);
    });
  };

  const doSignup = () => {
    const { len, num } = passwordScore(pw);
    if (name.trim().length < 2) return setErr("Enter your full name.");
    if (!emailOk(email)) return setErr("Enter a valid email address.");
    if (!len) return setErr("Password must be at least 8 characters.");
    if (!num) return setErr("Password needs at least one number.");
    if (!agree) return setErr("Please accept the terms to continue.");
    run(async () => {
      const r = await api.post<{ status: string; user?: Me }>("/api/auth/signup", { name, email, password: pw, accepted_terms: true });
      if (r.status === "signed_in" && r.user) return done(r.user);
      setVia("email");
      setFrom("signup");
      setOtp("");
      setMode("verify");
    });
  };

  const doPhone = () => {
    if (phone.replace(/\D/g, "").length !== 10) return setErr("Enter a 10-digit mobile number.");
    run(async () => {
      await api.post("/api/auth/otp", { phone, create: true });
      setVia("phone");
      setOtp("");
      setMode("verify");
    });
  };

  const doVerify = () => {
    if (otp.length !== 6) return setErr("Enter all 6 digits.");
    run(async () => {
      const body = via === "phone" ? { type: "sms", phone, token: otp } : { type: "signup", email, token: otp };
      const r = await api.post<{ user: Me }>("/api/auth/verify", { ...body, remember });
      done(r.user);
    });
  };

  const resend = () =>
    run(async () => {
      await api.post("/api/auth/resend", via === "phone" ? { phone } : { type: "signup", email });
      toast("New code sent");
    });

  const doForgot = () => {
    if (!emailOk(email)) return setErr("Enter the email you signed up with.");
    run(async () => {
      await api.post("/api/auth/recover", { email });
      setMode("sent");
    });
  };

  const google = () =>
    run(async () => {
      const r = await api.get<{ url: string }>(`/api/auth/google?next=${encodeURIComponent(next || "/app")}`);
      window.location.href = r.url;
    });

  const social = (settings?.google || settings?.phone) && (
    <>
      <div className="flex flex-wrap gap-2.5">
        {settings?.google && (
          <SocialButton onClick={google} icon={<GoogleMark />}>
            Continue with Google
          </SocialButton>
        )}
        {settings?.phone && (
          <SocialButton
            onClick={() => {
              setFrom(mode === "login" ? "login" : "signup");
              go("phone");
            }}
            icon={<Icon name="smartphone" size={19} className="text-ink2" />}
          >
            Use mobile number
          </SocialButton>
        )}
      </div>
      <OrDivider />
    </>
  );

  const error = err && <Alert>{err}</Alert>;

  return (
    <AuthShell>
      {mode === "login" && (
        <form className="flex flex-col gap-[18px]" onSubmit={(e) => (e.preventDefault(), doLogin())}>
          <AuthTitle title="Welcome back" sub="Log in to pick up where you left off." />
          {social}
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </Field>
          <Field
            label="Password"
            right={
              <button type="button" onClick={() => go("forgot")} className="border-0 bg-transparent p-0 text-[13px] font-semibold text-pri-ink">
                Forgot password?
              </button>
            }
          >
            <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" autoComplete="current-password" />
          </Field>
          <Checkbox checked={remember} onChange={setRemember} className="items-center">
            Keep me logged in on this device
          </Checkbox>
          {error}
          <Button type="submit" variant="cta" size="xl" loading={busy} style={{ opacity: emailOk(email) && pw.length >= 8 ? 1 : 0.55 }}>
            Log in
          </Button>
          <div className="text-center text-sm text-ink2">
            New to IntelliNova?{" "}
            <button type="button" onClick={() => go("signup")} className="border-0 bg-transparent p-0 font-bold text-pri-ink">
              Create an account
            </button>
          </div>
        </form>
      )}

      {mode === "signup" && (
        <form className="flex flex-col gap-[18px]" onSubmit={(e) => (e.preventDefault(), doSignup())}>
          <AuthTitle title="Create your account" sub="Free for students. Takes about two minutes, including your profile." />
          {social}
          <Field label="Full name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </Field>
          <Field label="Password">
            <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
          </Field>
          <PasswordMeter pw={pw} />
          <Checkbox checked={agree} onChange={setAgree}>
            I agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>. If I&apos;m under 18, a parent or guardian knows I&apos;m signing up.
          </Checkbox>
          {error}
          <Button type="submit" variant="cta" size="xl" loading={busy} style={{ opacity: name.trim().length > 1 && emailOk(email) && pw.length >= 8 && agree ? 1 : 0.55 }}>
            Create account
          </Button>
          <div className="text-center text-sm text-ink2">
            Already have an account?{" "}
            <button type="button" onClick={() => go("login")} className="border-0 bg-transparent p-0 font-bold text-pri-ink">
              Log in
            </button>
          </div>
        </form>
      )}

      {mode === "phone" && (
        <form className="flex flex-col gap-[18px]" onSubmit={(e) => (e.preventDefault(), doPhone())}>
          <BackLink onClick={() => go(from)}>Use email instead</BackLink>
          <AuthTitle title="Your mobile number" sub="We'll text you a 6-digit code. Standard SMS rates may apply." />
          <Field label="Mobile number">
            <span className="flex gap-2">
              <span className="flex h-[46px] flex-none items-center rounded-xl border border-line bg-surface2 px-3.5 font-mono text-[15px] font-medium">+91</span>
              <Input inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="98765 43210" className="font-mono tracking-[0.04em]" />
            </span>
          </Field>
          {error}
          <Button type="submit" variant="cta" size="xl" loading={busy} style={{ opacity: phone.length === 10 ? 1 : 0.55 }}>
            Send code
          </Button>
        </form>
      )}

      {mode === "verify" && (
        <form className="flex flex-col gap-5" onSubmit={(e) => (e.preventDefault(), doVerify())}>
          <BackLink onClick={() => go(via === "phone" ? "phone" : "signup")}>{via === "phone" ? "Change number" : "Change email"}</BackLink>
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-pri-soft">
            <Icon name={via === "phone" ? "sms" : "mark_email_unread"} size={28} style={{ color: "var(--pri)" }} />
          </span>
          <AuthTitle
            title={via === "phone" ? "Check your messages" : "Check your email"}
            sub={
              <>
                We sent a 6-digit code to <span className="font-semibold text-ink">{via === "phone" ? `+91 ${phone}` : email || "your email"}</span>. It expires in 60 minutes.
              </>
            }
          />
          <OtpInput value={otp} onChange={(v) => (setOtp(v), setErr(""))} />
          {error}
          <Button type="submit" variant="cta" size="xl" loading={busy} style={{ opacity: otp.length === 6 ? 1 : 0.55 }}>
            Verify and continue
          </Button>
          <div className="text-center text-sm text-ink2">
            Didn&apos;t get it? Check spam, wait a minute, then{" "}
            <button type="button" onClick={resend} className="border-0 bg-transparent p-0 font-bold text-pri-ink">
              resend the code
            </button>
          </div>
          {via === "email" && <LocalMailHint />}
        </form>
      )}

      {mode === "forgot" && (
        <form className="flex flex-col gap-[18px]" onSubmit={(e) => (e.preventDefault(), doForgot())}>
          <BackLink onClick={() => go("login")}>Back to log in</BackLink>
          <AuthTitle title="Reset your password" sub="Enter the email you signed up with and we'll send you a link to set a new one." />
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </Field>
          {error}
          <Button type="submit" variant="cta" size="xl" loading={busy} style={{ opacity: emailOk(email) ? 1 : 0.55 }}>
            Send reset link
          </Button>
        </form>
      )}

      {mode === "sent" && (
        <div className="flex flex-col gap-[18px]">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ok-soft">
            <Icon name="mark_email_read" size={28} style={{ color: "var(--ok)" }} />
          </span>
          <AuthTitle
            title="Check your inbox"
            sub={
              <>
                We sent a link to <span className="font-semibold text-ink">{email}</span> to set a new password. It expires in one hour.
              </>
            }
          />
          <LocalMailHint />
          <Button variant="cta" size="xl" onClick={() => go("login")}>
            Back to log in
          </Button>
          <div className="text-center text-sm text-ink2">
            Wrong email?{" "}
            <button type="button" onClick={() => go("forgot")} className="border-0 bg-transparent p-0 font-bold text-pri-ink">
              Try again
            </button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

/** On a local install, emails don't go to a real inbox: Mailpit (port 8025) catches them. */
export function LocalMailHint() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1" || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(h)) setUrl(`http://${h}:8025`);
  }, []);
  if (!url) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl bg-surface2 px-3.5 py-2.5 text-[13px] text-ink2">
      <Icon name="info" size={17} className="mt-px flex-none" />
      <span>
        Running IntelliNova on this computer? Emails don&apos;t reach a real inbox: they arrive in Mailpit at{" "}
        <a href={url} target="_blank" rel="noreferrer" className="font-bold">{url.replace("http://", "")}</a>.
      </span>
    </div>
  );
}

export function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-ink2">
      <Icon name="arrow_back" size={16} />
      {children}
    </button>
  );
}
