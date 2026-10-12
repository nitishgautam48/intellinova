"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";

/*
 * File uploads that keep going when you move to another page. The request itself already continues in the
 * background (page changes don't cancel it); this keeps it visible in the top bar, tells you when it finished,
 * and asks before the browser tab is closed or reloaded while a file is still being sent.
 */

export type Upload = { id: number; label: string; started: number };

let uploads: Upload[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = "A file is still uploading. Leave anyway?";
  return e.returnValue;
}

function setUploads(next: Upload[]) {
  const had = uploads.length > 0;
  uploads = next;
  if (typeof window !== "undefined") {
    if (!had && next.length) window.addEventListener("beforeunload", onBeforeUnload);
    if (had && !next.length) window.removeEventListener("beforeunload", onBeforeUnload);
  }
  emit();
}

/** Wraps an upload request so it shows in the top bar until it finishes. Returns the request's result. */
export async function trackUpload<T>(label: string, request: Promise<T>, done?: string): Promise<T> {
  const u: Upload = { id: nextId++, label, started: Date.now() };
  setUploads([...uploads, u]);
  try {
    const out = await request;
    if (done) toast.success(done);
    return out;
  } catch (e) {
    toast.error(`Upload failed: ${label}`);
    throw e;
  } finally {
    setUploads(uploads.filter((x) => x.id !== u.id));
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const EMPTY: Upload[] = [];

export function useUploads(): Upload[] {
  return useSyncExternalStore(subscribe, () => uploads, () => EMPTY);
}

/** True while this page is still the one the user is looking at (so a late result can navigate safely). */
export function stillOn(pathPrefix: string): boolean {
  return typeof window !== "undefined" && window.location.pathname.startsWith(pathPrefix);
}
