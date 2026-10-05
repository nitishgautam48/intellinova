"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Loading } from "@/components/ui";
import { api } from "@/lib/api";

/** GoTrue redirects here after "Continue with Google" with the session in the URL fragment. */
export default function OAuthCallback() {
  const router = useRouter();
  const [err, setErr] = useState("");
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const next = new URLSearchParams(window.location.search).get("next") || "/app";
    if (h.get("error")) {
      setErr(h.get("error_description") || "Sign-in was cancelled.");
      return;
    }
    const access_token = h.get("access_token");
    const refresh_token = h.get("refresh_token");
    if (!access_token || !refresh_token) {
      setErr("The sign-in response was incomplete.");
      return;
    }
    api
      .post<{ user: { onboarded: boolean; is_staff: boolean } }>("/api/auth/session", { access_token, refresh_token, expires_in: Number(h.get("expires_in") || 3600) })
      .then((r) => router.replace(!r.user.onboarded && !r.user.is_staff ? "/onboarding" : next))
      .catch((e) => setErr(e.message));
  }, [router]);
  return (
    <div className="mx-auto mt-24 max-w-md px-4">
      {err ? (
        <Alert>
          {err} <Link href="/login">Back to log in</Link>
        </Alert>
      ) : (
        <Loading label="Signing you in…" />
      )}
    </div>
  );
}
