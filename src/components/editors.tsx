import { useEffect, useState, useId } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/app-context";
import { api } from "@/lib/api";
import type { Client, Project, Task, Entry } from "@/lib/types";
import {
  wallTime,
  editedInstant,
  prettyDay,
  dayKey,
  clockTime,
  duration,
} from "@/lib/time";
import { PROJECT_COLORS } from "../../public/project-colors.js";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Modal,
  AsyncForm,
  Field,
  Choice,
  ErrorMessage,
} from "./shared";
import { SaveStatus, useEntrySaves } from "./entry-autosave";
import type { EntryFields } from "@/lib/entry-saves";
import { Classification } from "./classification";
export type CatalogKind = "clients" | "projects" | "tasks";
const names = { clients: "client", projects: "projet", tasks: "tâche" };
export function CatalogEditor({
  kind,
  item,
  onClose,
  onCreated,
  initialProject = "",
}: {
  kind: CatalogKind;
  item?: Client | Project | Task;
  onClose: () => void;
  onCreated?: (item: Task) => void;
  initialProject?: string;
}) {
  const { state, mutate } = useWorkspace();
  const task = kind === "tasks" ? (item as Task | undefined) : undefined,
    project = kind === "projects" ? (item as Project | undefined) : undefined;
  const [parent, setParent] = useState(
    task?.project_id ?? project?.client_id ?? initialProject,
  );
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0].value);
  const [assignees, setAssignees] = useState(task?.assignees ?? [state.me.id]);
  return (
    <Modal
      title={kind === "tasks"
        ? (item ? "Modifier la tâche" : "Créer une tâche")
        : (item ? "Modifier le " : "Créer un ") + names[kind]}
      onClose={onClose}
    >
      <AsyncForm
        onCancel={onClose}
        onSubmit={async (f) => {
          const data: Record<string, unknown> = {
            name: f.get("name"),
            version: item?.version,
          };
          if (kind === "projects")
            Object.assign(data, {
              client_id: parent,
              color,
              description: f.get("description"),
            });
          if (kind === "tasks")
            Object.assign(data, {
              project_id: parent,
              description: f.get("description"),
              assignees,
            });
          const result = await mutate<{ task?: Task }>(
            "/api/" + kind + (item ? "/" + item.id : ""),
            item ? "PATCH" : "POST",
            data,
          );
          if (result.task) onCreated?.(result.task);
          onClose();
        }}
      >
        <Field label="Nom">
          <Input
            name="name"
            defaultValue={item?.name}
            required
            maxLength={kind === "tasks" ? 200 : kind === "projects" ? 150 : 100}
            autoFocus
          />
        </Field>
        {kind !== "clients" && (
          <Field label={kind === "projects" ? "Client" : "Projet"}>
            <Choice
              label={
                kind === "projects" ? "Client du projet" : "Projet de la tâche"
              }
              value={parent}
              onChange={setParent}
              placeholder="Sélectionner…"
              disabled={!!project}
              options={(kind === "projects"
                ? state.clients
                : state.projects.filter((p) => !p.archived || p.id === parent)
              ).map((x) => ({ value: x.id, label: x.name }))}
            />
          </Field>
        )}
        {kind !== "clients" && (
          <Field label="Description">
            <Textarea
              name="description"
              defaultValue={task?.description ?? project?.description}
              maxLength={2000}
              disabled={!!project}
            />
          </Field>
        )}
        {kind === "projects" && (
          <Field label="Couleur">
            <div className="flex flex-wrap gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-label={c.name ?? c.value}
                  aria-pressed={color === c.value}
                  className={
                    "size-8 rounded-full border-4 " +
                    (color === c.value
                      ? "border-foreground"
                      : "border-transparent")
                  }
                  style={{ background: c.value }}
                  onClick={() => setColor(c.value)}
                />
              ))}
            </div>
          </Field>
        )}
        {kind === "tasks" && (
          <Field label="Personnes affectées">
            <div className="grid gap-2">
              {state.users
                .filter((u) => u.active || task?.assignees.includes(u.id))
                .map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-3 rounded-md border p-3"
                  >
                    <Checkbox
                      checked={assignees.includes(u.id)}
                      onCheckedChange={(v) =>
                        setAssignees((previous) =>
                          v
                            ? [...previous, u.id]
                            : previous.filter((id) => id !== u.id),
                        )
                      }
                    />
                    {u.name}{!u.active && " (accès retiré)"}
                  </label>
                ))}
            </div>
          </Field>
        )}
      </AsyncForm>
    </Modal>
  );
}
export function EntryEditor({
  entry: initialEntry,
  initialStart,
  initialEnd,
  onClose,
}: {
  entry?: Entry;
  initialStart?: string;
  initialEnd?: string;
  onClose: () => void;
}) {
  const { state, clockOffset, mutate } = useWorkspace();
  const saves = useEntrySaves();
  const [draftKey] = useState(() => {
    if (initialEntry) return saves.keyFor(initialEntry);
    const prefix = "timeteknika:manual:" + state.me.id;
    const fresh = "manual-" + crypto.randomUUID();
    try {
      const previous = sessionStorage.getItem(prefix);
      const d = previous && saves.get(previous);
      if (previous && ((d && (d.flight || d.error || Object.keys(d.pending).length)) ||
        sessionStorage.getItem("timeteknika:form:" + state.me.id + ":" + previous))) return previous;
      sessionStorage.setItem(prefix, fresh);
    } catch { /* session storage unavailable */ }
    return fresh;
  });
  const draft = saves.get(draftKey);
  const id = initialEntry?.id ?? draft?.base?.id;
  const serverEntry = state.entries.find(e => e.id === id);
  const entry = saves.latest(draftKey, serverEntry ?? initialEntry);
  const window = state.entryWindow;
  const outsideWeek = entry && window && entry.task_id && entry.end !== null &&
    !(entry.start < window.to && entry.end >= window.from) && !(entry.start < window.next && entry.end >= window.current);
  const deleted = !!initialEntry && !serverEntry && !outsideWeek;
  const values = saves.values(draftKey, entry);
  const [opened] = useState(() => Date.now() + clockOffset.current);
  const initial = {
    start: values.start == null ? initialStart ?? wallTime(opened - 3600000) : wallTime(values.start),
    end: values.end == null ? initialEnd ?? wallTime(opened) : wallTime(values.end),
    running: values.end === null, task_id: values.task_id ?? null, project_id: values.project_id ?? null,
    description: values.description ?? "",
  };
  type Form = typeof initial;
  const rawKey = "timeteknika:form:" + state.me.id + ":" + draftKey;
  const [held, setHeld] = useState<Partial<Form>>(() => {
    try { return JSON.parse(sessionStorage.getItem(rawKey) || "{}"); } catch { return {}; }
  });
  const form = { ...initial, ...held };
  const [confirmOverlap, setConfirm] = useState(false), [invalid, setInvalid] = useState("");
  const [createTask, setCreateTask] = useState(false), [precise, setPrecise] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Entry | null>(null), [deleting, setDeleting] = useState(false);
  const deleteHintId = useId();
  function hold(next: Partial<Form>) {
    setHeld(next);
    try {
      if (Object.keys(next).length) sessionStorage.setItem(rawKey, JSON.stringify(next));
      else sessionStorage.removeItem(rawKey);
    } catch { /* current form still retains the draft */ }
  }
  function interval(f: Form) {
    const from = editedInstant(f.start, entry?.start), to = f.running ? null : editedInstant(f.end, entry?.end);
    if (to !== null && (to < from || to === from && (from !== entry?.start || to !== entry?.end)))
      throw Error("La fin doit suivre le début.");
    const until = to ?? Date.now() + clockOffset.current;
    return { from, to, seconds: (until - from) / 1000,
      overlap: state.entries.some(e => e.id !== id && e.user_id === state.me.id && e.start < until && (e.end ?? Date.now() + clockOffset.current) > from) };
  }
  let timing: ReturnType<typeof interval> | undefined;
  try { timing = interval(form); } catch { /* incomplete date input */ }
  function edit(change: Partial<Form>, consent = false) {
    if (deleted || deleting) return;
    const changes = { ...held, ...change }, next = { ...form, ...change };
    const timesChanged = "start" in changes || "end" in changes || "running" in changes;
    const approved = consent || (!timesChanged && confirmOverlap);
    if (timesChanged) setConfirm(approved);
    const patch: Partial<EntryFields> = {};
    try {
      if (!entry || timesChanged) {
        const { from, to, overlap } = interval(next);
        if (overlap && !approved && (from !== entry?.start || to !== entry?.end))
          throw Error("Ce créneau chevauche un autre temps. Confirmez le chevauchement pour l’enregistrer.");
        patch.start = from;
        patch.end = to;
      }
      if (!entry || "task_id" in changes || "project_id" in changes) {
        patch.task_id = next.task_id; patch.project_id = next.project_id;
      }
      if (!entry || "description" in changes) patch.description = next.description;
      hold({});
      setInvalid("");
      saves.edit(draftKey, entry, patch, timesChanged || "description" in change ? 500 : 0, approved);
    } catch (error) {
      saves.suspendTiming(draftKey, !entry);
      hold(!entry ? next : changes);
      setInvalid((error as Error).message);
    }
  }
  const close = async () => {
    if (deleting) return;
    if (Object.keys(held).length || deleted) { onClose(); return; }
    try {
      await saves.flush(draftKey);
      if (!initialEntry) saves.clear(draftKey);
      onClose();
    } catch { /* keep the draft and the retry control visible */ }
  };
  return (
    <>
      <Modal title={initialEntry ? "Modifier le temps" : "Ajouter du temps"} onClose={() => void close()}
        description="Vos modifications sont enregistrées automatiquement.">
        <div className="grid gap-5">
          <fieldset disabled={deleting || deleted} className="grid min-w-0 gap-5">
          <Field label="Description">
            <Textarea value={form.description} maxLength={2000} placeholder="Sur quoi avez-vous travaillé ?"
              onChange={e => edit({ description: e.target.value })} autoFocus />
          </Field>
          <div className="grid gap-2">
            <Classification showLabels taskId={form.task_id ?? ""} projectId={form.project_id ?? ""}
              originalTaskId={entry?.task_id} onChange={(task, project) => edit({ task_id: task || null, project_id: project || null })} />
            <Button type="button" variant="link" className="justify-start px-0" onClick={() => setCreateTask(true)}>
              + Créer une tâche
            </Button>
          </div>
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">Horaires</span>
              <span className="text-xs text-muted-foreground">Europe/Zurich</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <EntryDateTime label="Début" value={form.start} onChange={start => edit({start})} precise={precise} />
              <EntryDateTime label="Fin" value={form.end} onChange={end => edit({end})} precise={precise} disabled={form.running} />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span>{form.running ? "Chrono en cours" : timing ? "Durée : " + duration(timing.seconds, precise) : "Vérifiez les horaires"}</span>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={precise} onCheckedChange={v => setPrecise(!!v)} /> Afficher les secondes
              </label>
            </div>
          </div>
          {entry?.end === null && <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.running} onCheckedChange={v => edit({running: !!v})} /> Laisser le chrono en cours
          </label>}
          {(confirmOverlap || timing?.overlap || draft?.error?.includes("chevauche")) && <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={confirmOverlap} onCheckedChange={v => {
              setConfirm(!!v);
              if (v) edit({start: form.start, end: form.end}, true);
            }} /> Ce créneau chevauche un autre de vos temps. Je confirme que ce chevauchement est voulu.
          </label>}
          </fieldset>
          <ErrorMessage message={deleted ? "Ce temps a été supprimé." : invalid || (Object.keys(held).length ? "Brouillon à compléter." : "")} />
          {Object.keys(held).length > 0 && <Button variant="ghost" onClick={() => { hold({}); setInvalid(""); }}>Écarter le brouillon</Button>}
          <SaveStatus draftKey={draftKey} entry={entry} />
          {entry?.end === null && <p id={deleteHintId} className="text-xs text-muted-foreground">Arrêtez le chrono avant de supprimer ce temps.</p>}
          <div className="flex justify-end gap-2">
            {entry && <Button type="button" variant="destructive" className="mr-auto" aria-label="Supprimer ce temps"
              aria-describedby={entry.end === null ? deleteHintId : undefined}
              disabled={deleted || entry.end === null || deleting} onClick={async () => {
                try { const saved = await saves.flush(draftKey); setConfirmDelete(saved && saved.version > entry.version ? saved : entry); }
                catch { /* resolve the pending correction before deletion */ }
              }}><Trash2 /> Supprimer</Button>}
            <Button type="button" variant="outline" onClick={() => void close()}>Fermer</Button>
          </div>
        </div>
      </Modal>
      {confirmDelete && entry && (
        <Modal
          title="Supprimer ce temps ?"
          description="Cette entrée sera retirée des rapports. Son historique sera conservé."
          onClose={() => { if (!deleting) setConfirmDelete(null); }}
        >
          <AsyncForm
            submitLabel="Supprimer"
            destructive
            onCancel={() => setConfirmDelete(null)}
            onSubmit={async () => {
              if (deleted) throw Error("Ce temps a été supprimé.");
              if (entry.end === null || entry.user_id !== state.me.id)
                throw Error("Seuls vos temps arrêtés peuvent être supprimés.");
              setDeleting(true);
              try {
                await deleteEntry(confirmDelete, mutate);
                hold({}); saves.clear(draftKey);
                onClose();
              } finally { setDeleting(false); }
            }}
          >
            <p className="break-words text-sm">{entry.description || "Sans description"}</p>
          </AsyncForm>
        </Modal>
      )}
      {createTask && (
        <CatalogEditor
          kind="tasks"
          initialProject={form.project_id ?? ""}
          onClose={() => setCreateTask(false)}
          onCreated={(t) => {
            edit({ task_id: t.id, project_id: t.project_id });
          }}
        />
      )}
    </>
  );
}

function EntryDateTime({ label, value, onChange, precise, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; precise: boolean; disabled?: boolean;
}) {
  const [date = "", time = ""] = value.split("T");
  return <fieldset disabled={disabled} className="grid min-w-0 gap-2">
    <legend className="mb-2 text-sm font-medium">{label}</legend>
    <Input aria-label={"Date de " + label.toLowerCase()} type="date" required={!disabled}
      value={date} onChange={e => onChange(e.target.value + "T" + time)} />
    <Input aria-label={"Heure de " + label.toLowerCase()} type="time" required={!disabled}
      step={precise ? 1 : 60} value={precise ? time : time.slice(0, 5)}
      onChange={e => onChange(date + "T" + e.target.value + (e.target.value.length === 5 ? ":00" : ""))} />
  </fieldset>;
}

export function EntryHistory({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  const { state } = useWorkspace();
  function summary(action: string, before: Partial<Entry> | null, after: Partial<Entry> | null) {
    if (action === "delete") return "Pointage supprimé";
    if (action === "restore") return "Pointage rétabli";
    if (!before) return "Pointage créé";
    if (!after) return "Pointage supprimé";
    const details: string[] = [];
    if (before.task_id !== after.task_id) {
      const name = (id?: string | null) => state.tasks.find(t => t.id === id)?.name ?? (id ? "Tâche retirée" : "Sans tâche");
      details.push("Tâche : " + name(before.task_id) + " → " + name(after.task_id));
    }
    if (before.project_id !== after.project_id) {
      const name = (id?: string | null) => state.projects.find(p => p.id === id)?.name ?? (id ? "Projet retiré" : "Sans projet");
      details.push("Projet : " + name(before.project_id) + " → " + name(after.project_id));
    }
    if (before.description !== after.description) details.push("Description modifiée");
    if (before.start !== after.start) details.push("Début corrigé");
    if (before.end !== after.end) details.push(before.end === null ? "Chrono arrêté" : "Fin corrigée");
    return details.join(" · ") || "Pointage mis à jour";
  }
  const [items, setItems] = useState<
      {
        id: string;
        actor_name: string;
        at: number;
        action: string;
        before: Partial<Entry> | null;
        after: Partial<Entry> | null;
      }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<{ items: typeof items }>(
      "/api/entries/" + entry.id + "/history",
      "GET",
      undefined,
      undefined,
      controller.signal,
    )
      .then((x) => setItems(x.items))
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [entry.id]);
  return (
    <Modal
      title="Historique du temps"
      description={entry.description || "Sans description"}
      onClose={onClose}
      wide
    >
      <ErrorMessage message={error} />
      <div className="grid gap-3">
        {items.map((i) => (
          <details key={i.id} className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm">
              <b>{i.actor_name}</b> · {summary(i.action, i.before, i.after)}{" "}
              <span className="text-muted-foreground">
                {prettyDay(dayKey(i.at), true)} à {clockTime(i.at)}
              </span>
            </summary>
            <pre className="mt-3 overflow-auto text-xs">
              {JSON.stringify({ avant: i.before, après: i.after }, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </Modal>
  );
}
export function DeleteCatalog({
  kind,
  item,
  onClose,
}: {
  kind: CatalogKind;
  item: Client;
  onClose: () => void;
}) {
  const { mutate } = useWorkspace();
  const [plan, setPlan] = useState<{
      confirmation: string;
      counts: Record<string, number>;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api<typeof plan>(
      "/api/" + kind + "/" + item.id + "/deletion-preview",
      "GET",
      undefined,
      undefined,
      c.signal,
    )
      .then(setPlan)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [kind, item.id]);
  return (
    <Modal
      title={"Supprimer « " + item.name + " » ?"}
      description="Les temps sont conservés. Les liens vers les éléments supprimés seront retirés."
      onClose={onClose}
    >
      <ErrorMessage message={error} />
      {plan && (
        <AsyncForm
          submitLabel="Confirmer la suppression"
          onCancel={onClose}
          onSubmit={async () => {
            await mutate("/api/" + kind + "/" + item.id, "DELETE", {
              confirmation: plan.confirmation,
            });
            onClose();
          }}
        >
          <div className="rounded-lg bg-muted p-4 text-sm">
            {plan.counts.projects} projet(s), {plan.counts.tasks} tâche(s)
            concerné(s).
            <br />
            {plan.counts.entries} temps conservé(s), dont {plan.counts.running}{" "}
            chrono(s) en cours.
          </div>
        </AsyncForm>
      )}
    </Modal>
  );
}
export async function deleteEntry(
  entry: Entry,
  mutate: ReturnType<typeof useWorkspace>["mutate"],
) {
  await mutate(
    "/api/entries/" + entry.id,
    "DELETE",
    { version: entry.version },
    "",
  );
  toast("Temps supprimé.", {
    duration: 10000,
    action: {
      label: "Rétablir",
      onClick: () => {
        void mutate("/api/entries/" + entry.id + "/restore", "POST", {}).catch(
          (e) => toast.error(e.message),
        );
      },
    },
  });
}
