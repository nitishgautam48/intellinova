"use client";

import { useEffect } from "react";

import { Button, Icon } from "@/components/ui";

/** Shown instead of a blank "Application error" page if something on a page crashes. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center gap-3 py-16 text-center">
      <Icon name="error" size={36} className="text-warn" />
      <div className="font-display text-xl font-semibold">This page hit a problem</div>
      <div className="text-[13px] text-ink2">Try again, or reload the page. If it keeps happening, tell your admin what you clicked.</div>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="primary" onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    </div>
  );
}
