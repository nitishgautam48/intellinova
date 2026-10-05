"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Chips, Kicker, MultiPick, Panel, StatusPill, Table, Row } from "@/components/admin/kit";
import { Button, Checkbox, ErrorState, Field, Icon, Input, Loading, Select, Textarea } from "@/components/ui";
import { Confirm, Modal } from "@/components/ui/dialog";
import { api, useApi } from "@/lib/api";

type CRow = {
  id: string; is_rule: boolean; n: string; c: string; k: string; src: string; url: string; d: string; s: string; up: string[]; down: string[];
  note?: string; from_id?: string; to_id?: string; summary?: string; description?: string; meta?: Record<string, unknown>; up_ids?: string[]; down_ids?: string[]; ntype?: string;
};
type CNode = { id: string; name: string; type: string };
type Careers = { counts: { k: string; l: string; n: number }[]; rows: CRow[]; dimensions: { key: string; label: string; note: string }[]; nodes: CNode[] };

const NTYPE: Record<string, string> = { interests: "interest", subjects: "subject", combos: "combination", degrees: "degree", entrances: "entrance", areas: "area" };
const TYPE_LABEL: Record<string, string> = { interest: "Interest", subject: "Subject", combination: "Combination", degree: "Degree direction", entrance: "Entrance pathway", area: "Career area" };
const DIM_VALUES = ["Well supported", "Possible", "Limited"];

type NodeForm = { name: string; summary: string; description: string; source_name: string; source_url: string; verify: boolean; up_ids: string[]; down_ids: string[]; icon: string; considerations: string; dims: Record<string, string>; subjects: string };

function NodeModal({ open, ntype, row, data, onClose, onSaved }: { open: boolean; ntype: string; row: CRow | null; data: Careers; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<NodeForm | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const m = (row?.meta || {}) as { icon?: string; considerations?: string; dimensions?: Record<string, string>; subjects?: string[] };
    setF({
      name: row?.n || "", summary: row?.summary || "", description: row?.description || "", source_name: row && row.src !== "—" ? row.src : "", source_url: row?.url || "",
      verify: false, up_ids: row?.up_ids || [], down_ids: row?.down_ids || [], icon: m.icon || "", considerations: m.considerations || "", dims: m.dimensions || {}, subjects: (m.subjects || []).join(", "),
    });
  }, [open, row]);
  if (!open || !f) return null;
  const opts = data.nodes.filter((n) => n.id !== row?.id).map((n) => ({ id: n.id, name: n.name, hint: TYPE_LABEL[n.type] }));
  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Enter a name.");
    if (f.verify && !f.source_name.trim()) return toast.error("Record a source before marking this verified.");
    const meta: Record<string, unknown> = { ...(row?.meta || {}) };
    if (f.icon) meta.icon = f.icon; else delete meta.icon;
    if (ntype === "combination") {
      meta.considerations = f.considerations;
      meta.dimensions = Object.fromEntries(Object.entries(f.dims).filter(([, v]) => v));
      const subs = f.subjects.split(",").map((s) => s.trim()).filter(Boolean);
      if (subs.length) meta.subjects = subs; else delete meta.subjects;
    }
    const body = { name: f.name.trim(), summary: f.summary, description: f.description, source_name: f.source_name, source_url: f.source_url, verify: f.verify, up_ids: f.up_ids, down_ids: f.down_ids, meta };
    setBusy(true);
    try {
      if (row) await api.patch(`/api/admin/careers/nodes/${row.id}`, body);
      else await api.post("/api/admin/careers/nodes", { ...body, ntype });
      toast.success("Saved");
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`${row ? "Edit" : "Add"} ${TYPE_LABEL[ntype]?.toLowerCase() || "entry"}`} width={620} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 160px" }}>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Icon" hint="Material Symbols"><Input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} placeholder="explore" /></Field>
        </div>
        <Field label="Summary" hint="One line shown on cards."><Input value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
        <Field label="Description"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Comes from" hint="Earlier steps that lead here (e.g. subjects → this combination).">
          <MultiPick value={f.up_ids} onChange={(v) => setF({ ...f, up_ids: v })} options={opts} exclude={f.down_ids} placeholder="Search nodes…" />
        </Field>
        <Field label="Leads to">
          <MultiPick value={f.down_ids} onChange={(v) => setF({ ...f, down_ids: v })} options={opts} exclude={f.up_ids} placeholder="Search nodes…" />
        </Field>
        {ntype === "combination" && (
          <>
            <Field label="Subjects in this combination" hint="Comma-separated. Leave blank to use the linked subjects."><Input value={f.subjects} onChange={(e) => setF({ ...f, subjects: e.target.value })} /></Field>
            <Field label="Things to consider"><Textarea rows={2} value={f.considerations} onChange={(e) => setF({ ...f, considerations: e.target.value })} /></Field>
            {data.dimensions.length > 0 && (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
                {data.dimensions.map((d) => (
                  <Field key={d.key} label={d.label}>
                    <Select value={f.dims[d.key] || ""} onChange={(e) => setF({ ...f, dims: { ...f.dims, [d.key]: e.target.value } })}>
                      <option value="">Not rated</option>
                      {DIM_VALUES.map((v) => <option key={v}>{v}</option>)}
                    </Select>
                  </Field>
                ))}
              </div>
            )}
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source"><Input value={f.source_name} onChange={(e) => setF({ ...f, source_name: e.target.value })} placeholder="e.g. UGC, NTA, university site" /></Field>
          <Field label="Source URL"><Input value={f.source_url} onChange={(e) => setF({ ...f, source_url: e.target.value })} placeholder="https://" /></Field>
        </div>
        <Checkbox checked={f.verify} onChange={(v) => setF({ ...f, verify: v })}>Checked against the source today (mark verified)</Checkbox>
      </div>
    </Modal>
  );
}

type RuleForm = { from_id: string; to_id: string; requirement: string; label: string; note: string; source_name: string; source_url: string; verify: boolean };

function RuleModal({ open, row, data, onClose, onSaved }: { open: boolean; row: CRow | null; data: Careers; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<RuleForm | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF({ from_id: row?.from_id || "", to_id: row?.to_id || "", requirement: row?.k || "Required", label: row?.n || "", note: row?.note || "", source_name: row && row.src !== "—" ? row.src : "", source_url: row?.url || "", verify: false });
  }, [open, row]);
  if (!open || !f) return null;
  const save = async () => {
    if (!f.from_id || !f.to_id) return toast.error("Choose both ends of the rule.");
    if (f.verify && !f.source_name.trim()) return toast.error("Record a source before marking this rule verified.");
    setBusy(true);
    try {
      if (row) await api.patch(`/api/admin/careers/rules/${row.id}`, { requirement: f.requirement, label: f.label, note: f.note, source_name: f.source_name, source_url: f.source_url, verify: f.verify });
      else await api.post("/api/admin/careers/rules", f);
      toast.success("Rule saved");
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const grouped = Object.entries(TYPE_LABEL).map(([t, l]) => ({ l, nodes: data.nodes.filter((n) => n.type === t) })).filter((g) => g.nodes.length);
  const NodeSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={!!row}>
      <option value="">Choose…</option>
      {grouped.map((g) => (
        <optgroup key={g.l} label={g.l}>
          {g.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </optgroup>
      ))}
    </Select>
  );
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={row ? "Edit eligibility rule" : "Add eligibility rule"} sub="e.g. Mathematics is Required for B.Tech admission." width={560} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From (subject, combination…)"><NodeSelect value={f.from_id} onChange={(v) => setF({ ...f, from_id: v })} /></Field>
          <Field label="To (degree, entrance…)"><NodeSelect value={f.to_id} onChange={(v) => setF({ ...f, to_id: v })} /></Field>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "160px 1fr" }}>
          <Field label="Requirement">
            <Select value={f.requirement} onChange={(e) => setF({ ...f, requirement: e.target.value })}>
              {["Required", "Recommended", "Useful"].map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Field>
          <Field label="Label" hint="Optional display name"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        </div>
        <Field label="Note shown to students"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. for most IITs and NITs via JEE Main" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source"><Input value={f.source_name} onChange={(e) => setF({ ...f, source_name: e.target.value })} /></Field>
          <Field label="Source URL"><Input value={f.source_url} onChange={(e) => setF({ ...f, source_url: e.target.value })} placeholder="https://" /></Field>
        </div>
        <Checkbox checked={f.verify} onChange={(v) => setF({ ...f, verify: v })}>Checked against the source today (mark verified)</Checkbox>
      </div>
    </Modal>
  );
}

function DimsModal({ open, data, onClose, onSaved }: { open: boolean; data: Careers; onClose: () => void; onSaved: () => void }) {
  const [dims, setDims] = useState(data.dimensions);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setDims(data.dimensions.length ? data.dimensions : [{ key: "", label: "", note: "" }]);
  }, [open, data.dimensions]);
  const save = async () => {
    setBusy(true);
    try {
      await api.put("/api/admin/careers/dimensions", { dimensions: dims.filter((d) => d.key.trim() && d.label.trim()) });
      toast.success("Comparison dimensions saved");
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Comparison dimensions" sub="Columns students see when comparing subject combinations. Rate each combination in its editor." width={640} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="flex flex-col gap-2">
        {dims.map((d, i) => (
          <div key={i} className="grid items-end gap-2" style={{ gridTemplateColumns: "110px 1fr 1.3fr 30px" }}>
            <Field label={i ? "" : "Key"}><Input value={d.key} onChange={(e) => setDims(dims.map((x, j) => (j === i ? { ...x, key: e.target.value.replace(/\W/g, "").toLowerCase() } : x)))} className="font-mono text-xs" /></Field>
            <Field label={i ? "" : "Label"}><Input value={d.label} onChange={(e) => setDims(dims.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></Field>
            <Field label={i ? "" : "Note"}><Input value={d.note} onChange={(e) => setDims(dims.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /></Field>
            <button onClick={() => setDims(dims.filter((_, j) => j !== i))} className="mb-1.5 grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-ink2 hover:bg-surface2" aria-label="Remove"><Icon name="close" size={17} /></button>
          </div>
        ))}
        <Button size="xs" icon="add" className="self-start" onClick={() => setDims([...dims, { key: "", label: "", note: "" }])}>Dimension</Button>
      </div>
    </Modal>
  );
}

export default function CareerData() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const entity = params.get("entity") || "rules";
  const { data, error, mutate } = useApi<Careers>(`/api/admin/careers?entity=${entity}`, { keepPreviousData: true });
  const [selId, setSelId] = useState<string | null>(params.get("sel"));
  const [modal, setModal] = useState<null | "add" | "edit" | "dims">(null);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);

  const setEntity = (k: string) => {
    setSelId(null);
    router.replace(`${path}?entity=${k}`, { scroll: false });
  };

  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Loading />;
  const isRules = entity === "rules";
  const sel = data.rows.find((r) => r.id === selId) || data.rows[0] || null;
  const label = data.counts.find((c) => c.k === entity)?.l || "Career data";
  const cols = "2fr 1.3fr .9fr 1.2fr .9fr 1fr";

  const verify = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      await api.patch(sel.is_rule ? `/api/admin/careers/rules/${sel.id}` : `/api/admin/careers/nodes/${sel.id}`, { verify: true });
      toast.success("Marked verified today");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
          {data.counts.map((c) => {
            const on = c.k === entity;
            return (
              <button key={c.k} onClick={() => setEntity(c.k)} className="flex h-[34px] flex-none items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold" style={{ borderColor: on ? "var(--ink)" : "var(--line)", background: on ? "var(--ink)" : "var(--surface)", color: on ? "var(--bg)" : "var(--ink)" }}>
                {c.l}
                <span className="font-mono text-[11px] font-medium opacity-70">{c.n}</span>
              </button>
            );
          })}
        </div>
        <Button size="sm" icon="tune" onClick={() => setModal("dims")}>Comparison dimensions</Button>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[2_1_520px]">
          <Table cols={cols} minWidth={680} title={label} right={<Button size="xs" variant="primary" onClick={() => setModal("add")}>+ Add</Button>} headers={["Name", "Connections", "Rule", "Source", "Verified", "Status"]} empty={`No ${label.toLowerCase()} yet.`}>
            {data.rows.map((r) => (
              <Row key={r.id} cols={cols} onClick={() => setSelId(r.id)} active={sel?.id === r.id}>
                <strong className="truncate">{r.n}</strong>
                <span className="truncate text-ink2">{r.c}</span>
                <span>{r.k}</span>
                <span className="truncate">{r.src}</span>
                <span className="font-mono text-xs text-ink2">{r.d || "—"}</span>
                <span><StatusPill s={r.s} /></span>
              </Row>
            ))}
          </Table>
        </div>
        <Panel className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          {sel ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <Kicker>SELECTED</Kicker>
                <StatusPill s={sel.s} />
              </div>
              <div className="font-display text-[19px] font-semibold leading-tight">{sel.n}</div>
              {sel.is_rule ? (
                <div className="text-[13px] text-ink2">{sel.c} · <strong className="text-ink">{sel.k}</strong>{sel.note ? ` · ${sel.note}` : ""}</div>
              ) : (
                sel.summary && <div className="text-[13px] text-ink2">{sel.summary}</div>
              )}
              {!!sel.up.length && (
                <div>
                  <div className="mb-1.5 text-xs font-bold text-ink2">Comes from</div>
                  <Chips items={sel.up} />
                </div>
              )}
              {!!sel.down.length && (
                <div>
                  <div className="mb-1.5 text-xs font-bold text-ink2">Leads to</div>
                  <Chips items={sel.down} tone="pri" />
                </div>
              )}
              <div className="flex flex-col gap-1 rounded-xl border border-line p-3">
                <div className="text-xs font-bold text-ink2">Source</div>
                <div className="text-[13px] font-semibold">{sel.src}</div>
                {sel.url && <a href={sel.url} target="_blank" rel="noreferrer" className="truncate font-mono text-[11px]">{sel.url}</a>}
                <div className="font-mono text-[11px] text-ink2">Last verified: {sel.d || "never"}</div>
              </div>
              <div className="text-xs text-ink2">Students see verified facts with a source badge. AI explanations are generated separately and never edit this record.</div>
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" loading={busy} disabled={sel.src === "—"} title={sel.src === "—" ? "Add a source first" : undefined} onClick={verify}>Mark verified today</Button>
                <Button onClick={() => setModal("edit")}>{sel.is_rule ? "Edit rule" : "Edit links"}</Button>
                <Button variant="danger" icon="delete" aria-label="Delete" onClick={() => setDel(true)} />
              </div>
            </>
          ) : (
            <div className="text-[13px] text-ink2">Nothing selected.</div>
          )}
        </Panel>
      </div>

      {isRules ? (
        <RuleModal open={modal === "add" || modal === "edit"} row={modal === "edit" ? sel : null} data={data} onClose={() => setModal(null)} onSaved={() => mutate()} />
      ) : (
        <NodeModal open={modal === "add" || modal === "edit"} ntype={NTYPE[entity]} row={modal === "edit" ? sel : null} data={data} onClose={() => setModal(null)} onSaved={() => mutate()} />
      )}
      <DimsModal open={modal === "dims"} data={data} onClose={() => setModal(null)} onSaved={() => mutate()} />
      <Confirm open={del} onOpenChange={setDel} title={`Delete “${sel?.n}”?`} danger confirmLabel="Delete" onConfirm={async () => {
        setDel(false);
        try {
          await api.del(sel!.is_rule ? `/api/admin/careers/rules/${sel!.id}` : `/api/admin/careers/nodes/${sel!.id}`);
          setSelId(null);
          toast.success("Deleted");
          mutate();
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}>
        {sel?.is_rule ? "Students will no longer see this requirement." : "This also removes every link and rule attached to it. Students who saved it will lose it."}
      </Confirm>
    </div>
  );
}
