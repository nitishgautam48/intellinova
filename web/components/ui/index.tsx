"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import * as React from "react";

import { cn, type Tone } from "@/lib/utils";

/* ---------------------------------------------------------------- icon */

export function Icon({ name, size = 20, fill, className, style }: { name: string; size?: number; fill?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <span aria-hidden className={cn("ms", fill && "fill", className)} style={{ fontSize: size, ...style }}>
      {name}
    </span>
  );
}

export function Logo({ size = 34, withText = true, textClass }: { size?: number; withText?: boolean; textClass?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="grid flex-none place-items-center font-display font-bold text-on-pri"
        style={{ width: size, height: size, borderRadius: size * 0.29, background: "var(--grad)", fontSize: size * 0.53 }}
      >
        I
      </span>
      {withText && <span className={cn("font-display text-[20px] font-bold leading-none tracking-[-0.02em]", textClass)}>IntelliNova</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- button */

const buttonVariants = cva(
  "inline-flex flex-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background,border-color,opacity,color] disabled:opacity-55",
  {
    variants: {
      variant: {
        cta: "border-0 text-on-pri [background:var(--grad)] font-bold hover:opacity-95",
        primary: "border-0 bg-pri text-on-pri [background-image:var(--grad)]",
        solid: "border-0 bg-pri text-on-pri hover:bg-pri-hover",
        secondary: "border border-line bg-surface text-ink hover:bg-surface2",
        soft: "border-0 bg-pri-soft text-pri-ink hover:brightness-105",
        ghost: "border-0 bg-transparent text-ink2 hover:bg-surface2 hover:text-ink",
        link: "h-auto border-0 bg-transparent p-0 text-pri-ink hover:underline",
        danger: "border border-line bg-surface text-err-ink hover:bg-err-soft",
        ink: "border-0 bg-ink text-bg font-bold",
      },
      size: {
        xs: "h-8 rounded-lg px-3 text-[13px]",
        sm: "h-[34px] rounded-[9px] px-3 text-[13px]",
        md: "h-10 rounded-[10px] px-4",
        lg: "h-[42px] rounded-[10px] px-[18px]",
        xl: "h-12 w-full rounded-xl text-[15px]",
        icon: "h-10 w-10 rounded-[10px] p-0",
        iconSm: "h-[34px] w-[34px] rounded-[9px] p-0",
      },
      pill: { true: "rounded-full" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean; icon?: string; iconRight?: string };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, pill, asChild, loading, icon, iconRight, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  if (asChild) {
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, pill }), className)} {...props}>{children}</Comp>;
  }
  return (
    <Comp ref={ref} type={props.type || "button"} disabled={disabled || loading} className={cn(buttonVariants({ variant, size, pill }), className)} {...props}>
      {loading ? <Spinner size={18} /> : icon ? <Icon name={icon} size={size === "xs" || size === "sm" ? 17 : 20} /> : null}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={18} />}
    </Comp>
  );
});

export function LinkButton({ href, className, variant, size, pill, icon, children, ...rest }: { href: string; className?: string; icon?: string; children?: React.ReactNode } & VariantProps<typeof buttonVariants> & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size, pill }), "hover:no-underline", className)} {...rest}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Link>
  );
}

/* ---------------------------------------------------------------- form */

export const inputClass =
  "h-[46px] w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] text-ink outline-none transition-shadow focus:border-pri focus:shadow-[0_0_0_3px_var(--pri-soft)]";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(inputClass, className)} {...p} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(inputClass, "h-auto min-h-[110px] py-3 leading-relaxed", className)} {...p} />;
});

export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputClass, "cursor-pointer appearance-none bg-[length:18px] pr-9", className)} {...p}>
      {children}
    </select>
  );
}

export function Field({ label, hint, right, children, className }: { label: string; hint?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-[13px] font-semibold", className)}>
      <span className="flex items-center justify-between">
        {label}
        {right}
      </span>
      {children}
      {hint && <span className="text-xs font-normal text-ink3">{hint}</span>}
    </label>
  );
}

export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = React.useState(false);
  return (
    <span className="relative block">
      <Input {...props} type={show ? "text" : "password"} className="pr-12" />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-1 top-1 grid h-[38px] w-[38px] place-items-center rounded-[9px] border-0 bg-transparent text-ink3">
        <Icon name={show ? "visibility_off" : "visibility"} size={19} />
      </button>
    </span>
  );
}

export function Checkbox({ checked, onChange, children, className }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={cn("flex items-start gap-2.5 border-0 bg-transparent p-0 text-left text-[13px] leading-normal text-ink2", className)}>
      <Icon name={checked ? "check_box" : "check_box_outline_blank"} className="flex-none" style={{ color: checked ? "var(--pri)" : "var(--ink3)" }} />
      <span>{children}</span>
    </button>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="relative h-6 w-11 flex-none rounded-full border-0 p-0 transition-colors" style={{ background: on ? "var(--pri)" : "var(--line)" }}>
      <span className="absolute top-[2px] h-5 w-5 rounded-full bg-white shadow transition-[left]" style={{ left: on ? 22 : 2 }} />
    </button>
  );
}

/* ---------------------------------------------------------------- chips, pills, segmented */

const TONES: Record<Tone, [string, string]> = {
  pri: ["var(--pri-soft)", "var(--pri-ink)"],
  teal: ["var(--teal-soft)", "var(--teal-ink)"],
  ok: ["var(--ok-soft)", "var(--ok-ink)"],
  warn: ["var(--warn-soft)", "var(--warn-ink)"],
  err: ["var(--err-soft)", "var(--err-ink)"],
  mute: ["var(--surface2)", "var(--ink2)"],
};

export function Pill({ tone = "mute", children, className, icon }: { tone?: Tone; children: React.ReactNode; className?: string; icon?: string }) {
  const [bg, fg] = TONES[tone];
  return (
    <span className={cn("inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full px-[9px] py-[3px] text-xs font-semibold", className)} style={{ background: bg, color: fg }}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("flex-none whitespace-nowrap rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold", className)}>{children}</span>;
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[11px] font-medium", className)}>{children}</span>;
}

export function Chip({ on, onClick, children, icon = true, className }: { on: boolean; onClick: () => void; children: React.ReactNode; icon?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("inline-flex h-9 flex-none items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold transition-colors", className)}
      style={{ background: on ? "var(--pri-soft)" : "var(--surface)", color: on ? "var(--pri-ink)" : "var(--ink)", borderColor: on ? "var(--pri)" : "var(--line)" }}
    >
      {icon && <Icon name={on ? "check" : "add"} size={16} />}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: { value: T; onChange: (v: T) => void; options: { v: T; l: React.ReactNode }[]; className?: string; size?: "sm" | "md" }) {
  return (
    <div className={cn("inline-flex gap-0.5 rounded-[10px] bg-surface2 p-[3px]", className)} role="tablist">
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.v)}
            className={cn("whitespace-nowrap rounded-lg border-0 font-semibold", size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]")}
            style={{ background: on ? "var(--surface)" : "transparent", color: on ? "var(--ink)" : "var(--ink2)", boxShadow: on ? "var(--shadow)" : "none" }}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { v: T; l: React.ReactNode; icon?: string; n?: React.ReactNode }[]; className?: string }) {
  return (
    <div className={cn("no-scrollbar flex gap-1 overflow-x-auto border-b border-line", className)} role="tablist">
      {tabs.map((t) => {
        const on = t.v === value;
        return (
          <button
            key={t.v}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.v)}
            className="-mb-px flex h-11 flex-none items-center gap-1.5 whitespace-nowrap border-0 border-b-2 bg-transparent px-3 font-semibold"
            style={{ color: on ? "var(--pri-ink)" : "var(--ink2)", borderBottomColor: on ? "var(--pri)" : "transparent" }}
          >
            {t.icon && <Icon name={t.icon} size={18} />}
            {t.l}
            {t.n !== undefined && <span className="rounded-full bg-surface2 px-1.5 text-[11px] text-ink2">{t.n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- layout blocks */

export function Card({ className, children, pad = true, ...p }: React.HTMLAttributes<HTMLDivElement> & { pad?: boolean }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface", pad && "p-5", className)} {...p}>
      {children}
    </div>
  );
}

export function CardTitle({ children, sub, right, className }: { children: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-baseline justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="font-display text-[17px] font-semibold">{children}</div>
        {sub && <div className="text-[13px] text-ink2">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Eyebrow({ children, className, color = "var(--ink2)" }: { children: React.ReactNode; className?: string; color?: string }) {
  return (
    <div className={cn("font-mono text-[11px] font-semibold tracking-[0.08em]", className)} style={{ color }}>
      {children}
    </div>
  );
}

export function PageHead({ title, sub, eyebrow, right, className }: { title: React.ReactNode; sub?: React.ReactNode; eyebrow?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="font-mono text-xs font-medium tracking-[0.04em] text-ink2">{eyebrow}</div>}
        <h1 className="mb-1 mt-1.5 font-display text-[32px] font-semibold leading-[1.15] tracking-[-0.02em]">{title}</h1>
        {sub && <div className="max-w-[720px] text-ink2">{sub}</div>}
      </div>
      {right && <div className="flex flex-wrap gap-2">{right}</div>}
    </div>
  );
}

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return <Icon name="progress_activity" size={size} className={className} style={{ animation: "spin 1s linear infinite" }} />;
}

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-16 text-ink2", className)}>
      <Spinner /> {label}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("skeleton", className)} style={style} />;
}

export function Empty({ icon = "inbox", title, children, action, className }: { icon?: string; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-10 text-center", className)}>
      <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-surface2 text-ink2">
        <Icon name={icon} size={24} />
      </span>
      <div className="font-display text-[17px] font-semibold">{title}</div>
      {children && <div className="max-w-[440px] text-[13px] text-ink2">{children}</div>}
      {action}
    </div>
  );
}

export function Alert({ tone = "err", icon, children, className }: { tone?: Tone; icon?: string; children: React.ReactNode; className?: string }) {
  const [bg, fg] = TONES[tone];
  return (
    <div className={cn("flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[13px] font-medium", className)} style={{ background: bg, color: fg }}>
      <Icon name={icon || (tone === "err" ? "error" : tone === "ok" ? "check_circle" : "info")} size={17} className="mt-px" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <Empty icon="cloud_off" title="Couldn't load this" action={retry && <Button size="sm" onClick={retry} icon="refresh">Try again</Button>}>
      {msg}
    </Empty>
  );
}

export function Bar({ value, color = "var(--pri)", className, height = 8 }: { value: number; color?: string; className?: string; height?: number }) {
  return (
    <div className={cn("overflow-hidden rounded bg-surface2", className)} style={{ height, borderRadius: height / 2 }}>
      <div className="h-full transition-[width]" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color, borderRadius: height / 2 }} />
    </div>
  );
}

export function Ring({ value, size = 112, stroke = 10, label, sub, color = "var(--pri)" }: { value: number; size?: number; stroke?: number; label: React.ReactNode; sub?: React.ReactNode; color?: string }) {
  const r = size / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "var(--line)" }} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: color, transition: "stroke-dashoffset .4s" }} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-display text-2xl font-semibold leading-none">{label}</div>
          {sub && <div className="text-[11px] text-ink2">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, icon, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: string; className?: string }) {
  return (
    <Card className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between text-[13px] text-ink2">
        {label}
        {icon && <Icon name={icon} size={19} className="text-ink2" />}
      </div>
      <div className="font-display text-[28px] font-semibold leading-tight">{value}</div>
      {sub && <div className="text-xs text-ink2">{sub}</div>}
    </Card>
  );
}

export function CiteBadge({ n, on, onClick }: { n: number | string; on?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-0.5 inline-grid h-[18px] min-w-5 place-items-center rounded-[5px] border-0 px-1 align-[2px] font-mono text-[10px] font-semibold"
      style={{ background: on ? "var(--pri)" : "var(--pri-soft)", color: on ? "var(--on-pri)" : "var(--pri-ink)" }}
      aria-label={`Source ${n}`}
    >
      {n}
    </button>
  );
}
