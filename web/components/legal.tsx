import Link from "next/link";

import { Logo } from "@/components/ui";

/** Shared layout for the Privacy and Terms pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[760px] items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="text-inherit hover:no-underline"><Logo size={28} textClass="text-lg" /></Link>
        <Link href="/login" className="text-[13px] font-semibold">Log in</Link>
      </header>
      <main className="mx-auto max-w-[760px] px-4 pb-20 pt-6 sm:px-6">
        <h1 className="m-0 font-display text-[34px] font-semibold tracking-[-0.02em]">{title}</h1>
        <div className="mt-1 text-[13px] text-ink3">Last updated {updated}</div>
        <div className="legal mt-8 flex flex-col gap-4 text-[15px] leading-[1.7] text-ink2 [&_h2]:mb-0 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_li]:mb-1.5 [&_p]:m-0 [&_strong]:text-ink [&_ul]:m-0 [&_ul]:pl-5">
          {children}
        </div>
      </main>
    </div>
  );
}
