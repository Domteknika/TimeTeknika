import type { Person } from "./types";
export const roleLabel = (role: Person["role"]) =>
  ({ admin: "Administrateur", manager: "Responsable", member: "Membre" })[role];
export const canViewTeam = (role: Person["role"]) => role === "admin" || role === "manager";
