"use client";

import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { useEffect } from "react";
import { Toaster } from "sonner";

import { ThemeProvider, useTheme } from "@/lib/theme";

function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-center"
      toastOptions={{
        style: { background: "var(--ink)", color: "var(--bg)", border: 0, borderRadius: 12, fontFamily: "var(--font-sans)", fontWeight: 600 },
      }}
    />
  );
}

/** Optional self-hosted PostHog for behaviour tracking (NEXT_PUBLIC_POSTHOG_KEY / _HOST at build time). */
function Analytics() {
  const path = usePathname();
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (key && !posthog.__loaded) {
      posthog.init(key, { api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "/ingest", capture_pageview: false, persistence: "localStorage" });
    }
  }, []);
  useEffect(() => {
    if (posthog.__loaded) posthog.capture("$pageview", { path });
  }, [path]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <ThemedToaster />
      <Analytics />
    </ThemeProvider>
  );
}
