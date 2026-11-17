import { roleLabel, canViewTeam } from "@/lib/roles";
import { useEffect, useState } from "react";
import {
  Download,
  BarChart3,
  TrendingUp,
  PieChart as PieIcon,
  ChartBar,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/app-context";
import { api } from "@/lib/api";
import type { Report, Preferences } from "@/lib/types";
import { weekDays, duration, prettyDay } from "@/lib/time";
import { reportBreakdown, reportSeries } from "../../public/report-charts.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  Empty,
} from "@/components/shared";
export function ReportsPage({ onExport }: { onExport: () => void }) {
  const { state, preference } = useWorkspace();
  const week = weekDays();
  const [filters, setFilters] = useState({
    from: week[0],
    to: week[6],
    person: "",
    client: "",
    project: "",
    task: "",
    group: "project",
    search: "",
    unclassified: false,
  });
  const [chart, setChart] = useState<NonNullable<Preferences["reportChart"]>>(
    state.me.preferences.reportChart ?? "columns",
  );
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api<Report>("/api/reports", "POST", filters, undefined, controller.signal)
        .then((x) => {
          setReport(x);
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, state.revision, tick]);
  const update = (key: string, value: string | boolean) =>
    setFilters((f) => ({
      ...f,
      [key]: value,
      ...(key === "client"
        ? { project: "", task: "" }
        : key === "project"
          ? { task: "" }
          : {}),
    }));
  const series = report
    ? reportSeries(report.days).points.map(
        (p: { from: string; to: string; seconds: number }) => ({
          name: prettyDay(p.from, true),
          seconds: p.seconds,
        }),
      )
    : [];
  const breakdown = report
    ? (
        reportBreakdown(report.rows, filters.group) as {
          id: string;
          label: string;
          seconds: number;
          projectId: string;
        }[]
      ).map((p, i) => ({
        ...p,
        name: p.label,
        color:
          state.projects.find(
            (x) => x.id === (filters.group === "project" ? p.id : p.projectId),
          )?.color ?? ["#b56f7b", "#789a92", "#8e82b0", "#c4a06c"][i % 4],
      }))
    : [];
  const choose = (v: typeof chart) => {
    setChart(v);
    void preference({ reportChart: v }).catch((e) => toast.error(e.message));
  };
  const tooltip = (value: unknown) => duration(Number(value));
  return (
    <>
      <PageHeading
        title="Le recul pour mieux avancer."
        description="Comprenez où va votre temps, par projet et par personne."
      >
        <Button variant="outline" onClick={onExport}>
          <Download />
          Exporter les temps
        </Button>
      </PageHeading>
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Du">
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => update("from", e.target.value)}
            />
          </Field>
          <Field label="Au">
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => update("to", e.target.value)}
            />
          </Field>
          <Field label="Client">
            <Choice
              label="Client du rapport"
              value={filters.client}
              onChange={(v) => update("client", v)}
              options={[
                { value: "", label: "Tous les clients" },
                ...state.clients.map((x) => ({ value: x.id, label: x.name })),
              ]}
            />
          </Field>
          <Field label="Projet">
            <Choice
              label="Projet du rapport"
              value={filters.project}
              onChange={(v) => update("project", v)}
              options={[
                { value: "", label: "Tous les projets" },
                ...state.projects
                  .filter(
                    (p) => !filters.client || p.client_id === filters.client,
                  )
                  .map((x) => ({ value: x.id, label: x.name, color: x.color })),
              ]}
            />
          </Field>
          <Field label="Tâche">
            <Choice
              label="Tâche du rapport"
              value={filters.task}
              onChange={(v) => update("task", v)}
              options={[
                { value: "", label: "Toutes les tâches" },
                ...state.tasks
                  .filter(
                    (t) =>
                      (!filters.project || t.project_id === filters.project) &&
                      (!filters.client ||
                        state.projects.some(
                          (p) =>
                            p.id === t.project_id &&
                            p.client_id === filters.client,
                        )),
                  )
                  .map((x) => ({ value: x.id, label: x.name })),
              ]}
            />
          </Field>
          {canViewTeam(state.me.role) && (
            <Field label="Collaborateur">
              <Choice
                label="Collaborateur du rapport"
                value={filters.person}
                onChange={(v) => update("person", v)}
                options={[
                  { value: "", label: "Toute l’équipe" },
                  ...state.users.map((x) => ({ value: x.id, label: x.name })),
                ]}
              />
            </Field>
          )}
          <Field label="Regrouper par">
            <NativeSelect
              label="Regroupement du rapport"
              value={filters.group}
              onChange={(v) => update("group", v)}
              options={[
                ["project", "Projet"],
                ["task", "Tâche"],
                ["client", "Client"],
                ["person", "Collaborateur"],
              ]}
            />
          </Field>
          <Field label="Description">
            <Input
              placeholder="Rechercher dans les descriptions…"
              value={filters.search}
              onChange={(e) => update("search", e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.unclassified}
            onChange={(e) => update("unclassified", e.target.checked)}
          />
          Uniquement les temps à classer
        </label>
      </Card>
      <ErrorMessage message={error} />
      <div className="summary-grid">
        <div>
          <span>Temps total</span>
          <strong>{duration(report?.total ?? 0)}</strong>
        </div>
        <div>
          <span>Temps finalisé</span>
          <strong>{duration(report?.completed ?? 0)}</strong>
        </div>
        <div>
          <span>Chronos en cours</span>
          <strong>{duration(report?.running ?? 0)}</strong>
        </div>
        <div>
          <span>À classer</span>
          <strong>{duration(report?.unclassified ?? 0)}</strong>
        </div>
      </div>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Répartition du temps</h2>
            <p className="text-xs text-muted-foreground">
              {loading
                ? "Actualisation…"
                : "Calculé en Europe/Zurich · actualisé toutes les 15 secondes"}
            </p>
          </div>
          <div className="segmented">
            {(
              [
                ["columns", "Bâtons", BarChart3],
                ["line", "Courbe", TrendingUp],
                ["pie", "Camembert", PieIcon],
                ["bars", "Barres", ChartBar],
              ] as const
            ).map(([v, label, Icon]) => (
              <Button
                key={v}
                variant={chart === v ? "secondary" : "ghost"}
                size="sm"
                aria-label={label}
                onClick={() => choose(v)}
              >
                <Icon />
                <span className="hidden sm:inline">{label}</span>
              </Button>
            ))}
          </div>
        </div>
        {!report?.rows.length ? (
          <Empty
            title="Aucun temps sur cette période"
            description="Adaptez les dates ou les filtres pour consulter vos activités."
          />
        ) : (
          <>
            <div
              className="h-72 w-full min-w-0"
              aria-label="Graphique du temps"
            >
              <ResponsiveContainer width="100%" height="100%">
                {chart === "columns" ? (
                  <BarChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={11} />
                    <YAxis
                      tickFormatter={(v) => Math.round(v / 3600) + "h"}
                      fontSize={11}
                    />
                    <Tooltip formatter={tooltip} />
                    <Bar
                      isAnimationActive={false}
                      dataKey="seconds"
                      name="Durée"
                      fill="#b56f7b"
                      radius={[5, 5, 0, 0]}
                    />
                  </BarChart>
                ) : chart === "line" ? (
                  <LineChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={11} />
                    <YAxis
                      tickFormatter={(v) => Math.round(v / 3600) + "h"}
                      fontSize={11}
                    />
                    <Tooltip formatter={tooltip} />
                    <Line
                      isAnimationActive={false}
                      type="monotone"
                      dataKey="seconds"
                      name="Durée"
                      stroke="#b56f7b"
                      strokeWidth={3}
                    />
                  </LineChart>
                ) : chart === "pie" ? (
                  <PieChart>
                    <Pie
                      isAnimationActive={false}
                      data={breakdown}
                      dataKey="seconds"
                      nameKey="name"
                      innerRadius={65}
                      outerRadius={105}
                      paddingAngle={2}
                    >
                      {breakdown.map((x) => (
                        <Cell key={x.id ?? x.name} fill={x.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={tooltip} />
                  </PieChart>
                ) : (
                  <BarChart data={breakdown} layout="vertical">
                    <XAxis
                      type="number"
                      tickFormatter={(v) => Math.round(v / 3600) + "h"}
                      fontSize={11}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      fontSize={11}
                    />
                    <Tooltip formatter={tooltip} />
                    <Bar
                      isAnimationActive={false}
                      dataKey="seconds"
                      name="Durée"
                      radius={[0, 5, 5, 0]}
                    >
                      {breakdown.map((x) => (
                        <Cell key={x.id ?? x.name} fill={x.color} />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {breakdown.map((x) => (
                <div
                  key={x.id ?? x.name}
                  className="flex items-center gap-2 text-xs"
                >
                  <i
                    className="size-2 rounded-full"
                    style={{ background: x.color }}
                  />
                  {x.name}
                  <b>{duration(x.seconds)}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
      {report && (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Regroupement</TableHead>
                <TableHead>Collaborateur</TableHead>
                <TableHead>Entrées</TableHead>
                <TableHead className="text-right pr-5">Durée</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.groups.map((g) => (
                <TableRow key={g.key}>
                  <TableCell className="pl-5">{g.label}</TableCell>
                  <TableCell>{g.person}</TableCell>
                  <TableCell>{g.count}</TableCell>
                  <TableCell className="text-right pr-5 font-mono">
                    {duration(g.seconds)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
