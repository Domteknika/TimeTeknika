import { roleLabel, canViewTeam } from "@/lib/roles";
import { useEffect, useState } from "react";
import {
  UserPlus,
  Pencil,
  Trash2,
  KeyRound,
  ShieldCheck,
  Download,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/app-context";
import { api, saveBlob } from "@/lib/api";
import { dayKey, clockTime, prettyDay, weekDays } from "@/lib/time";
import type { Person } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HolidaySettings, WorkScheduleSettings } from "@/components/work-time";
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
  AsyncForm,
  Field,
  Modal,
  NativeSelect,
  ErrorMessage,
} from "@/components/shared";
type Journal = {
  items: {
    seq: number;
    at: number;
    actor: string | null;
    request_id: string | null;
    level: string;
    category: string;
    action: string;
    details: unknown;
  }[];
  nextBefore: number | null;
  checkpoint: { count: number; hash: string };
};
export function SettingsPage() {
  const { state, preference, mutate } = useWorkspace();
  const [userForm, setUserForm] = useState(false),
    [reset, setReset] = useState<Person | null>(null),
    [access, setAccess] = useState<{ person: Person; mode: "username" | "remove" } | null>(null),
    [showRemoved, setShowRemoved] = useState(false),
    [rolePerson, setRolePerson] = useState<Person | null>(null),
    [journal, setJournal] = useState(false);
  const pref = state.me.preferences;
  const hasWorkSchedule = Boolean(state.workTime?.schedules.length);
  return (
    <>
      <PageHeading
        title="Un espace qui vous ressemble."
        description="Vos préférences, votre compte et les réglages de l’équipe."
      />
      <div className="settings-grid">
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Mon temps de travail</h2>
          <AsyncForm
            onSubmit={async (f) => {
              const target = f.get("weekly");
              await preference({
                ...(target === null ? {} : { weeklyTargetMinutes: target === "" ? null : Math.round(Number(target) * 60) }),
                balanceStartDate: String(f.get("balance")),
                reminderHour: Number(f.get("reminder")),
              });
              toast.success("Préférences enregistrées.");
            }}
          >
            {!hasWorkSchedule && <Field
              label="Objectif hebdomadaire (heures)"
              hint="Objectif utilisé avant le premier horaire enregistré. Laisser vide pour désactiver."
            >
              <Input
                name="weekly"
                type="number"
                inputMode="decimal"
                min="0"
                max="168"
                step="any"
                defaultValue={
                  pref.weeklyTargetMinutes == null
                    ? ""
                    : pref.weeklyTargetMinutes / 60
                }
              />
            </Field>}
            <Field
              label="Premier lundi du suivi"
              hint="Le solde inclut l’objectif complet de la semaine en cours."
            >
              <Input
                name="balance"
                type="date"
                required
                defaultValue={pref.balanceStartDate ?? weekDays()[0]}
              />
            </Field>
            <Field label="Heure du rappel des temps à classer">
              <Input
                name="reminder"
                type="number"
                min="0"
                max="23"
                required
                defaultValue={pref.reminderHour ?? 16}
              />
            </Field>
          </AsyncForm>
          <WorkScheduleSettings />
        </Card>
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Sécurité du compte</h2>
          <p className="text-sm text-muted-foreground">
            {state.me.name} · {state.me.username}
          </p>
          <AsyncForm
            submitLabel="Changer le mot de passe"
            onSubmit={async (f) => {
              if (f.get("password") !== f.get("confirm"))
                throw Error("Les mots de passe ne correspondent pas.");
              await mutate("/api/account/password", "POST", {
                currentPassword: f.get("current"),
                password: f.get("password"),
              });
            }}
          >
            <Field label="Mot de passe actuel">
              <Input
                name="current"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="Nouveau mot de passe">
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <Field label="Confirmer le nouveau mot de passe">
              <Input
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Les autres sessions seront déconnectées après le changement.
            </p>
          </AsyncForm>
        </Card>
      </div>
      <HolidaySettings />
      {canViewTeam(state.me.role) && (
        <>
          <Card className="gap-0 overflow-hidden py-0">
            <div className="flex items-center justify-between gap-3 border-b p-5">
              <div>
                <h2 className="font-semibold">Les personnes de l’équipe</h2>
                <p className="text-xs text-muted-foreground">
                  Les membres voient leurs temps ; les responsables voient ceux
                  de l’équipe.
                </p>
              </div>
              {state.me.role === "admin" && <Button onClick={() => setUserForm(true)}>
                <UserPlus />
                Ajouter un membre
              </Button>}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Nom</TableHead>
                  <TableHead>Identifiant</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead className="text-right pr-5">Accès</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.users.filter((u) => u.active || showRemoved).map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="pl-5">{u.name}</TableCell>
                    <TableCell>{u.username}</TableCell>
                    <TableCell>
                      {roleLabel(u.role)}
                      {state.me.role === "admin" && !!u.active && (
                        <Button size="sm" variant="ghost" className="ml-1"
                          aria-label={"Modifier le rôle de " + u.name} onClick={() => setRolePerson(u)}>
                          <Pencil size={14} /> Modifier
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-right pr-5">
                      {u.active && state.me.role === "admin" ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Button size="sm" variant="outline"
                            aria-label={"Modifier l’identifiant de " + u.name}
                            onClick={() => setAccess({ person: u, mode: "username" })}>
                            <Pencil /> Modifier l’identifiant
                          </Button>
                          {u.id !== state.me.id ? (
                            <>
                              <Button size="sm" variant="outline" onClick={() => setReset(u)}>
                                <KeyRound /> Réinitialiser
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive"
                                aria-label={"Supprimer l’utilisateur " + u.name}
                                onClick={() => setAccess({ person: u, mode: "remove" })}>
                                <Trash2 /> Supprimer
                              </Button>
                            </>
                          ) : <span className="text-xs text-muted-foreground">Votre compte</span>}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">{u.active ? "Gestion réservée aux administrateurs" : "Accès retiré · historique conservé"}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {state.users.some((u) => !u.active) && (
              <div className="border-t p-3">
                <Button variant="ghost" size="sm" onClick={() => setShowRemoved(!showRemoved)}>
                  {showRemoved ? "Masquer les comptes retirés" : "Afficher les comptes retirés"}
                </Button>
              </div>
            )}
          </Card>
          <Card className="flex-row flex-wrap items-center justify-between p-5">
            <div>
              <h2 className="font-semibold">Journal de suivi</h2>
              <p className="text-sm text-muted-foreground">
                Consultez les changements et vérifiez l’intégrité de
                l’historique.
              </p>
            </div>
            <Button variant="outline" onClick={() => setJournal(true)}>
              <ShieldCheck />
              Consulter le journal
            </Button>
          </Card>
        </>
      )}
      {rolePerson && <UserRoleEditor person={rolePerson} onClose={() => setRolePerson(null)} />}
      {userForm && <UserEditor onClose={() => setUserForm(false)} />}{" "}
      {reset && <UserEditor person={reset} onClose={() => setReset(null)} />}{" "}
      {access && <UserAccessEditor person={access.person} mode={access.mode} onClose={() => setAccess(null)} />}
      {journal && <JournalModal onClose={() => setJournal(false)} />}
    </>
  );
}

function UserAccessEditor({
  person,
  mode,
  onClose,
}: {
  person: Person;
  mode: "username" | "remove";
  onClose: () => void;
}) {
  const { mutate } = useWorkspace();
  const removing = mode === "remove";
  return (
    <Modal
      title={removing ? "Supprimer l’utilisateur" : "Modifier l’identifiant"}
      description={person.name + " · " + person.username}
      onClose={onClose}
    >
      <AsyncForm
        submitLabel={removing ? "Supprimer l’accès" : "Enregistrer l’identifiant"}
        onCancel={onClose}
        onSubmit={async (form) => {
          await mutate(
            "/api/users/" + person.id + (removing ? "" : "/username"),
            removing ? "DELETE" : "PATCH",
            removing
              ? { confirmUsername: form.get("confirmation") }
              : { username: form.get("username"), previousUsername: person.username },
            removing
              ? "Accès supprimé. Les heures et l’historique sont conservés."
              : "Identifiant modifié. Le mot de passe reste identique.",
          );
          onClose();
        }}
      >
        {removing ? (
          <>
            <p className="text-sm">
              Cette personne ne pourra plus se connecter et ses sessions seront
              fermées. Ses heures, ses affectations et son historique resteront
              consultables. Un chrono en cours doit être arrêté avant le retrait.
            </p>
            <Field label="Identifiant de confirmation" hint={"Saisissez " + person.username + " pour confirmer."}>
              <Input name="confirmation" autoComplete="off" maxLength={200} required />
            </Field>
          </>
        ) : (
          <>
            <Field label="Nouvel identifiant" hint="3 à 40 caractères : lettres sans accents, chiffres, point, tiret ou underscore.">
              <Input name="username" defaultValue={person.username} autoComplete="off"
                minLength={3} maxLength={40} required />
            </Field>
            <p className="text-sm text-muted-foreground">
              Le nouvel identifiant sera utilisé à la prochaine connexion.
              Le mot de passe, les heures et les sessions actuelles sont conservés.
            </p>
          </>
        )}
      </AsyncForm>
    </Modal>
  );
}


function UserRoleEditor({ person, onClose }: { person: Person; onClose: () => void }) {
  const { mutate } = useWorkspace();
  const [role, setRole] = useState<Person["role"]>(person.role);
  return (
    <Modal title="Modifier le rôle" description={person.name} onClose={onClose}>
      <AsyncForm onCancel={onClose} onSubmit={async () => {
        await mutate("/api/users/" + person.id + "/role", "PATCH",
          { role, previousRole: person.role },
          "Rôle enregistré. Une reconnexion est nécessaire après un changement.");
        onClose();
      }}>
        <Field label="Nouveau rôle">
          <NativeSelect label="Nouveau rôle" value={role} onChange={value => setRole(value as Person["role"])}
            options={[["member", "Membre"], ["manager", "Responsable"], ["admin", "Administrateur"]]} />
        </Field>
        <p className="text-sm text-muted-foreground">
          {role === "admin" ? "Gère les comptes et les rôles, et consulte les temps de toute l’équipe."
            : role === "manager" ? "Consulte les temps de l’équipe, sans gérer les comptes."
            : "Consulte et modifie uniquement ses propres temps."}
          {" "}Les sessions de cette personne seront fermées si son rôle change.
        </p>
      </AsyncForm>
    </Modal>
  );
}

function UserEditor({
  person,
  onClose,
}: {
  person?: Person;
  onClose: () => void;
}) {
  const { mutate } = useWorkspace();
  const [password, setPassword] = useState(""),
    [role, setRole] = useState("member");
  const generate = () => {
    const alphabet =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@";
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    setPassword(
      Array.from(bytes, (x) => alphabet[x % alphabet.length]).join(""),
    );
  };
  return (
    <Modal
      title={
        person
          ? "Réinitialiser le mot de passe de " + person.name
          : "Ajouter un membre"
      }
      description={
        person
          ? "Les sessions de cette personne seront révoquées."
          : "Le compte peut être utilisé immédiatement après sa création."
      }
      onClose={onClose}
    >
      <AsyncForm
        onCancel={onClose}
        onSubmit={async (f) => {
          await mutate(
            person ? "/api/users/" + person.id + "/password" : "/api/users",
            "POST",
            person
              ? { password }
              : {
                  name: f.get("name"),
                  username: f.get("username"),
                  password,
                  role,
                },
          );
          onClose();
        }}
      >
        {!person && (
          <>
            <Field label="Nom complet">
              <Input name="name" maxLength={100} required />
            </Field>
            <Field label="Identifiant">
              <Input
                name="username"
                autoComplete="off"
                maxLength={200}
                required
              />
            </Field>
            <Field label="Rôle">
              <NativeSelect
                label="Rôle"
                value={role}
                onChange={setRole}
                options={[
                  ["member", "Membre"],
                  ["manager", "Responsable"],
                  ["admin", "Administrateur"],
                ]}
              />
            </Field>
          </>
        )}
        <Field
          label="Mot de passe"
          hint="8 caractères minimum. Transmettez-le à la personne par un canal adapté."
        >
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
          />
        </Field>
        <Button variant="outline" type="button" onClick={generate}>
          Générer un mot de passe
        </Button>
      </AsyncForm>
    </Modal>
  );
}
function JournalModal({ onClose }: { onClose: () => void }) {
  const { state } = useWorkspace();
  const [filters, setFilters] = useState({
      level: "",
      category: "",
      requestId: "",
    }),
    [before, setBefore] = useState<number | null>(null),
    [data, setData] = useState<Journal | null>(null),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value) params.set(key, value);
    if (before) params.set("before", String(before));
    api<Journal>(
      "/api/journal?" + params,
      "GET",
      undefined,
      undefined,
      c.signal,
    )
      .then((x) => {
        setData(x);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [filters, before, tick]);
  const filter = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setBefore(null);
  };
  return (
    <Modal
      title="Journal de suivi"
      description="Historique métier, connexions et événements du serveur."
      onClose={onClose}
      wide
    >
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          label="Niveau du journal"
          value={filters.level}
          onChange={(v) => filter("level", v)}
          options={[
            ["", "Tous les niveaux"],
            ["info", "Information"],
            ["warning", "Attention"],
            ["error", "Erreur"],
          ]}
        />
        <NativeSelect
          label="Catégorie du journal"
          value={filters.category}
          onChange={(v) => filter("category", v)}
          options={[
            ["", "Toutes les catégories"],
            ["audit", "Métier"],
            ["request", "Requêtes"],
            ["system", "Système"],
          ]}
        />
        <Input
          aria-label="Référence de requête"
          placeholder="Référence de requête…"
          className="min-w-48 flex-1"
          value={filters.requestId}
          onChange={(e) => filter("requestId", e.target.value)}
        />
        <Button
          variant="outline"
          onClick={() => {
            setBefore(null);
            setTick((v) => v + 1);
          }}
        >
          <RefreshCw />
          Actualiser
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void api<{ ok: boolean; count: number }>("/api/journal/verify")
              .then((result) =>
                result.ok
                  ? toast.success(
                      "Intégrité vérifiée : " +
                        result.count +
                        " événements contrôlés.",
                    )
                  : toast.error("La vérification a détecté une incohérence."),
              )
              .catch((e) => toast.error(e.message))
          }
        >
          <ShieldCheck />
          Vérifier l’intégrité
        </Button>
        <Button
          variant="outline"
          disabled={!data}
          onClick={() =>
            saveBlob(
              new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              }),
              "timeteknika-journal-" + Date.now() + ".json",
            )
          }
        >
          <Download />
          Exporter cette page
        </Button>
      </div>
      <ErrorMessage message={error} />
      <div className="grid gap-2">
        {data?.items.map((i) => (
          <details key={i.seq} className="rounded-md border p-3">
            <summary className="cursor-pointer text-xs">
              <span className="mr-2 text-muted-foreground">
                #{i.seq} · {prettyDay(dayKey(i.at), true)} {clockTime(i.at)}
              </span>
              <b>{i.action}</b> · {i.level}{" "}
              {state.users.find((u) => u.id === i.actor)?.name}
            </summary>
            <pre className="mt-3 overflow-auto text-xs">
              {JSON.stringify(i.details, null, 2)}
            </pre>
            {i.request_id && (
              <p className="mt-2 text-xs">Référence : {i.request_id}</p>
            )}
          </details>
        ))}
      </div>
      {data?.nextBefore && (
        <Button variant="outline" onClick={() => setBefore(data.nextBefore)}>
          <ChevronDown />
          Événements plus anciens
        </Button>
      )}
    </Modal>
  );
}
