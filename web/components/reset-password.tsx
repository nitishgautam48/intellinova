"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AuthShell, AuthTitle, PasswordMeter, passwordScore } from "@/components/auth-shell";
import { Alert, Button, Field, PasswordInput } from "@/components/ui";
import { api } from "@/lib/api";

export function ResetPassword({ portal }: { portal: "student" | "admin" }) {
  const router = useRouter();
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const q = new URLSearchParams(window.location.search);
    setTokenHash(h.get("token_hash") || q.get("token_hash") || "");
    if (h.get("error_description")) setErr(h.get("error_description") || "");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { len, num } = passwordScore(pw);
    if (!len || !num) return setErr("Use at least 8 characters including a number.");
    if (pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    setErr("");
    try {
      await api.post("/api/auth/reset-password", { password: pw, token_hash: tokenHash });
      router.replace(portal === "admin" ? "/admin" : "/app");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't reset the password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell variant={portal}>
      <form className="flex flex-col gap-[18px]" onSubmit={submit}>
        <AuthTitle title="Choose a new password" sub="Pick something you haven't used here before." />
        {tokenHash === "" ? (
          <Alert>
            This reset link is incomplete or has expired.{" "}
            <Link href={portal === "admin" ? "/admin/login?mode=forgot" : "/forgot-password"}>Request a new one</Link>.
          </Alert>
        ) : (
          <>
            <Field label="New password">
              <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
            </Field>
            <PasswordMeter pw={pw} />
            <Field label="Confirm new password">
              <PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </Field>
            {err && <Alert>{err}</Alert>}
            <Button type="submit" variant="cta" size="xl" loading={busy}>
              Save password and log in
            </Button>
          </>
        )}
      </form>
    </AuthShell>
  );
}
