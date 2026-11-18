import { useEffect, useState, useMemo, useId, useRef } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/app-context";
import { api, ApiError } from "@/lib/api";
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
  NativeSelect,
} from "./shared";
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
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0].value),
    [status, setStatus] = useState(task?.status ?? "todo");
  const [assignees, setAssignees] = useState(task?.assignees ?? [state.me.id]);
  return (
    <Modal
      title={(item ? "Modifier le " : "Créer un ") + names[kind]}
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
              status,
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
          <>
            <Field label="Statut">
              <NativeSelect
                label="Statut"
                value={status}
                onChange={(v) => setStatus(v as Task["status"])}
                options={[
                  ["todo", "À faire"],
                  ["doing", "En cours"],
                  ["done", "Terminée"],
                ]}
              />
            </Field>
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
          </>
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
  const [entry, setEntry] = useState(initialEntry);
  const deleteHintId = useId();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [taskSaved, setTaskSaved] = useState(false);
  const [taskError, setTaskError] = useState("");
  const taskWrite = useRef(false);
  const [now] = useState(() => Date.now() + clockOffset.current);
  const [taskId, setTask] = useState(entry?.task_id ?? ""),
    [projectId, setProject] = useState(entry?.project_id ?? "");
  const [start, setStart] = useState(
    initialStart ?? wallTime(entry?.start ?? now - 3600000),
  );
  const [end, setEnd] = useState(initialEnd ?? wallTime(entry?.end ?? now));
  const [running, setRunning] = useState(entry?.end === null),
    [confirmOverlap, setConfirm] = useState(false),
    [createTask, setCreateTask] = useState(false),
    [precise, setPrecise] = useState(false),
    [serverOverlap, setServerOverlap] = useState(false);
  useEffect(() => { setConfirm(false); setServerOverlap(false); }, [start, end, running]);
  const timing = useMemo(() => {
    try {
      const from = editedInstant(start, entry?.start), to = running ? now : editedInstant(end, entry?.end);
      return { seconds: (to - from) / 1000, overlap: state.entries.some(e => e.user_id === state.me.id && e.id !== entry?.id && e.start < to && (e.end ?? now) > from) };
    } catch { return null; }
  }, [start, end, running, now, entry, state.entries, state.me.id]);
  const latest = entry && state.entries.find((e) => e.id === entry.id);
  const stale = entry && !savingTask && (!latest || latest.version !== entry.version);
  async function chooseClassification(task: string, project: string, field: "task" | "project") {
    if (taskWrite.current || deleting) return;
    setTask(task);
    setProject(project);
    setTaskSaved(false);
    setTaskError("");
    if (!entry || field !== "task") return;
    if (task === (entry.task_id ?? "") && project === (entry.project_id ?? "")) return;
    if (stale || entry.user_id !== state.me.id) {
      setTask(entry.task_id ?? ""); setProject(entry.project_id ?? "");
      setTaskError("Cette entrée a changé. Fermez puis rouvrez-la avant de choisir une tâche.");
      return;
    }
    taskWrite.current = true;
    setSavingTask(true);
    try {
      const result = await mutate<{ entry: Entry }>("/api/entries/" + entry.id, "PATCH", {
        task_id: task || null, project_id: project || null,
        // Only classification changes: preserve persisted text and exact times,
        // including any previously accepted overlap. Other fields remain drafts.
        description: entry.description, start: new Date(entry.start).toISOString(),
        end: entry.end === null ? null : new Date(entry.end).toISOString(),
        version: entry.version, confirmOverlap: true,
      }, "");
      setEntry(result.entry);
      setTaskSaved(true);
    } catch (error) {
      setTask(entry.task_id ?? ""); setProject(entry.project_id ?? "");
      setTaskError((error instanceof ApiError && error.status === 0
        ? "Impossible de confirmer l’enregistrement de la tâche. "
        : "La tâche n’a pas été enregistrée. ") + (error as Error).message);
    } finally {
      taskWrite.current = false;
      setSavingTask(false);
    }
  }
  return (
    <>
      <Modal
        title={entry ? "Modifier le temps" : "Ajouter du temps"}
        description="Ajustez votre activité et ses horaires."
        onClose={() => { if (!deleting && !taskWrite.current) onClose(); }}
      >
        <AsyncForm
          onCancel={onClose}
          disabled={savingTask || deleting}
          actions={entry?.user_id === state.me.id && (
            <Button
              type="button"
              variant="destructive"
              aria-label="Supprimer ce temps"
              aria-describedby={entry.end === null ? deleteHintId : undefined}
              disabled={!!stale || entry.end === null || deleting}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 /> Supprimer
            </Button>
          )}
          onSubmit={async (f) => {
            if (taskWrite.current) return;
            if (stale)
              throw Error(
                "Cette entrée a changé. Fermez cette fenêtre puis rouvrez la version actualisée.",
              );
            try { await mutate(
              "/api/entries" + (entry ? "/" + entry.id : ""),
              entry ? "PATCH" : "POST",
              {
                task_id: taskId || null,
                project_id: projectId || null,
                description: f.get("description"),
                start: new Date(
                  editedInstant(start, entry?.start),
                ).toISOString(),
                end: running
                  ? null
                  : new Date(editedInstant(end, entry?.end)).toISOString(),
                version: entry?.version,
                confirmOverlap,
              },
            ); } catch (e) {
              if (e instanceof ApiError && e.code === "overlap") setServerOverlap(true);
              throw e;
            }
            onClose();
          }}
        >
          <Field label="Description">
            <Textarea
              name="description"
              defaultValue={entry?.description ?? ""}
              maxLength={2000}
              placeholder="Sur quoi avez-vous travaillé ?"
              autoFocus
            />
          </Field>
          <div className="grid gap-2">
            <Classification
              showLabels
              taskId={taskId}
              projectId={projectId}
              originalTaskId={entry?.task_id}
              disabled={savingTask || deleting || !!stale}
              onChange={(t, p, field) => { void chooseClassification(t, p, field); }}
            />
            {entry && <p role="status" className="text-xs text-muted-foreground">
              {savingTask ? "Enregistrement de la tâche…" : taskSaved ? "Tâche enregistrée." : "La tâche est enregistrée dès sa sélection."}
              {" "}Les autres champs se valident avec Enregistrer.
            </p>}
            <ErrorMessage message={taskError} />
            <Button
              type="button"
              variant="link"
              className="justify-start px-0"
              onClick={() => setCreateTask(true)}
            >
              + Créer une tâche
            </Button>
          </div>
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">Horaires</span>
              <span className="text-xs text-muted-foreground">Europe/Zurich</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <EntryDateTime label="Début" value={start} onChange={setStart} precise={precise} />
              <EntryDateTime label="Fin" value={end} onChange={setEnd} precise={precise} disabled={running} />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <span className="text-sm font-medium">
                {running ? "Chrono en cours" : timing && timing.seconds >= 0 ? "Durée : " + duration(timing.seconds, precise) : "Vérifiez les horaires"}
              </span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={precise} onCheckedChange={v => setPrecise(!!v)} />
                Afficher les secondes
              </label>
            </div>
          </div>
          {entry?.end === null && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={running}
                onCheckedChange={(v) => setRunning(!!v)}
              />
              Laisser le chrono en cours
            </label>
          )}
          {(timing?.overlap || serverOverlap) && <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <Checkbox
              checked={confirmOverlap}
              onCheckedChange={(v) => setConfirm(!!v)}
            />
            <span>Ce créneau chevauche un autre de vos temps. Je confirme que ce chevauchement est voulu.</span>
          </label>}
          {stale && (
            <ErrorMessage message="Cette entrée a été modifiée ailleurs. Fermez puis rouvrez-la avant d’enregistrer." />
          )}
          {entry?.end === null && (
            <p id={deleteHintId} className="text-xs text-muted-foreground">
              Arrêtez le chrono avant de supprimer ce temps.
            </p>
          )}
        </AsyncForm>
      </Modal>
      {confirmDelete && entry && (
        <Modal
          title="Supprimer ce temps ?"
          description="Cette entrée sera retirée des rapports. Son historique sera conservé."
          onClose={() => { if (!deleting) setConfirmDelete(false); }}
        >
          <AsyncForm
            submitLabel="Supprimer"
            destructive
            onCancel={() => setConfirmDelete(false)}
            onSubmit={async () => {
              if (stale)
                throw Error("Cette entrée a changé. Fermez cette fenêtre puis rouvrez la version actualisée.");
              if (entry.end === null || entry.user_id !== state.me.id)
                throw Error("Seuls vos temps arrêtés peuvent être supprimés.");
              setDeleting(true);
              try {
                await deleteEntry(entry, mutate);
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
          initialProject={projectId}
          onClose={() => setCreateTask(false)}
          onCreated={(t) => {
            void chooseClassification(t.id, t.project_id, "task");
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
  const [items, setItems] = useState<
      {
        id: string;
        actor_name: string;
        at: number;
        action: string;
        before: unknown;
        after: unknown;
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
              <b>{i.actor_name}</b> · {i.action}{" "}
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
