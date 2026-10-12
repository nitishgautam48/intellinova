"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { Bar, Icon, Spinner } from "@/components/ui";
import { refresh, useApi } from "@/lib/api";
import { useUploads } from "@/lib/uploads";

type Job = { id: string; kind: string; label: string; detail: string; href: string; progress: number | null; started: string | null };

const KEYS = { student: "/api/jobs", admin: "/api/admin/jobs" } as const;
const ICON: Record<string, string> = { material: "auto_awesome", quiz: "quiz", source: "upload_file", eval: "query_stats", bank: "inventory_2", discovery: "travel_explore" };

/** Ask the indicator to check again right away (call after starting something that runs in the background). */
export const refreshJobs = () => refresh((k) => k === KEYS.student || k === KEYS.admin);

/** Top-bar indicator of work still running in the background, with a notice when each piece finishes. */
export function RunningJobs({ portal }: { portal: "student" | "admin" }) {
  const uploads = useUploads();
  const path = usePathname();
  const router = useRouter();
  const { data } = useApi<{ jobs: Job[] }>(KEYS[portal], {
    refreshInterval: (d) => (d?.jobs.length || uploads.length ? 4000 : 20000),
    revalidateOnFocus: true,
  });
  const jobs = data?.jobs ?? [];
  const seen = useRef<Map<string, Job> | null>(null);

  useEffect(() => {
    if (!data) return;
    const now = new Map(data.jobs.map((j) => [j.id, j]));
    if (seen.current) {
      for (const [id, j] of seen.current) {
        if (now.has(id)) continue;
        const here = path === j.href.split("?")[0];
        if (!here) toast(`Finished: ${j.label}`, { action: { label: "Open", onClick: () => router.push(j.href) } });
      }
    }
    seen.current = now;
  }, [data, path, router]);

  const n = jobs.length + uploads.length;
  if (!n) return null;
  return (
    <Popover.Root>
      <Popover.Trigger aria-label={`${n} running in the background`} title="Running in the background"
        className="flex h-9 items-center gap-2 rounded-full border border-line bg-surface2 px-3 text-[13px] font-semibold text-ink hover:bg-surface">
        <Spinner size={15} />
        <span>{n} running</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-[330px] rounded-xl border border-line bg-surface p-2 shadow-card">
          <div className="px-2 pb-1 pt-1 text-xs font-semibold text-ink2">Running in the background</div>
          <div className="px-2 pb-2 text-[12px] text-ink3">You can keep using the app; you&apos;ll get a notice when each one finishes.</div>
          {uploads.map((u) => (
            <div key={`u${u.id}`} className="flex items-start gap-2.5 rounded-lg px-2 py-2">
              <Icon name="cloud_upload" size={19} className="mt-0.5 text-pri" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{u.label}</div>
                <div className="text-[12px] text-ink2">Uploading… keep this browser tab open</div>
              </div>
            </div>
          ))}
          {jobs.map((j) => (
            <Link key={j.id} href={j.href} className="flex items-start gap-2.5 rounded-lg px-2 py-2 text-ink hover:bg-surface2 hover:no-underline">
              <Icon name={ICON[j.kind] || "pending"} size={19} className="mt-0.5 text-pri" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{j.label}</div>
                <div className="truncate text-[12px] text-ink2">{j.detail}</div>
                {j.progress !== null && <Bar value={Math.max(4, Math.min(100, j.progress * 100))} height={4} className="mt-1.5" />}
              </div>
            </Link>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
