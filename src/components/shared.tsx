import {
  useId,
  useState,
  isValidElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type FormEvent,
} from "react";
import { Loader2, Search, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { normalize } from "@/lib/time";
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">ESPACE DE TRAVAIL</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId(),
    controlId = id + "-control";
  return (
    <div className="grid gap-2 text-sm font-medium">
      <Label id={id} htmlFor={controlId}>
        {label}
      </Label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, {
            id: controlId,
          })
        : children}
      {hint && (
        <span className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {message}
    </p>
  ) : null;
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Search size={24} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[90dvh] overflow-y-auto sm:max-w-xl",
          wide && "sm:max-w-3xl",
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ??
              "Les modifications seront enregistrées pour toute votre équipe."}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function AsyncForm({
  children,
  onSubmit,
  submitLabel = "Enregistrer",
  onCancel,
  actions,
  destructive = false,
  disabled = false,
}: {
  children: ReactNode;
  onSubmit: (form: FormData) => Promise<void>;
  submitLabel?: string;
  onCancel?: () => void;
  actions?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await onSubmit(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-5">
      <fieldset disabled={busy || disabled} className="grid min-w-0 gap-5">
        {children}
        <ErrorMessage message={error} />
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          {actions && <div className="mr-auto">{actions}</div>}
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Annuler
            </Button>
          )}
          <Button type="submit" variant={destructive ? "destructive" : "default"}>
            {busy && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
export type Option = {
  value: string;
  label: string;
  detail?: string;
  color?: string;
  disabled?: boolean;
};
export function Choice({
  id: controlId,
  label,
  value,
  onChange,
  options,
  placeholder = "Tous",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    id = useId();
  const selected = options.find((o) => o.value === value);
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={controlId ?? id}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          disabled={disabled}
          className="min-w-0 justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {selected?.color && (
              <i
                className="size-2 shrink-0 rounded-full"
                style={{ background: selected.color }}
              />
            )}
            <span className="truncate">{selected?.label ?? placeholder}</span>
          </span>
          <ChevronsUpDown className="ml-2 size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(350px,85vw)] p-2">
        <Label htmlFor={id + "-query"} className="sr-only">
          Rechercher {label}
        </Label>
        <Input
          id={id + "-query"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher…"
          className="mb-2"
        />
        <div
          role="listbox"
          aria-label={label}
          className="max-h-64 overflow-auto"
        >
          {options
            .filter((o) =>
              normalize(o.label + " " + (o.detail ?? "")).includes(
                normalize(query),
              ),
            )
            .map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                disabled={o.disabled}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted focus:bg-muted disabled:opacity-40"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.color && (
                  <i
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: o.color }}
                  />
                )}
                <span className="flex-1">
                  {o.label}
                  {o.detail && (
                    <small className="block text-muted-foreground">
                      {o.detail}
                    </small>
                  )}
                </span>
                {o.value === value && <Check size={14} />}
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
export function NativeSelect({
  label,
  value,
  onChange,
  options,
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  name?: string;
}) {
  return (
    <select
      name={name}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border bg-background px-3 text-sm shadow-xs"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
