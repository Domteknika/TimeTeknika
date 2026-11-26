import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useWorkspace } from "@/lib/app-context";
import { EntrySaves } from "@/lib/entry-saves";
import type { Entry } from "@/lib/types";

const Saves = createContext<EntrySaves | null>(null);
export function EntrySavesProvider({ children }: { children: ReactNode }) {
  const { state, mutate, connected } = useWorkspace();
  const writer = useRef(mutate);
  writer.current = mutate;
  const [saves] = useState(() => new EntrySaves("timeteknika:edits:" + state.me.id,
    (path, method, data, key) => writer.current<{ entry: Entry }>(path, method, data, "", key)));
  useEffect(() => {
    saves.activate();
    return () => saves.pause();
  }, [saves]);
  useEffect(() => { if (connected) saves.recover(); }, [saves, connected]);
  return <Saves.Provider value={saves}>{children}</Saves.Provider>;
}
export function useEntrySaves() {
  const saves = useContext(Saves);
  if (!saves) throw Error("Session de saisie requise.");
  useSyncExternalStore(saves.subscribe, saves.snapshot);
  return saves;
}
export function SaveStatus({ draftKey, entry }: { draftKey: string; entry?: Entry }) {
  const saves = useEntrySaves(), d = saves.get(draftKey);
  if (!d) return null;
  const pending = d.flight || Object.keys(d.pending).length > 0;
  return <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <span role={d.error ? "alert" : "status"}>{d.error || (pending ? "En cours d’enregistrement…" : "✓ Enregistré")}</span>
    {d.error && pending && <button type="button" className="underline" onClick={() => saves.retry(draftKey)}>
      {d.conflict ? "Appliquer ma correction" : "Réessayer"}
    </button>}
    {d.error && <button type="button" className="underline" onClick={() => saves.clear(draftKey)}>Écarter ma correction</button>}
    {!pending && !d.error && d.undo && <button type="button" className="underline" onClick={() => saves.undo(draftKey, entry)}>Annuler la modification</button>}
  </div>;
}
