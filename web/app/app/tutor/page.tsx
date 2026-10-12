"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Tutor } from "@/components/tutor";
import { Loading } from "@/components/ui";
import { readPersisted, writePersisted } from "@/lib/persist";

function Inner() {
  const p = useSearchParams();
  const router = useRouter();
  const n = p.get("new");
  const fresh = !!(n || p.get("q"));
  // The chat is keyed on the last "New" press (?new=…). When the first question gives the chat its own address,
  // ?new= disappears from the URL; that must not reset the page while the question is being answered.
  const [key, setKey] = useState(n || "t");
  if (n && n !== key) setKey(n);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Coming back to Ask Tutor reopens the conversation you were in (including an answer still being written).
    // "New" (?new=…) or a question from elsewhere (?q=) starts a fresh one. Decided when the page opens or "New"
    // is pressed, not when the address changes underneath an open chat.
    if (fresh) {
      writePersisted("tutor.last", null);
      setChecked(true);
      return;
    }
    const last = readPersisted<string>("tutor.last");
    if (last) router.replace(`/app/tutor/${last}`);
    else setChecked(true);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!checked) return <Loading />;
  return <Tutor key={key} initialQ={p.get("q") || ""} />;
}

export default function TutorPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Inner />
    </Suspense>
  );
}
