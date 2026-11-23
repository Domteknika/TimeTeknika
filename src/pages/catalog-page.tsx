import { roleLabel, canViewTeam } from "@/lib/roles";
import { useState, useMemo } from "react";
import {
  Plus,
  Search,
  Pencil,
  Archive,
  Trash2,
  FolderOpen,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace, useNow } from "@/lib/app-context";
import { normalize, elapsed, duration } from "@/lib/time";
import type { Client, Project, Task, Entry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  PageHeading,
  Empty,
  Choice,
  NativeSelect,
  Modal,
} from "@/components/shared";
import {
  CatalogEditor,
  DeleteCatalog,
  EntryEditor,
  EntryHistory,
  type CatalogKind,
} from "@/components/editors";
import { EntryList } from "./time-page";
const labels = {
  tasks: [
    "Vos tâches, en mouvement.",
    "Retrouvez les tâches de l’équipe et les temps qui leur sont consacrés.",
    "Nouvelle tâche",
  ],
  projects: [
    "Une vue claire sur vos projets.",
    "Les projets, leurs équipes et le temps qui leur est consacré.",
    "Nouveau projet",
  ],
  clients: [
    "Vos relations, au même endroit.",
    "Les clients qui donnent du sens à vos projets.",
    "Nouveau client",
  ],
};
export function CatalogPage({ kind }: { kind: CatalogKind }) {
  const { state, mutate } = useWorkspace();
  const now = useNow();
  const [query, setQuery] = useState(""),
    [client, setClient] = useState(""),
    [project, setProject] = useState(""),
    [archiveFilter, setArchiveFilter] = useState("active"),
    [sort, setSort] = useState("name"),
    [time, setTime] = useState("all"),
    [scope, setScope] = useState(state.me.preferences.taskScope ?? "mine");
  const [edit, setEdit] = useState<{ item?: Client | Project | Task } | null>(
      null,
    ),
    [remove, setRemove] = useState<Client | null>(null),
    [detail, setDetail] = useState<Client | null>(null),
    [entry, setEntry] = useState<Entry | null>(null),
    [history, setHistory] = useState<Entry | null>(null);
  const groupedEntries = useMemo(() => {
    const projectClients = new Map(state.projects.map(p => [p.id, p.client_id]));
    const groups = new Map<string, Entry[]>();
    for (const e of state.entries) {
      const id = kind === "tasks" ? e.task_id : kind === "projects" ? e.project_id : projectClients.get(e.project_id ?? "");
      if (!id) continue;
      const entries = groups.get(id) ?? [];
      entries.push(e); groups.set(id, entries);
    }
    return groups;
  }, [state.entries, state.projects, kind]);
  const totals = useMemo(() => new Map([...groupedEntries].map(([id, entries]) =>
    [id, entries.reduce((sum, e) => sum + elapsed(e, now), 0)])), [groupedEntries, now]);
  const itemEntries = (item: Client) => groupedEntries.get(item.id) ?? [];
  const total = (item: Client) => totals.get(item.id) ?? 0;
  const clientsById = new Map(state.clients.map((item) => [item.id, item]));
  const groupByClient = kind === "projects" && sort === "client-asc";
  const showOwnerColumn = kind !== "clients" && !groupByClient;
  const rows = (state[kind] as (Client | Project | Task)[])
    .filter((item) => {
      const p =
        kind === "projects"
          ? (item as Project)
          : kind === "tasks"
            ? state.projects.find((p) => p.id === (item as Task).project_id)
            : null;
      const c = p ? clientsById.get(p.client_id) : undefined;
      if (
        !normalize(
          item.name + " " + (p?.name ?? "") + " " + (c?.name ?? ""),
        ).includes(normalize(query))
      )
        return false;
      if (kind !== "clients" && client && p?.client_id !== client) return false;
      if (kind === "tasks" && project && (item as Task).project_id !== project)
        return false;
      if (
        kind === "tasks" &&
        scope === "mine" &&
        !(item as Task).assignees.includes(state.me.id)
      )
        return false;
      if (kind !== "clients") {
        const archived = !!(item as Project).archived;
        if (
          (archiveFilter === "active" && archived) ||
          (archiveFilter === "archived" && !archived)
        )
          return false;
      }
      const seconds = total(item);
      return time === "all" || (time === "with" ? seconds > 0 : seconds === 0);
    })
    .sort((a, b) =>
      sort === "time-desc"
        ? total(b) - total(a)
        : sort === "time-asc"
          ? total(a) - total(b)
          : sort === "name-desc"
            ? b.name.localeCompare(a.name, "fr")
            : a.name.localeCompare(b.name, "fr"),
    );
  const rowsByClient = new Map<Client | undefined, typeof rows>();
  if (groupByClient) {
    for (const item of rows) {
      const owner = clientsById.get((item as Project).client_id);
      const group = rowsByClient.get(owner);
      if (group) group.push(item);
      else rowsByClient.set(owner, [item]);
    }
  } else {
    rowsByClient.set(undefined, rows);
  }
  const sections = [...rowsByClient].sort(([a], [b]) => {
    if (!a || !b) return Number(!a) - Number(!b);
    return a.name.localeCompare(b.name, "fr") || a.id.localeCompare(b.id);
  });
  const projectTasks = kind === "projects" && detail
    ? state.tasks.filter((task) => task.project_id === detail.id)
        .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    : [];
  const [title, description, create] = labels[kind];
  return (
    <>
      <PageHeading title={title} description={description}>
        <Button onClick={() => setEdit({})}>
          <Plus />
          {create}
        </Button>
      </PageHeading>
      <div className="catalog-stats">
        <span>
          <b>{state[kind].length}</b>{" "}
          {kind === "tasks"
            ? "tâches"
            : kind === "projects"
              ? "projets"
              : "clients"}{" "}
          dans votre espace
        </span>
        <span>
          <b>{rows.length}</b> affiché(s)
        </span>
        <span>Temps visibles selon vos droits</span>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="filter-bar">
          <div className="relative min-w-44 flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Rechercher dans le catalogue"
              placeholder="Rechercher…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {kind !== "clients" && (
            <Choice
              label="Filtrer par client"
              value={client}
              onChange={(v) => {
                setClient(v);
                setProject("");
              }}
              options={[
                { value: "", label: "Tous les clients" },
                ...state.clients.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          )}
          {kind === "tasks" && (
            <>
              <Choice
                label="Filtrer par projet"
                value={project}
                onChange={setProject}
                options={[
                  { value: "", label: "Tous les projets" },
                  ...state.projects
                    .filter((p) => !client || p.client_id === client)
                    .map((p) => ({
                      value: p.id,
                      label: p.name,
                      color: p.color,
                    })),
                ]}
              />
              <NativeSelect
                label="Affectation"
                value={scope}
                onChange={(v) => setScope(v as "mine" | "all")}
                options={[
                  ["mine", "Mes tâches"],
                  ["all", "Toute l’équipe"],
                ]}
              />
            </>
          )}
          {kind !== "clients" && (
            <NativeSelect
              label="Afficher les éléments actifs ou archivés"
              value={archiveFilter}
              onChange={setArchiveFilter}
              options={[
                ["active", "Actifs"],
                ["archived", "Archivés"],
                ["all", "Tous"],
              ]}
            />
          )}
          <NativeSelect
            label="Présence de temps"
            value={time}
            onChange={setTime}
            options={[
              ["all", "Tous les temps"],
              ["with", "Avec temps"],
              ["without", "Sans temps"],
            ]}
          />
          <NativeSelect
            label="Trier"
            value={sort}
            onChange={setSort}
            options={[
              ["name", "Nom A–Z"],
              ["name-desc", "Nom Z–A"],
              ...(kind === "projects"
                ? [["client-asc", "Par client (A–Z)"] as [string, string]]
                : []),
              ["time-desc", "Temps décroissant"],
              ["time-asc", "Temps croissant"],
            ]}
          />
        </div>
        {!rows.length ? (
          <Empty
            title="Aucun résultat"
            description="Essayez une autre recherche ou créez un nouvel élément."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Nom</TableHead>
                {showOwnerColumn && (
                  <TableHead>
                    {kind === "tasks" ? "Projet" : "Client"}
                  </TableHead>
                )}
                <TableHead>
                  {kind === "tasks" ? "Équipe" : "Projets / tâches"}
                </TableHead>
                <TableHead>Temps</TableHead>
                <TableHead className="text-right pr-5">Actions</TableHead>
              </TableRow>
            </TableHeader>
            {sections.map(([owner, items]) => <TableBody key={owner?.id ?? ""}>
              {groupByClient && (
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <th scope="rowgroup" colSpan={4} className="h-9 border-t px-5 text-left text-sm font-semibold">
                    {owner?.name ?? "Sans client"}
                  </th>
                </TableRow>
              )}
              {items.map((item) => {
                const p =
                    kind === "projects"
                      ? (item as Project)
                      : state.projects.find(
                          (p) => p.id === (item as Task).project_id,
                        ),
                  task = kind === "tasks" ? (item as Task) : null;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="pl-5">
                      <button
                        className="flex items-center gap-3 text-left"
                        onClick={() => setDetail(item)}
                      >
                        <span
                          className="catalog-icon"
                          style={{
                            background: (p?.color ?? "#b27b81") + "20",
                            color: p?.color ?? "#b27b81",
                          }}
                        >
                          <FolderOpen size={18} />
                        </span>
                        <span>
                          <b className="block font-medium">{item.name}</b>
                          {!!(item as Project).archived && (
                            <Badge variant="secondary">Archivé</Badge>
                          )}
                        </span>
                      </button>
                    </TableCell>
                    {showOwnerColumn && (
                      <TableCell className="text-muted-foreground">
                        {kind === "tasks"
                          ? p?.name
                          : clientsById.get(p?.client_id ?? "")?.name}
                      </TableCell>
                    )}
                    <TableCell>
                      {task ? (
                        <div className="flex -space-x-1">
                          {task.assignees.map((id) => {
                            const u = state.users.find((u) => u.id === id);
                            return (
                              <span
                                key={id}
                                title={u?.name}
                                className="mini-avatar"
                                style={{ background: u?.color }}
                              >
                                {u?.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .slice(0, 2)
                                  .join("")}
                              </span>
                            );
                          })}
                        </div>
                      ) : kind === "projects" ? (
                        state.tasks.filter((t) => t.project_id === item.id)
                          .length + " tâches"
                      ) : (
                        state.projects.filter((p) => p.client_id === item.id)
                          .length + " projets"
                      )}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {duration(total(item))}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {kind !== "clients" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={"Modifier " + item.name}
                              onClick={() => setEdit({ item })}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={
                                ((item as Project).archived
                                  ? "Réactiver "
                                  : "Archiver ") + item.name
                              }
                              onClick={() =>
                                void mutate(
                                  "/api/" + kind + "/" + item.id,
                                  "PATCH",
                                  {
                                    version: item.version,
                                    archived: !(item as Project).archived,
                                  },
                                ).catch((e) => toast.error(e.message))
                              }
                            >
                              <Archive />
                            </Button>
                          </>
                        )}
                        {canViewTeam(state.me.role) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={"Supprimer " + item.name}
                            onClick={() => setRemove(item)}
                          >
                            <Trash2 />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={"Détails de " + item.name}
                          onClick={() => setDetail(item)}
                        >
                          <ChevronRight />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>)}
          </Table>
        )}
      </Card>
      {edit && (
        <CatalogEditor
          kind={kind}
          item={edit.item}
          onClose={() => setEdit(null)}
        />
      )}{" "}
      {remove && (
        <DeleteCatalog
          kind={kind}
          item={remove}
          onClose={() => setRemove(null)}
        />
      )}
      {detail && (
        <Modal
          title={detail.name}
          description={kind === "projects"
            ? "Tâches rattachées à ce projet."
            : "Temps enregistrés visibles selon vos droits d’accès."}
          onClose={() => setDetail(null)}
          wide={kind !== "projects"}
        >
          {kind === "projects" ? (
            projectTasks.length ? (
              <ul className="divide-y">
                {projectTasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
                    <span className="min-w-0 break-words font-medium">{task.name}</span>
                    {!!task.archived && <Badge variant="secondary">Archivée</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Aucune tâche dans ce projet.</p>
            )
          ) : (
            <>
              <p className="text-3xl font-semibold tabular-nums">
                {duration(total(detail))}
              </p>
              <EntryList
                entries={itemEntries(detail)}
                onEdit={setEntry}
                onHistory={setHistory}
              />
            </>
          )}
        </Modal>
      )}
      {entry && <EntryEditor entry={entry} onClose={() => setEntry(null)} />}{" "}
      {history && (
        <EntryHistory entry={history} onClose={() => setHistory(null)} />
      )}
    </>
  );
}
