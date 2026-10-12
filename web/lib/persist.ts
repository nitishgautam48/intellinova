"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { portal } from "@/lib/api";

/*
 * Page state that survives moving to another page and back (drafts, selected tabs, picked options).
 * Kept in the browser's sessionStorage for this tab only, separately for the student app and the admin
 * console, and cleared on logout. Nothing here is sent to the server.
 */

const PREFIX = "inn:";
const fullKey = (key: string) => `${PREFIX}${portal()}:${key}`;

export function readPersisted<T>(key: string): T | undefined {
  try {
    const raw = window.sessionStorage.getItem(fullKey(key));
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function writePersisted(key: string, value: unknown) {
  try {
    if (value === undefined || value === null || value === "") window.sessionStorage.removeItem(fullKey(key));
    else window.sessionStorage.setItem(fullKey(key), JSON.stringify(value));
  } catch {
    /* storage full or blocked: the page simply won't remember this value */
  }
}

/** Removes everything remembered for one portal (called on logout). */
export function clearPersisted(which: "student" | "admin" = portal()) {
  try {
    const p = `${PREFIX}${which}:`;
    for (const k of Object.keys(window.sessionStorage)) if (k.startsWith(p)) window.sessionStorage.removeItem(k);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Like useState, but the value is remembered while you move around the app. It starts with `initial`
 * on the server render and switches to the remembered value right after the page mounts (`ready` then
 * becomes true), so there is no hydration mismatch.
 */
export function usePersistentState<T>(key: string | null, initial: T): [T, (v: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const initialRef = useRef(initial);
  const loadedKey = useRef<string | null>(null);
  const skipWrite = useRef(false);

  useEffect(() => {
    // (Re)load whenever the key changes; a new key with nothing saved starts from `initial` again.
    const saved = key ? readPersisted<T>(key) : undefined;
    if (loadedKey.current !== null || saved !== undefined) setValue(saved !== undefined ? saved : initialRef.current);
    loadedKey.current = key;
    skipWrite.current = true;
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (skipWrite.current) {
      skipWrite.current = false; // same commit as the load above: `value` still belongs to the old key
      return;
    }
    if (ready && key && loadedKey.current === key) writePersisted(key, value);
  }, [key, value, ready]);

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue(v);
  }, []);
  return [value, set, ready];
}
