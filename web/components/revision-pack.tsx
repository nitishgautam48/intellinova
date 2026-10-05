"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui";
import { api } from "@/lib/api";

/** One click: notes, flashcards, audio brief and slides for weak topics, built from class material.
 *  With no topic ids the server picks the weakest topics from the learner model. */
export function RevisionPackButton({ topicIds = [], size = "sm", variant = "soft", label = "Revision pack" }: { topicIds?: string[]; size?: "xs" | "sm" | "md"; variant?: "soft" | "secondary" | "primary"; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: string; topics: string[]; skipped: string[] }>("/api/study/revision-pack", { topic_ids: topicIds.slice(0, 8) });
      toast.success(`Building a pack for ${r.topics.join(", ")}`, { description: r.skipped.length ? `No class material yet for ${r.skipped.join(", ")}.` : undefined });
      router.push(`/app/study/${r.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Button size={size} variant={variant} icon="healing" loading={busy} onClick={make} title="Notes, flashcards, audio and slides for these topics">
      {label}
    </Button>
  );
}
