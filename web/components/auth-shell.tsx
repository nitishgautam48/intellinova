"use client";

import Link from "next/link";

import { Icon, Logo } from "@/components/ui";

/** Split-screen frame used by every sign-in / sign-up step (student and admin). */
export function AuthShell({ children, variant = "student" }: { children: React.ReactNode; variant?: "student" | "admin" }) {
  const points =
    variant === "admin"
      ? [
          ["database", "Upload lectures, textbooks and slide decks"],
          ["verified", "Review what the AI generates before students see it"],
          ["query_stats", "Measure answer quality with real test sets"],
        ]
      : [
          ["forum", "Ask doubts in English, Hindi or Hinglish"],
          ["quiz", "Quizzes that adapt to what you know"],
          ["event_repeat", "Revision reminders before you forget"],
        ];
  return (
    <div className="flex min-h-screen">
      <div
        className="relative hidden w-[420px] flex-none flex-col gap-7 overflow-hidden p-9 pb-8 text-side-ink md:flex"
        style={{
          background: "var(--side)",
          backgroundImage:
            "radial-gradient(70% 45% at 0% 0%,color-mix(in oklch,var(--pri) 22%,transparent),transparent 70%),radial-gradient(60% 40% at 100% 100%,color-mix(in oklch,var(--teal) 14%,transparent),transparent 70%)",
        }}
      >
        <Link href="/" className="text-inherit hover:no-underline">
          <Logo />
        </Link>
        <div className="mt-auto font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] [text-wrap:balance]">
          {variant === "admin" ? "The admin console for keeping IntelliNova accurate." : "Your class material, turned into a tutor that shows its work."}
        </div>
        <div className="flex flex-col gap-3.5">
          {points.map(([icon, text]) => (
            <div key={text} className="flex items-center gap-3 text-sm">
              <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] bg-side2">
                <Icon name={icon} size={18} style={{ color: "var(--pri)" }} />
              </span>
              {text}
            </div>
          ))}
        </div>
        {variant === "student" && (
          <div className="flex flex-col gap-2.5 rounded-[14px] border border-side2 p-3.5" style={{ background: "color-mix(in oklch,var(--side2) 60%,transparent)" }}>
            <div className="text-[13px] leading-relaxed">
              Cited answers point to the page, slide or video moment they came from{" "}
              <span className="inline-grid h-[17px] min-w-[18px] place-items-center rounded-[5px] bg-pri px-1 align-[1px] font-mono text-[10px] font-semibold text-on-pri">1</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-[5px] border border-pri px-[7px] py-[3px] font-mono text-[10px] font-medium">[1] Slide</span>
              <span className="rounded-[5px] border border-side2 px-[7px] py-[3px] font-mono text-[10px] font-medium text-side-ink2">p. · Fig.</span>
              <span className="rounded-[5px] border border-side2 px-[7px] py-[3px] font-mono text-[10px] font-medium text-side-ink2">Video · mm:ss</span>
            </div>
          </div>
        )}
        <div className="text-xs text-side-ink2">{variant === "admin" ? "Access is by invitation from an admin." : "Free for students. No card needed."}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center px-[18px] pb-10 pt-6 md:px-10 md:py-12">
        <div className="mb-10 flex w-full max-w-[420px] items-center justify-between">
          <span className="md:hidden">
            <Logo size={30} textClass="text-lg" />
          </span>
          <Link href="/" className="ml-auto flex items-center gap-1 text-[13px] font-semibold text-ink2">
            <Icon name="arrow_back" size={16} />
            Back to site
          </Link>
        </div>
        <div className="my-auto flex w-full max-w-[420px] flex-col gap-5">{children}</div>
      </div>
    </div>
  );
}

export function AuthTitle({ title, sub }: { title: string; sub: React.ReactNode }) {
  return (
    <div>
      <h1 className="m-0 mb-2 font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.02em]">{title}</h1>
      <div className="text-ink2">{sub}</div>
    </div>
  );
}

export function OrDivider({ label = "or with email" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-ink3">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function SocialButton({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex h-[46px] flex-1 items-center justify-center gap-2.5 whitespace-nowrap rounded-xl border border-line bg-surface text-sm font-semibold hover:bg-surface2">
      {icon}
      {children}
    </button>
  );
}

export function GoogleMark() {
  return <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-xs font-bold text-bg">G</span>;
}

export function passwordScore(pw: string) {
  const len = pw.length >= 8;
  const num = /\d/.test(pw);
  const score = pw ? Math.max(1, Math.min(4, (len ? 1 : 0) + (num ? 1 : 0) + (/[A-Z]/.test(pw) ? 1 : 0) + (/[^A-Za-z0-9]/.test(pw) || pw.length >= 12 ? 1 : 0))) : 0;
  return { len, num, score };
}

export function PasswordMeter({ pw }: { pw: string }) {
  const { len, num, score } = passwordScore(pw);
  const colors = ["var(--line)", "var(--err)", "var(--warn)", "var(--teal)", "var(--pri)"];
  const c = colors[score];
  return (
    <div className="-mt-2 flex flex-col gap-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="h-1 flex-1 rounded-sm transition-colors" style={{ background: i < score ? c : "var(--line)" }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs">
        <span className="mr-auto font-semibold" style={{ color: pw ? c : "var(--ink3)" }}>
          {pw ? ["", "Weak", "Okay", "Good", "Strong"][score] : "Password strength"}
        </span>
        {(
          [
            ["8+ characters", len],
            ["A number", num],
          ] as const
        ).map(([l, ok]) => (
          <span key={l} className="flex items-center gap-1" style={{ color: ok ? "var(--ok-ink)" : "var(--ink3)" }}>
            <Icon name={ok ? "check_circle" : "radio_button_unchecked"} size={14} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

export function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative grid cursor-text grid-cols-6 gap-2">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="grid h-14 place-items-center rounded-xl bg-surface font-mono text-[22px] font-semibold transition-colors"
          style={{ border: `1.5px solid ${i === value.length ? "var(--pri)" : value[i] ? "var(--ink3)" : "var(--line)"}` }}
        >
          {value[i] || ""}
        </span>
      ))}
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        aria-label="Verification code"
        className="absolute inset-0 h-full w-full border-0 text-base opacity-0"
      />
    </label>
  );
}
