"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Tutor } from "@/components/tutor";
import { Loading } from "@/components/ui";

function Inner() {
  const p = useSearchParams();
  return <Tutor key={p.get("new") || "t"} initialQ={p.get("q") || ""} />;
}

export default function TutorPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Inner />
    </Suspense>
  );
}
