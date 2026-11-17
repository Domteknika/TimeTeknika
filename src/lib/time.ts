export const zone = "Europe/Zurich";
const dayFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
const clockFormatter = new Intl.DateTimeFormat("fr-CH", { timeZone: zone, hour: "2-digit", minute: "2-digit" });
const wallFormatter = new Intl.DateTimeFormat("fr-CH", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const prettyFormatters = [false, true].map(short => new Intl.DateTimeFormat("fr-CH", { timeZone: zone, weekday: short ? "short" : "long", day: "numeric", month: short ? "short" : "long" }));
export const dayKey = (ms = Date.now()) => dayFormatter.format(ms);
export const shiftDay = (day: string, n: number) =>
  new Date(Date.parse(day + "T12:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export function weekDays(offset = 0, now = Date.now()) {
  const day = dayKey(now),
    weekday = new Date(day + "T12:00:00Z").getUTCDay();
  const monday = shiftDay(day, -((weekday + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
}
export const clockTime = (ms: number) => clockFormatter.format(ms);
export const prettyDay = (day: string, short = false) =>
  prettyFormatters[Number(short)].format(new Date(day + "T12:00:00Z"));
export function duration(value: number, seconds = false) {
  const n = Math.max(0, Math.floor(value));
  return (
    String(Math.floor(n / 3600)).padStart(2, "0") +
    ":" +
    String(Math.floor(n / 60) % 60).padStart(2, "0") +
    (seconds ? ":" + String(n % 60).padStart(2, "0") : "")
  );
}
export const elapsed = (
  e: { start: number; end: number | null },
  now: number,
) => Math.max(0, ((e.end ?? now) - e.start) / 1000);
export const wallTime = (ms: number) => dayKey(ms) + "T" + wallFormatter.format(ms);
export function zoneInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))
    throw Error("Date et heure invalides.");
  const target = Date.parse(value + (value.length === 16 ? ":00Z" : "Z"));
  if (
    !Number.isFinite(target) ||
    new Date(target).toISOString().slice(0, value.length) !== value
  )
    throw Error("Date invalide.");
  let result = target;
  for (let i = 0; i < 5; i++) {
    const actual = Date.parse(wallTime(result) + "Z");
    const delta = target - actual;
    if (!delta) return result;
    result += delta;
  }
  throw Error("Cette heure n’existe pas dans le fuseau Europe/Zurich.");
}
export function editedInstant(value: string, original?: number | null) {
  const normalized = value.length === 16 ? value + ":00" : value;
  return original != null && wallTime(original) === normalized
    ? original
    : zoneInstant(value);
}
export const midnight = (day: string) => zoneInstant(day + "T00:00");
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr");
