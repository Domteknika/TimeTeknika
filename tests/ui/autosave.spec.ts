import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { weekDays, zoneInstant } from "../../src/lib/time";
import type { Entry, Snapshot } from "../../src/lib/types";

test("Un rapport hebdomadaire garde son année ISO et ses filtres à l’export", async ({ page }) => {
  await page.goto("/#reports");
  await page.getByRole("button", { name: /Alex Martin/ }).click();
  await page.getByLabel("Du", { exact: true }).fill("2025-12-29");
  await page.getByLabel("Au", { exact: true }).fill("2026-01-04");
  await expect(page.getByRole("heading", { name: "Semaine 1 · 2026" })).toBeVisible();
  await page.getByLabel("Au", { exact: true }).fill("2026-01-14");
  await expect(page.getByRole("heading", { name: /Semaine 1/ })).toHaveCount(0);
  await page.getByLabel("Au", { exact: true }).fill("2026-01-04");
  await page.getByRole("combobox", { name: "Projet du rapport" }).click();
  await page.getByRole("option", { name: /Résidence Les Cèdres/ }).click();
  await page.getByPlaceholder("Rechercher dans les descriptions…").fill("dimensions");
  const preview = page.waitForRequest(r => r.url().endsWith("/api/exports/preview"));
  await page.getByRole("button", { name: "Exporter les temps" }).click();
  expect((await preview).postDataJSON().config).toMatchObject({
    period: { from: "2025-12-29", to: "2026-01-04" },
    filters: { projects: ["project-cedres"], query: "dimensions", timers: "all" },
  });
});

test("La liste et le calendrier répartissent le même temps sur deux jours", async ({ page }) => {
  await page.goto("/#timer");
  await page.getByRole("button", { name: /Emma Laurent/ }).click();
  const state: Snapshot = await (await page.request.get("/api/state")).json();
  const [monday, tuesday] = weekDays(-1, state.serverNow);
  const response = await page.request.post("/api/entries", {
    headers: { "X-CSRF-Token": state.csrf, "Idempotency-Key": randomUUID() },
    data: { task_id: "task-plans", description: "Essai de minuit",
      start: new Date(zoneInstant(monday + "T23:30")).toISOString(), end: new Date(zoneInstant(tuesday + "T00:30")).toISOString() },
  });
  expect(response.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  await page.getByRole("button", { name: "Semaine précédente", exact: true }).click();
  const rows = page.locator(".entry-row").filter({ hasText: "Essai de minuit" });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("00:30");
  await expect(rows.nth(1)).toContainText("00:30");
  await page.getByRole("button", { name: "Calendrier", exact: true }).click();
  await page.getByLabel("Plage horaire").selectOption("full");
  await page.getByLabel("Zoom du calendrier").selectOption("150");
  const blocks = page.locator(".calendar-entry").filter({ hasText: "Essai de minuit" });
  await expect(blocks).toHaveCount(2);
  await expect(blocks.first()).toContainText("Plans d’exécution · Résidence Les Cèdres");
  await page.getByRole("button", { name: "Liste", exact: true }).click();
});

test("Une création dont la réponse se perd survit au rechargement sans doublon", async ({ page }) => {
  await page.goto("/#timer");
  await page.getByRole("button", { name: /Lucas Morel/ }).click();
  const marker = "Création récupérée " + randomUUID();
  const keys: string[] = [];
  await page.route("**/api/entries", async route => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Ajouter du temps" }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Description", { exact: true }).fill(marker);
  await expect(editor.getByRole("button", { name: "Réessayer" })).toBeVisible();
  expect(new Set(keys).size).toBe(1);
  await page.unroute("**/api/entries");
  const confirmation = page.waitForResponse(r => r.url().endsWith("/api/entries") && r.request().method() === "POST");
  await page.reload();
  expect((await confirmation).request().headers()["idempotency-key"]).toBe(keys[0]);
  const saved = (await (await page.request.get("/api/state")).json()).entries.filter((e: Entry) => e.description === marker);
  expect(saved).toHaveLength(1);
});

test("Une correction est annulable et une modification concurrente reste visible", async ({ page }) => {
  await page.goto("/#timer");
  await page.getByRole("button", { name: /Emma Laurent/ }).click();
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  const state: Snapshot = await (await page.request.get("/api/state")).json();
  const marker = "Vérification " + randomUUID();
  const headers = () => ({ "X-CSRF-Token": state.csrf, "Idempotency-Key": randomUUID() });
  const response = await page.request.post("/api/entries", { headers: headers(), data: {
    description: marker, start: new Date(state.serverNow - 120000).toISOString(),
    end: new Date(state.serverNow - 60000).toISOString(), confirmOverlap: true,
  } });
  expect(response.ok()).toBeTruthy();
  const {entry} = await response.json();
  const path = "/api/entries/" + entry.id;
  await page.getByRole("button", { name: marker, exact: true }).click();
  const editor = page.getByRole("dialog");
  const description = editor.getByLabel("Description", {exact:true});
  await description.fill(marker + " corrigé");
  await editor.getByRole("button", {name:"Annuler la modification"}).click();
  await expect(description).toHaveValue(marker);
  await expect(editor.getByRole("status")).toContainText("Enregistré");
  const reverted = (await (await page.request.get(path)).json()).entry;
  expect(reverted).toMatchObject({description:marker, start:entry.start, end:entry.end, version:entry.version+2});
  await page.route("**" + path, async route => {
    if (route.request().method() === "PATCH") {
      const changed = await page.request.patch(path, {headers:headers(), data:{version:reverted.version, description:marker + " ailleurs"}});
      expect(changed.ok()).toBeTruthy();
    }
    await route.continue();
  });
  await description.fill(marker + " local");
  await expect(editor.getByRole("alert")).toContainText("changé ailleurs");
  await expect(description).toHaveValue(marker + " local");
  await page.unroute("**" + path);
  await editor.getByRole("button", {name:"Écarter ma correction"}).click();
  await expect(description).toHaveValue(marker + " ailleurs");
  expect((await (await page.request.get(path)).json()).entry.version).toBe(reverted.version + 1);
});
