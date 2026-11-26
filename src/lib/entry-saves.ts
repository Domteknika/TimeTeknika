import { ApiError } from "./api";
import type { Entry } from "./types";

export type EntryFields = Pick<Entry, "description" | "task_id" | "project_id" | "start" | "end">;
type Patch = Partial<EntryFields>;
type Change = { values: Patch; before: Patch; version?: number; key: string; confirmOverlap: boolean };
type Draft = {
  base?: Entry; pending: Patch; flight?: Change; confirmOverlap: boolean;
  error?: string; conflict?: boolean; undo?: { before: Patch; after: Patch };
};
type Send = (path: string, method: string, data: unknown, key: string) => Promise<{ entry: Entry }>;
const fields = (patch: Patch) => Object.keys(patch) as (keyof EntryFields)[];
const select = (entry: Patch, patch: Patch): Patch =>
  Object.fromEntries(fields(patch).map(key => [key, entry[key]]));
const matches = (entry: Patch, patch: Patch) => fields(patch).every(key => patch[key] === entry[key]);

// One writer per entry, shared by every form in this workspace. Keep the exact
// in-flight request until acknowledged so a lost POST response cannot duplicate time.
export class EntrySaves {
  private drafts: Record<string, Draft> = {};
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private writes = new Map<string, Promise<Entry | undefined>>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private active = true;
  constructor(private storageKey: string, private send: Send) {
    try { this.drafts = JSON.parse(sessionStorage.getItem(storageKey) || "{}"); } catch { /* private storage unavailable */ }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  private changed() {
    if (!this.active) return;
    const unfinished = Object.fromEntries(Object.entries(this.drafts).filter(([, d]) => d.flight || fields(d.pending).length || d.error));
    try { sessionStorage.setItem(this.storageKey, JSON.stringify(unfinished)); } catch { /* keep the in-memory draft */ }
    this.revision++;
    this.listeners.forEach(listener => listener());
  }
  activate() { this.active = true; this.recover(); }
  pause() { this.active = false; this.timers.forEach(clearTimeout); this.timers.clear(); }
  recover() {
    for (const [id, d] of Object.entries(this.drafts)) {
      if (!d.conflict && (d.flight || fields(d.pending).length)) void this.flush(id).catch(() => {});
    }
  }
  get(id: string) { return this.drafts[id]; }
  outstanding() { return Object.entries(this.drafts).filter(([, d]) => d.error); }
  keyFor(entry: Entry) {
    return Object.keys(this.drafts).find(k => this.drafts[k].base?.id === entry.id) ?? entry.id;
  }
  latest(id: string, entry?: Entry) {
    const saved = this.drafts[id]?.base;
    return saved && (!entry || saved.version > entry.version) ? saved : entry;
  }
  values(id: string, entry?: Entry): Patch {
    const d = this.drafts[id];
    return { ...this.latest(id, entry), ...d?.flight?.values, ...d?.pending };
  }
  edit(id: string, entry: Entry | undefined, values: Patch, delay = 0, confirmOverlap = false) {
    const d = this.drafts[id] ??= { base: entry, pending: {}, confirmOverlap: false };
    if (!d.flight && !fields(d.pending).length) d.base = this.latest(id, entry);
    Object.assign(d.pending, values);
    if ("start" in values || "end" in values) d.confirmOverlap = confirmOverlap;
    if (!d.conflict) d.error = undefined;
    clearTimeout(this.timers.get(id));
    this.changed();
    if (!d.conflict) this.timers.set(id, setTimeout(() => { void this.flush(id).catch(() => {}); }, delay));
  }
  suspendTiming(id: string, creating: boolean) {
    const d = this.drafts[id];
    if (!d) return;
    if (creating) d.pending = {};
    else { delete d.pending.start; delete d.pending.end; }
    this.changed();
  }
  clear(id: string) {
    if (this.writes.has(id)) return;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    delete this.drafts[id];
    this.changed();
  }
  async flush(id: string): Promise<Entry | undefined> {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const running = this.writes.get(id);
    if (running) return running;
    const d = this.drafts[id];
    if (!d) return;
    if (d.conflict) throw Error(d.error);
    const write = this.drain(d).finally(() => { this.writes.delete(id); this.changed(); });
    this.writes.set(id, write);
    return write;
  }
  private async drain(d: Draft) {
    while (this.active && (d.flight || fields(d.pending).length)) {
      if (!d.flight) {
        const values = d.pending;
        d.pending = {};
        if (d.base && matches(d.base, values)) { this.changed(); continue; }
        d.flight = { values, before: select(d.base ?? {}, values), version: d.base?.version,
          key: crypto.randomUUID(), confirmOverlap: d.confirmOverlap };
      }
      const job = d.flight;
      const data = { ...job.values, version: job.version, confirmOverlap: job.confirmOverlap,
        ...(job.values.start !== undefined && { start: new Date(job.values.start).toISOString() }),
        ...(job.values.end != null && { end: new Date(job.values.end).toISOString() }) };
      d.error = undefined;
      this.changed();
      try {
        const result = await this.send(d.base ? "/api/entries/" + d.base.id : "/api/entries", d.base ? "PATCH" : "POST", data, job.key);
        d.undo = d.base ? { before: job.before, after: select(result.entry, job.values) } : undefined;
        d.base = result.entry;
        d.flight = undefined;
        this.changed();
      } catch (e) {
        d.error = (e as Error).message;
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          d.pending = { ...job.values, ...d.pending };
          d.flight = undefined;
          const current = (e.details as { current?: Entry } | undefined)?.current;
          if (e.code === "version_conflict" && current) {
            const disjoint = !!d.base && current.end === d.base.end && matches(current, select(d.base, d.pending));
            d.base = current;
            if (disjoint) continue;
            d.conflict = true;
            d.error = "Ce pointage a changé ailleurs. Votre saisie est conservée.";
          }
        }
        this.changed();
        throw Error(d.error);
      }
    }
    return d.base;
  }
  retry(id: string) {
    const d = this.drafts[id];
    if (d) { d.conflict = false; void this.flush(id).catch(() => {}); }
  }
  undo(id: string, latest?: Entry) {
    const d = this.drafts[id], entry = this.latest(id, latest);
    if (!d?.undo || !entry) return;
    if (!matches(entry, d.undo.after)) {
      d.undo = undefined;
      d.error = "La valeur a changé ailleurs. Rouvrez le pointage pour la vérifier.";
      this.changed(); return;
    }
    const inverse = d.undo.before;
    d.undo = undefined;
    this.edit(id, entry, inverse);
  }
}
