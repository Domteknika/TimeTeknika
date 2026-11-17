import { useState, useMemo, useId } from "react";
import { Check, ChevronsUpDown, ChevronDown, Pin, Search } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/app-context";
import { normalize } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Choice } from "./shared";
export function Classification({
  taskId,
  projectId,
  onChange,
  originalTaskId,
  disabled = false,
  showLabels = false,
}: {
  taskId: string;
  projectId: string;
  onChange: (task: string, project: string) => void;
  originalTaskId?: string | null;
  disabled?: boolean;
  showLabels?: boolean;
}) {
  const { state, preference } = useWorkspace();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const id = useId();
  const [localFlags, setLocalFlags] = useState<Record<string, { collapsed?: boolean; pinned?: boolean }>>({});
  const flagsFor = (id: string) => ({ ...state.me.preferences.taskProjects?.[id], ...localFlags[id] });
  async function changeFlag(projectId: string, key: "collapsed" | "pinned", value: boolean) {
    const previous = flagsFor(projectId)[key];
    setLocalFlags(flags => ({ ...flags, [projectId]: { ...flags[projectId], [key]: value } }));
    try { await preference({ taskProject: { projectId, [key]: value } }); }
    catch (e) {
      setLocalFlags(flags => ({ ...flags, [projectId]: { ...flags[projectId], [key]: previous } }));
      toast.error((e as Error).message);
    }
  }
  const selected = state.tasks.find((t) => t.id === taskId);
  const projects = [...state.projects]
    .filter((p) => !p.archived || p.id === projectId)
    .sort(
      (a, b) =>
        Number(!!flagsFor(b.id).pinned) -
          Number(!!flagsFor(a.id).pinned) ||
        a.name.localeCompare(b.name, "fr"),
    );
  const tasksByProject = useMemo(() => {
    const grouped = new Map<string, typeof state.tasks>();
    const search = normalize(query);
    const names = new Map(state.projects.map(p => [p.id, p.name]));
    for (const t of state.tasks) {
      if (projectId && t.project_id !== projectId) continue;
      if (!((!t.archived && t.assignees.includes(state.me.id)) || t.id === originalTaskId)) continue;
      if (!normalize(t.name + " " + names.get(t.project_id)).includes(search)) continue;
      const items = grouped.get(t.project_id) ?? [];
      items.push(t); grouped.set(t.project_id, items);
    }
    return grouped;
  }, [state.tasks, state.projects, state.me.id, projectId, originalTaskId, query]);
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="grid min-w-0 gap-2">
      {showLabels && <label htmlFor={id + "-project"} className="text-sm font-medium">Projet</label>}
      <Choice
        id={id + "-project"}
        label="Projet"
        value={projectId}
        disabled={disabled}
        onChange={(p) => onChange("", p)}
        options={[
          { value: "", label: "Sans projet" },
          ...projects.map((p) => ({
            value: p.id,
            label: p.name,
            color: p.color,
            detail: state.clients.find((c) => c.id === p.client_id)?.name,
          })),
        ]}
      />
      </div>
      <div className="grid min-w-0 gap-2">
      {showLabels && <label htmlFor={id + "-task"} className="text-sm font-medium">Tâche</label>}
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id + "-task"}
            disabled={disabled}
            type="button"
            variant="outline"
            role="combobox"
            aria-label="Tâche"
            aria-expanded={open}
            className="min-w-0 justify-between font-normal"
          >
            <span className="truncate">
              {selected?.name ?? "Sans tâche · à classer"}
            </span>
            <ChevronsUpDown className="size-3 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(420px,90vw)] p-2">
          <div className="relative">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une tâche ou un projet…"
              aria-label="Rechercher une tâche"
              className="mb-2 pl-9"
            />
          </div>
          <div className="max-h-80 overflow-auto">
            <button
              type="button"
              className="w-full rounded-md p-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                onChange("", projectId);
                setOpen(false);
              }}
            >
              Sans tâche · à classer
            </button>
            {!tasksByProject.size && <p className="p-3 text-sm text-muted-foreground">Aucune tâche disponible{projectId ? " dans ce projet" : ""}.</p>}
            {projects.map((p) => {
              const tasks = tasksByProject.get(p.id) ?? [];
              if (!tasks.length) return null;
              const flags = flagsFor(p.id);
              const collapsed = flags?.collapsed && !query;
              return (
                <section key={p.id} className="mt-2 border-t pt-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 p-2 text-left text-xs font-semibold"
                      onClick={() =>
                        void changeFlag(p.id, "collapsed", !flags.collapsed)
                      }
                    >
                      <ChevronDown
                        className={"size-3 " + (collapsed ? "-rotate-90" : "")}
                      />
                      <i
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: p.color }}
                      />
                      <span className="truncate">{p.name}</span>
                      <span className="text-muted-foreground">
                        {tasks.length}
                      </span>
                    </button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={
                        (flags?.pinned ? "Désépingler " : "Épingler ") + p.name
                      }
                      onClick={() =>
                        void changeFlag(p.id, "pinned", !flags.pinned)
                      }
                    >
                      <Pin
                        className={
                          flags?.pinned ? "fill-primary text-primary" : ""
                        }
                      />
                    </Button>
                  </div>
                  {!collapsed &&
                    tasks.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        className="flex w-full items-center justify-between rounded-md py-2 pl-8 pr-3 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          onChange(t.id, p.id);
                          setOpen(false);
                        }}
                      >
                        {t.name}
                        {t.id === taskId && <Check size={14} />}
                      </button>
                    ))}
                </section>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      </div>
    </div>
  );
}
