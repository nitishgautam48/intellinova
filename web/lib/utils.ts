import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Tone = "pri" | "teal" | "ok" | "warn" | "err" | "mute";

/** Status label -> tone, shared by student app and admin console (from the design). */
export const STATUS_TONE: Record<string, Tone> = {
  Completed: "ok",
  "In progress": "pri",
  "Revision due": "warn",
  "Not started": "mute",
  Confident: "ok",
  Learning: "pri",
  Active: "ok",
  "Needs Review": "warn",
  Unavailable: "err",
  Draft: "mute",
  Disabled: "mute",
  Ready: "ok",
  Processing: "pri",
  Flagged: "err",
  Failed: "err",
  Verified: "ok",
  "May be outdated": "warn",
  Unverified: "mute",
  Invited: "pri",
  Suspended: "err",
  Published: "ok",
  Archived: "mute",
  Mastered: "ok",
  Developing: "warn",
  Weak: "err",
  "Not assessed": "mute",
  Easy: "ok",
  Medium: "warn",
  Hard: "err",
  High: "err",
  Low: "mute",
  Required: "pri",
  Recommended: "teal",
  Useful: "teal",
  "Well supported": "teal",
  Possible: "pri",
  Limited: "mute",
};

export const toneOf = (label: string, fallback: Tone = "mute"): Tone => STATUS_TONE[label] || fallback;

export const f2 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));

export const pct = (v: number) => `${Math.round(v * 100)}%`;
