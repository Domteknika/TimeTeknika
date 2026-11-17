import { roleLabel, canViewTeam } from "@/lib/roles";
import { ArrowUpRight, ArrowRight, Clock3 } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AsyncForm, Field, ErrorMessage } from "@/components/shared";
import { toast } from "sonner";
export function LoginPage() {
  const { info, login, error } = useApp();
  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="brand">
          <span className="brand-symbol">t.</span>
          <span>
            TimeTeknika<span className="brand-caption">LE TEMPS EN ÉQUIPE</span>
          </span>
        </div>
        <div className="login-title">
          <span className="eyebrow">MOINS DE DISPERSION, PLUS DE CLARTÉ</span>
          <h1>
            Du temps pour
            <br />
            ce qui compte<span>.</span>
          </h1>
          <p>
            Vos projets avancent.
            <br />
            Votre temps trouve sa place.
          </p>
        </div>
        <div className="login-illustration" aria-hidden="true">
          <div className="orbit-circle">
            <Clock3 strokeWidth={1} />
          </div>
          <div className="floating-note">
            <i />
            Une chose à la fois.
            <ArrowUpRight size={18} />
          </div>
          <div className="floating-time">
            02<span>:</span>34<span>:</span>18
          </div>
        </div>
        <div className="login-footer">
          Pensé pour les équipes qui construisent ensemble.
        </div>
      </section>
      <section className="login-panel">
        <div className="login-form">
          <span className="eyebrow">VOTRE ESPACE TIMEteknika</span>
          <h2>{info?.setup ? "Bienvenue chez vous." : "Bon retour."}</h2>
          <p>
            {info?.setup
              ? "Créez votre compte responsable pour ouvrir l’espace de votre équipe."
              : "Retrouvez votre équipe, vos projets et le fil de votre journée."}
          </p>
          <ErrorMessage message={error} />
          {info?.demo && (
            <div className="demo-users">
              <span className="text-xs font-medium text-muted-foreground">
                EXPLORER LA DÉMONSTRATION
              </span>
              {info.demoUsers.map((u) => (
                <Button
                  key={u.id}
                  variant="outline"
                  className="h-auto justify-start py-3"
                  onClick={() =>
                    void login("/api/demo-login", { user_id: u.id }).catch(
                      (e) => toast.error(e.message),
                    )
                  }
                >
                  <span className="mini-avatar" style={{ background: u.color }}>
                    {u.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </span>
                  <span className="flex-1 text-left">
                    {u.name}
                    <small className="block font-normal text-muted-foreground">
                      {roleLabel(u.role)}
                    </small>
                  </span>
                  <ArrowRight />
                </Button>
              ))}
            </div>
          )}
          <AsyncForm
            submitLabel={info?.setup ? "Créer mon espace" : "Se connecter"}
            onSubmit={(f) =>
              login(
                info?.setup ? "/api/setup" : "/api/login",
                Object.fromEntries(f),
              )
            }
          >
            {info?.setup && (
              <Field label="Votre nom">
                <Input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                />
              </Field>
            )}
            <Field label="Identifiant">
              <Input
                name="username"
                autoComplete="username"
                required
                placeholder="alex.martin"
                maxLength={200}
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
            <Field label="Mot de passe">
              <Input
                name="password"
                type="password"
                autoComplete={info?.setup ? "new-password" : "current-password"}
                required
                minLength={info?.setup ? 8 : undefined}
              />
            </Field>
            {info?.setup && (
              <Field
                label="Jeton de configuration"
                hint="Laisser vide pour une installation sur cet ordinateur."
              >
                <Input name="setupToken" type="password" autoComplete="off" />
              </Field>
            )}
          </AsyncForm>
          <p className="login-note">
            {info?.demo
              ? "Démonstration locale · données fictives."
              : "Vos données restent dans l’espace de votre entreprise."}
          </p>
        </div>
      </section>
    </main>
  );
}
