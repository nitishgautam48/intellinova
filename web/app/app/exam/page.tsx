"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { Button, Empty, ErrorState, Icon, Loading, PageHead, Pill } from "@/components/ui";
import { api, useApi } from "@/lib/api";

type ExamRow = { id: string; code: string; name: string; full_name: string; following: boolean };

export default function ExamChooser() {
  const router = useRouter();
  const { data, error, mutate } = useApi<ExamRow[]>("/api/exams");
  const following = data?.filter((e) => e.following) || [];
  useEffect(() => {
    if (following.length === 1 && !new URLSearchParams(window.location.search).get("switch")) router.replace(`/app/exam/${following[0].id}`);
  }, [following, router]);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const follow = async (e: ExamRow) => {
    const r = await api.post<{ following: boolean }>(`/api/exams/${e.id}/follow`);
    toast(r.following ? `Added ${e.name} to your exams` : `Removed ${e.name}`);
    mutate();
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHead title="Exam Prep" sub="Track an entrance exam's syllabus, mark what you know, and get a weekly plan that fits your hours." />
      {data.length === 0 ? (
        <Empty icon="flag" title="No exams set up yet">
          Your school or content team hasn&apos;t configured any entrance exams. Once they do, you&apos;ll be able to follow one here.
        </Empty>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
          {data.map((e) => (
            <div key={e.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-teal-soft text-teal-ink">
                  <Icon name="flag" size={24} />
                </span>
                {e.following && <Pill tone="teal">Following</Pill>}
              </div>
              <div>
                <div className="font-display text-xl font-semibold">{e.name}</div>
                <div className="text-[13px] text-ink2">{e.full_name}</div>
              </div>
              <div className="mt-auto flex gap-2">
                <Link href={`/app/exam/${e.id}`} className="flex h-10 flex-1 items-center justify-center rounded-[10px] font-semibold text-on-pri hover:no-underline" style={{ background: "var(--grad)" }}>
                  Open
                </Link>
                <Button onClick={() => follow(e)}>{e.following ? "Unfollow" : "Follow"}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
