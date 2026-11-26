import { roleLabel, canViewTeam } from "@/lib/roles";
import { useEffect, useState } from "react";
import {
  Download,
  Save,
  ArrowUp,
  ArrowDown,
  X,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/app-context";
import { api, downloadExport } from "@/lib/api";
import type { ExportConfig } from "@/lib/types";
import { weekDays, duration } from "@/lib/time";
import {
  defaultExportConfig,
  EXPORT_COLUMNS,
  EXPORT_GROUPS,
  EXPORT_PERIODS,
  displayExportCell,
} from "../../public/export-config.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  Field,
  Choice,
  NativeSelect,
  ErrorMessage,
  Modal,
  AsyncForm,
} from "@/components/shared";
type Preview = {
  rows: Record<string, unknown>[];
  source: {
    id: string;
    person: string;
    day: string;
    description: string;
    seconds: number;
    excluded: boolean;
  }[];
  totalSeconds: number;
  entryCount: number;
  rowCount: number;
  runningCount: number;
  period: { from: string; to: string };
};
export function ExportsPage({ initialConfig }: { initialConfig?: ExportConfig }) {
  const { state, mutate } = useWorkspace(),
    days = weekDays();
  const [config, setConfig] = useState<ExportConfig>(
    () => initialConfig ?? defaultExportConfig(days[0], days[6]) as ExportConfig,
  );
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0),
    [busy, setBusy] = useState(false),
    [previewBusy, setPreviewBusy] = useState(true);
  const [template, setTemplate] = useState<{
      id: string;
      version: number;
      name: string;
    } | null>(null),
    [save, setSave] = useState(false);
  useEffect(() => {
    if (!preview?.runningCount) return;
    const timer = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(timer);
  }, [!!preview?.runningCount]);
  useEffect(() => {
    const c = new AbortController();
    setPreviewBusy(true);
    const timer = setTimeout(() => {
      api<Preview>(
        "/api/exports/preview",
        "POST",
        { config },
        undefined,
        c.signal,
      )
        .then((x) => {
          setPreview(x);
          setError("");
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setPreviewBusy(false);
        });
    }, 250);
    return () => {
      c.abort();
      clearTimeout(timer);
    };
  }, [config, state.reportRevision, tick]);
  const update = (patch: Partial<ExportConfig>) =>
    setConfig((c) => ({ ...c, ...patch }));
  function mode(value: "detail" | "summary", groups = config.groups) {
    const columns = config.columns.filter(
      (c) =>
        value === "detail" ||
        EXPORT_COLUMNS.find((x) => x.key === c.key)?.metric ||
        groups.includes(c.key),
    );
    update({
      mode: value,
      groups,
      columns: columns.length ? columns : [{ key: "duration", label: "Durée" }],
    });
  }
  async function download(format: string) {
    setBusy(true);
    try {
      await downloadExport(config, format);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const available = EXPORT_COLUMNS.filter(
    (c) =>
      config.mode === "detail" || c.metric || config.groups.includes(c.key),
  );
  const move = <T,>(list: T[], index: number, delta: number) => {
    const next = [...list];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    return next;
  };
  const check = (label: string, key: "total" | "subtotals") => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={config[key]}
        onCheckedChange={(v) => update({ [key]: !!v })}
      />
      {label}
    </label>
  );
  return (
    <>
      <PageHeading
        title="Des relevés prêts à partager."
        description="Composez vos exports Excel, PDF et CSV à partir des temps autorisés."
      >
        <Button variant="outline" onClick={() => setSave(true)}>
          <Save />
          Enregistrer un modèle
        </Button>
        {(["csv", "xlsx", "pdf"] as const).map((format) => (
          <Button
            key={format}
            disabled={busy || previewBusy || !!error}
            variant={format === "pdf" ? "default" : "outline"}
            onClick={() => void download(format)}
          >
            <Download />
            {format === "xlsx" ? "Excel" : format.toUpperCase()}
          </Button>
        ))}
      </PageHeading>
      <div className="export-layout">
        <div className="grid content-start gap-5">
          <Card className="p-5">
            <h2 className="font-semibold">Présentation et période</h2>
            <Choice
              label="Modèle d’export"
              value={template?.id ?? ""}
              onChange={(id) => {
                const t = state.exportTemplates.find((t) => t.id === id);
                if (t) {
                  setTemplate({ id: t.id, version: t.version, name: t.name });
                  const copy = structuredClone(t.config);
                  copy.excluded = [];
                  copy.document.reference = "";
                  setConfig(copy);
                } else {
                  setTemplate(null);
                  setConfig(
                    defaultExportConfig(days[0], days[6]) as ExportConfig,
                  );
                }
              }}
              options={[
                { value: "", label: "Nouveau relevé" },
                ...state.exportTemplates.map((t) => ({
                  value: t.id,
                  label: t.name,
                })),
              ]}
            />
            {template && (
              <Button
                variant="ghost"
                className="justify-start text-destructive"
                onClick={() =>
                  void mutate(
                    "/api/export-templates/" + template.id,
                    "DELETE",
                    { version: template.version },
                  )
                    .then(() => setTemplate(null))
                    .catch((e) => toast.error(e.message))
                }
              >
                <Trash2 />
                Supprimer ce modèle
              </Button>
            )}
            <NativeSelect
              label="Présentation de l’export"
              value={config.mode}
              onChange={(v) => mode(v as "detail" | "summary")}
              options={[
                ["detail", "Détail des temps"],
                ["summary", "Synthèse regroupée"],
              ]}
            />
            <NativeSelect
              label="Période de l’export"
              value={config.period.preset}
              onChange={(v) =>
                update({ period: { ...config.period, preset: v } })
              }
              options={EXPORT_PERIODS as [string, string][]}
            />
            {config.period.preset === "custom" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Du">
                  <Input
                    type="date"
                    value={config.period.from}
                    onChange={(e) =>
                      update({
                        period: { ...config.period, from: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Au">
                  <Input
                    type="date"
                    value={config.period.to}
                    onChange={(e) =>
                      update({
                        period: { ...config.period, to: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>
            )}
            <Field label="Recherche">
              <Input
                placeholder="Description contient…"
                value={config.filters.query}
                onChange={(e) =>
                  update({
                    filters: { ...config.filters, query: e.target.value },
                  })
                }
              />
            </Field>
            <NativeSelect
              label="Classement des temps"
              value={config.filters.classification}
              onChange={(v) =>
                update({ filters: { ...config.filters, classification: v } })
              }
              options={[
                ["all", "Tous les classements"],
                ["classified", "Temps classés"],
                ["unclassified", "À classer"],
              ]}
            />
            <NativeSelect
              label="État des chronos"
              value={config.filters.timers}
              onChange={(v) =>
                update({ filters: { ...config.filters, timers: v } })
              }
              options={[
                ["stopped", "Chronos arrêtés"],
                ["running", "Chronos en cours"],
                ["all", "Tous les chronos"],
              ]}
            />
            {(["people", "clients", "projects", "tasks"] as const).map(
              (key) => (
                <MultiFilter
                  key={key}
                  label={
                    {
                      people: "Collaborateurs",
                      clients: "Clients",
                      projects: "Projets",
                      tasks: "Tâches",
                    }[key]
                  }
                  value={config.filters[key]}
                  onChange={(v) =>
                    update({ filters: { ...config.filters, [key]: v } })
                  }
                  options={(key === "people"
                    ? state.users.filter(
                        (u) =>
                          canViewTeam(state.me.role) || u.id === state.me.id,
                      )
                    : state[key]
                  )
                    .map((x) => ({ id: x.id, name: x.name }))
                    .concat(
                      key === "people"
                        ? []
                        : [
                            {
                              id: "__none__",
                              name:
                                key === "tasks"
                                  ? "Sans tâche"
                                  : key === "projects"
                                    ? "Sans projet"
                                    : "Sans client",
                            },
                          ],
                    )}
                />
              ),
            )}
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold">Document</h2>
            {(["title", "company", "reference", "note"] as const).map((key) => (
              <Field
                key={key}
                label={
                  {
                    title: "Titre",
                    company: "Émetteur",
                    reference: "Référence",
                    note: "Note",
                  }[key]
                }
              >
                {key === "note" ? (
                  <Textarea
                    value={config.document[key]}
                    onChange={(e) =>
                      update({
                        document: { ...config.document, [key]: e.target.value },
                      })
                    }
                  />
                ) : (
                  <Input
                    value={config.document[key]}
                    onChange={(e) =>
                      update({
                        document: { ...config.document, [key]: e.target.value },
                      })
                    }
                  />
                )}
              </Field>
            ))}
            <NativeSelect
              label="Orientation du PDF"
              value={config.document.orientation}
              onChange={(v) =>
                update({ document: { ...config.document, orientation: v } })
              }
              options={[
                ["auto", "Orientation automatique"],
                ["portrait", "Portrait"],
                ["landscape", "Paysage"],
              ]}
            />
          </Card>
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <Card className="p-5">
            <h2 className="font-semibold">Colonnes et regroupements</h2>
            {config.mode === "summary" && (
              <div className="grid gap-2">
                <p className="text-xs text-muted-foreground">
                  Ordre des regroupements
                </p>
                {config.groups.map((g, i) => (
                  <div
                    key={g}
                    className="flex items-center gap-2 rounded-md border px-3 py-1 text-sm"
                  >
                    <span className="flex-1">
                      {EXPORT_COLUMNS.find((c) => c.key === g)?.label}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={!i}
                      aria-label={"Monter le groupe " + g}
                      onClick={() =>
                        mode("summary", move(config.groups, i, -1))
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={i === config.groups.length - 1}
                      aria-label={"Descendre le groupe " + g}
                      onClick={() => mode("summary", move(config.groups, i, 1))}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={config.groups.length === 1}
                      aria-label={"Retirer le groupe " + g}
                      onClick={() =>
                        mode(
                          "summary",
                          config.groups.filter((x) => x !== g),
                        )
                      }
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {EXPORT_GROUPS.filter((g) => !config.groups.includes(g)).map(
                    (g) => (
                      <Button
                        key={g}
                        size="sm"
                        variant="outline"
                        onClick={() => mode("summary", [...config.groups, g])}
                      >
                        <Plus />
                        {EXPORT_COLUMNS.find((c) => c.key === g)?.label}
                      </Button>
                    ),
                  )}
                </div>
              </div>
            )}
            <div className="grid gap-2">
              {config.columns.map((c, i) => (
                <div key={c.key} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">
                    {EXPORT_COLUMNS.find((x) => x.key === c.key)?.label}
                  </span>
                  <Input
                    aria-label={"Titre de la colonne " + c.key}
                    value={c.label}
                    maxLength={80}
                    onChange={(e) =>
                      update({
                        columns: config.columns.map((x) =>
                          x.key === c.key ? { ...x, label: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!i}
                    aria-label={"Monter " + c.key}
                    onClick={() =>
                      update({ columns: move(config.columns, i, -1) })
                    }
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={i === config.columns.length - 1}
                    aria-label={"Descendre " + c.key}
                    onClick={() =>
                      update({ columns: move(config.columns, i, 1) })
                    }
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={config.columns.length === 1}
                    aria-label={"Retirer " + c.key}
                    onClick={() =>
                      update({
                        columns: config.columns.filter((x) => x.key !== c.key),
                      })
                    }
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {available
                .filter((c) => !config.columns.some((x) => x.key === c.key))
                .map((c) => (
                  <Button
                    key={c.key}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      update({
                        columns: [
                          ...config.columns,
                          { key: c.key, label: c.label },
                        ],
                      })
                    }
                  >
                    <Plus />
                    {c.label}
                  </Button>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {check("Total général", "total")}
              {config.mode === "summary" && check("Sous-totaux", "subtotals")}
              <NativeSelect
                label="Tri de l’export"
                value={config.sort.key}
                onChange={(v) => update({ sort: { ...config.sort, key: v } })}
                options={EXPORT_COLUMNS.map((c) => [c.key, c.label])}
              />
              <NativeSelect
                label="Sens du tri"
                value={config.sort.direction}
                onChange={(v) =>
                  update({ sort: { ...config.sort, direction: v } })
                }
                options={[
                  ["asc", "Croissant"],
                  ["desc", "Décroissant"],
                ]}
              />
            </div>
          </Card>
          <Card className="gap-0 overflow-hidden py-0">
            <div className="flex items-center justify-between gap-2 border-b p-5">
              <h2 className="font-semibold">Aperçu du relevé</h2>
              <span className="text-xs text-muted-foreground">
                {previewBusy
                  ? "Actualisation…"
                  : (preview?.entryCount ?? 0) +
                    " temps · " +
                    duration(preview?.totalSeconds ?? 0)}
              </span>
            </div>
            <ErrorMessage message={error} />
            {preview && !error && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {config.columns.map((c) => (
                        <TableHead key={c.key}>{c.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row, i) => (
                      <TableRow
                        key={i}
                        className={
                          row.type === "total" || row.type === "subtotal"
                            ? "bg-muted font-semibold"
                            : ""
                        }
                      >
                        {config.columns.map((c, j) => (
                          <TableCell key={c.key}>
                            {j === 0 && row.caption
                              ? String(row.caption)
                              : displayExportCell(c.key, row[c.key])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="border-t p-4 text-xs text-muted-foreground">
                  {preview.rowCount} lignes au total. Aperçu limité à 200 lignes
                  ; le téléchargement contient toutes les lignes.
                  {preview.runningCount > 0
                    ? " Les chronos en cours sont figés à l’heure de génération."
                    : ""}
                </p>
              </>
            )}
          </Card>
          {preview && (
            <Card className="p-5">
              <details>
                <summary className="cursor-pointer font-medium">
                  Exclure certains temps ({config.excluded.length})
                </summary>
                <div className="mt-4 max-h-72 space-y-2 overflow-auto">
                  {preview.source.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-start gap-3 border-b py-2 text-sm"
                    >
                      <Checkbox
                        checked={!config.excluded.includes(e.id)}
                        onCheckedChange={(v) =>
                          update({
                            excluded: v
                              ? config.excluded.filter((id) => id !== e.id)
                              : [...config.excluded, e.id],
                          })
                        }
                      />
                      <span className="flex-1">
                        {e.description || "Sans description"}
                        <small className="block text-muted-foreground">
                          {e.person} · {e.day}
                        </small>
                      </span>
                      <span>{duration(e.seconds)}</span>
                    </label>
                  ))}
                </div>
              </details>
            </Card>
          )}
        </div>
      </div>
      {save && (
        <Modal
          title="Enregistrer un modèle"
          description="Les exclusions ponctuelles et la référence ne sont pas conservées dans le modèle."
          onClose={() => setSave(false)}
        >
          <AsyncForm
            onCancel={() => setSave(false)}
            onSubmit={async (f) => {
              const overwrite = !!template && f.get("overwrite") === "on";
              const result = await mutate<{
                template: { id: string; version: number; name: string };
              }>(
                "/api/export-templates" + (overwrite ? "/" + template!.id : ""),
                overwrite ? "PATCH" : "POST",
                {
                  name: f.get("name"),
                  config,
                  version: overwrite ? template!.version : undefined,
                },
              );
              setTemplate(result.template);
              setSave(false);
            }}
          >
            <Field label="Nom du modèle">
              <Input
                name="name"
                defaultValue={template?.name ?? ""}
                required
                maxLength={100}
              />
            </Field>
            {template && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="overwrite" />
                Mettre à jour le modèle sélectionné
              </label>
            )}
          </AsyncForm>
        </Modal>
      )}
    </>
  );
}
function MultiFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string[] | null;
  onChange: (v: string[] | null) => void;
  options: { id: string; name: string }[];
}) {
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm">
        {label}{" "}
        <span className="text-muted-foreground">
          · {value === null ? "Tous" : value.length + " sélectionné(s)"}
        </span>
      </summary>
      <div className="mt-3 grid max-h-48 gap-2 overflow-auto">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value === null}
            onCheckedChange={(v) => onChange(v ? null : [])}
          />
          Tout sélectionner
        </label>
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value === null || value.includes(o.id)}
              onCheckedChange={(v) => {
                const selected = value ?? options.map((o) => o.id);
                onChange(
                  v
                    ? [...selected, o.id]
                    : selected.filter((id) => id !== o.id),
                );
              }}
            />
            {o.name}
          </label>
        ))}
      </div>
    </details>
  );
}
