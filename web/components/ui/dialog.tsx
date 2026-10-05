"use client";

import * as D from "@radix-ui/react-dialog";
import * as React from "react";

import { cn } from "@/lib/utils";

import { Icon } from "./index";

export function Modal({ open, onOpenChange, title, sub, children, footer, width = 520 }: { open: boolean; onOpenChange: (v: boolean) => void; title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <D.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-line bg-surface shadow-card outline-none"
          style={{ maxWidth: width }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <D.Title className="m-0 font-display text-lg font-semibold">{title}</D.Title>
              {sub ? <D.Description className="m-0 mt-0.5 text-[13px] text-ink2">{sub}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
            </div>
            <D.Close className="grid h-9 w-9 place-items-center rounded-[9px] border-0 bg-transparent text-ink2 hover:bg-surface2" aria-label="Close">
              <Icon name="close" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Drawer({ open, onOpenChange, title, sub, children, footer, width = 460, className }: { open: boolean; onOpenChange: (v: boolean) => void; title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: number; className?: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/35" />
        <D.Content className={cn("fixed bottom-0 right-0 top-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-card outline-none", className)} style={{ maxWidth: width }}>
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <D.Title className="m-0 font-display text-lg font-semibold leading-snug">{title}</D.Title>
              {sub ? <D.Description asChild><div className="mt-1 text-[13px] text-ink2">{sub}</div></D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
            </div>
            <D.Close className="grid h-9 w-9 flex-none place-items-center rounded-[9px] border-0 bg-transparent text-ink2 hover:bg-surface2" aria-label="Close">
              <Icon name="close" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function Confirm({ open, onOpenChange, title, children, confirmLabel = "Confirm", danger, onConfirm, loading }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; children: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; loading?: boolean }) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width={440}
      footer={
        <>
          <button className="h-10 rounded-[10px] border border-line bg-surface px-4 font-semibold hover:bg-surface2" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            disabled={loading}
            className="h-10 rounded-[10px] border-0 px-4 font-semibold disabled:opacity-60"
            style={{ background: danger ? "var(--err)" : "var(--pri)", color: danger ? "#fff" : "var(--on-pri)" }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[14px] text-ink2">{children}</div>
    </Modal>
  );
}
