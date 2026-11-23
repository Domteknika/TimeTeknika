import type { WorkTime } from "./types";

export const emptyWorkTime: WorkTime = { schedules: [], leaves: [], holidays: [] };
const dayNumber = new Intl.NumberFormat("fr-CH");

export function workDaysLabel(days: number) {
  return dayNumber.format(days) + (Math.abs(days) > 1 ? " jours" : " jour");
}

export function workMinutesLabel(minutes: number) {
  if (minutes > 0 && minutes < 60) return minutes + " min";
  const remainder = minutes % 60;
  return Math.floor(minutes / 60) + " h" + (remainder ? " " + String(remainder).padStart(2, "0") : "");
}

export function readWorkMinutes(value: string) {
  const match = /^(\d{1,2})(?::([0-5]\d))?$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2] ?? 0);
  return minutes <= 1440 ? minutes : null;
}
