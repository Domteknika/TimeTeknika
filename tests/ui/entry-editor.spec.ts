import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { dayKey, shiftDay, zoneInstant } from "../../src/lib/time";
import type { Entry, Snapshot } from "../../src/lib/types";
test("Time editor: separate dates, project tasks, duration and explicit overlap", async ({page}) => {
  await page.goto("/");
  await page.getByRole("button", {name:/Alex Martin/}).click();
  await page.getByRole("button", {name:"Mon temps", exact:true}).click();
  const marker = "Horaires fictifs " + Date.now();
  const snapshot = await (await page.request.get("/api/state")).json();
  const task = snapshot.tasks.find((t: {assignees: string[]; archived: boolean}) => !t.archived && t.assignees.includes(snapshot.me.id));
  const project = snapshot.projects.find((p: {id:string}) => p.id === task.project_id);
  async function fill(description: string) {
    await page.getByRole("button", {name:"Ajouter du temps", exact:true}).click();
    await page.getByLabel("Description", {exact:true}).fill(description);
    await page.getByLabel("Date de début", {exact:true}).fill("2000-01-03");
    await page.getByLabel("Heure de début", {exact:true}).fill("08:15");
    await page.getByLabel("Date de fin", {exact:true}).fill("2000-01-03");
    await page.getByLabel("Heure de fin", {exact:true}).fill("09:45");
  }
  await fill(marker);
  await page.getByRole("dialog").getByRole("combobox", {name:"Projet", exact:true}).click();
  await page.getByRole("option", {name:project.name, exact:false}).click();
  await page.getByRole("dialog").getByRole("combobox", {name:"Tâche", exact:true}).click();
  await page.getByRole("textbox", {name:"Rechercher une tâche", exact:true}).fill(task.name);
  await page.locator('[data-slot="popover-content"]').getByRole("button", {name:task.name, exact:true}).click();
  await expect(page.getByText("Durée : 01:30", {exact:true})).toBeVisible();
  await page.getByRole("button", {name:"Fermer", exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const entry = (await (await page.request.get("/api/state")).json()).entries.find((e: {description:string}) => e.description === marker);
  expect(entry.start).toBe(Date.parse("2000-01-03T07:15:00Z"));
  expect(entry.end).toBe(Date.parse("2000-01-03T08:45:00Z"));
  expect(entry.task_id).toBe(task.id);
  await fill(marker + " doublon");
  const consent = page.getByRole("checkbox", {name:/Ce créneau chevauche/});
  await expect(consent).not.toBeChecked();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("chevauche");
  await consent.check();
  await page.getByRole("button", {name:"Fermer", exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Time editor: task selection saves immediately, keeps drafts and advances the version", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Alex Martin/ }).click();
  const snapshot = await (await page.request.get("/api/state")).json();
  const task = snapshot.tasks.find((t: { assignees: string[]; archived: boolean }) => !t.archived && t.assignees.includes(snapshot.me.id));
  const marker = "Tâche automatique " + Date.now();
  const created = await page.request.post("/api/entries", {
    headers: { "X-CSRF-Token": snapshot.csrf, "Idempotency-Key": randomUUID() },
    data: { description: marker, start: new Date(snapshot.serverNow - 120000).toISOString(), end: new Date(snapshot.serverNow - 60000).toISOString(), confirmOverlap: true },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { entry } = await created.json();
  const entryPath = `/api/entries/${entry.id}`;
  await page.getByRole("button", { name: "Mon temps", exact: true }).click();
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  await page.getByRole("button", { name: marker, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Modifier le temps", exact: true });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**" + entryPath, async route => {
    if (route.request().method() === "PATCH") await gate;
    await route.continue();
  });
  await editor.getByRole("combobox", { name: "Tâche", exact: true }).click();
  await page.getByRole("textbox", { name: "Rechercher une tâche", exact: true }).fill(task.name);
  const saved = page.waitForResponse(r => r.url().endsWith(entryPath) && r.request().method() === "PATCH");
  await page.locator('[data-slot="popover-content"]').getByRole("button", { name: task.name, exact: true }).click();
  await expect(editor.getByRole("status")).toContainText("En cours");
  await editor.getByLabel("Description", { exact: true }).fill(marker + " validé");
  release();
  expect((await saved).request().postDataJSON()).toMatchObject({ task_id: task.id, project_id: task.project_id, version: entry.version });
  await editor.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.unroute("**" + entryPath);
  const updated = (await (await page.request.get("/api/state")).json()).entries.find((e: { id: string }) => e.id === entry.id);
  expect(updated).toMatchObject({ task_id: task.id, description: marker + " validé", start: entry.start, end: entry.end });
  await page.getByRole("button", { name: marker + " validé", exact: true }).click();
  await editor.getByRole("button", { name: "Supprimer ce temps", exact: true }).click();
  await page.getByRole("dialog", { name: "Supprimer ce temps ?", exact: true }).getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Time editor: a failed task save is visible and a running timer stays running", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Alex Martin/ }).click();
  await page.getByRole("button", { name: "Mon temps", exact: true }).click();
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  const stop = page.getByRole("button", { name: "Arrêter le chrono", exact: true });
  if (await stop.isVisible()) await stop.click();
  const marker = "Tâche chrono " + Date.now();
  await page.getByRole("textbox", { name: "Description du chrono", exact: true }).fill(marker);
  await page.getByRole("button", { name: "Démarrer", exact: true }).click();
  await expect(stop).toBeVisible();
  const snapshot = await (await page.request.get("/api/state")).json();
  const entry = snapshot.entries.find((e: { description: string }) => e.description === marker);
  const task = snapshot.tasks.find((t: { id: string; assignees: string[]; archived: boolean }) => t.id !== entry.task_id && !t.archived && t.assignees.includes(snapshot.me.id));
  const entryPath = `/api/entries/${entry.id}`;
  await page.getByRole("button", { name: marker, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Modifier le temps", exact: true });
  async function chooseTask() {
    await editor.getByRole("combobox", { name: "Projet", exact: true }).click();
    await page.getByRole("option", { name: "Sans projet", exact: true }).click();
    await editor.getByRole("combobox", { name: "Tâche", exact: true }).click();
    await page.getByRole("textbox", { name: "Rechercher une tâche", exact: true }).fill(task.name);
    await page.locator('[data-slot="popover-content"]').getByRole("button", { name: task.name, exact: true }).click();
  }
  await page.route("**" + entryPath, route => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "forbidden", message: "Écriture refusée pour ce test." }) }));
  await chooseTask();
  await expect(editor.getByRole("alert")).toContainText("Écriture refusée");
  expect((await (await page.request.get("/api/state")).json()).entries.find((e: { id: string }) => e.id === entry.id)).toEqual(entry);
  await expect(editor.getByRole("status")).toHaveCount(0);
  await page.unroute("**" + entryPath);
  await editor.getByRole("button", { name: "Réessayer" }).click();
  await expect(editor.getByRole("status")).toContainText("Enregistré");
  const persisted = (await (await page.request.get("/api/state")).json()).entries.find((e: { id: string }) => e.id === entry.id);
  expect(persisted).toMatchObject({ task_id: task.id, start: entry.start, end: null, description: marker, version: entry.version + 1 });
  await expect(editor.getByRole("checkbox", { name: "Laisser le chrono en cours", exact: true })).toBeChecked();
  await expect(editor.getByRole("button", { name: "Supprimer ce temps", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(stop).toBeVisible();
  await stop.click();
});

test("Le bandeau suit le classement du chrono depuis le calendrier", async ({ page }) => {
  await page.goto("/#timer");
  await page.getByRole("button", { name: /Lucas Morel/ }).click();
  await page.getByRole("button", { name: "Calendrier", exact: true }).click();
  await page.getByLabel("Jours affichés").selectOption("7");
  await page.getByLabel("Plage horaire").selectOption("full");
  const timer = page.locator(".timer-card");
  const activeActivity = timer.locator(".timer-actions");
  const taskChoice = timer.getByRole("combobox", { name: "Tâche", exact: true });
  const projectChoice = timer.getByRole("combobox", { name: "Projet", exact: true });
  const switchActivity = timer.getByRole("button", { name: "Basculer sur cette activité" });
  const stop = timer.getByRole("button", { name: "Arrêter le chrono", exact: true });
  const snapshot = async () => (await page.request.get("/api/state")).json();
  await timer.getByRole("button", { name: "Démarrer", exact: true }).click();
  await expect(activeActivity).toContainText("À classer");
  const before = await snapshot();
  const running = before.entries.find((entry: { end: number | null }) => entry.end === null);
  const project = "Résidence Les Cèdres";

  async function classifyFromCalendar(task: string) {
    await page.locator(".calendar-day.today").getByRole("button", { name: /^Modifier le chrono en cours/ }).click();
    const editor = page.getByRole("dialog", { name: "Modifier le temps", exact: true });
    await editor.getByRole("combobox", { name: "Projet", exact: true }).click();
    await page.getByRole("option", { name: new RegExp(project) }).click();
    await editor.getByRole("combobox", { name: "Tâche", exact: true }).click();
    await page.getByRole("textbox", { name: "Rechercher une tâche", exact: true }).fill(task);
    await page.locator('[data-slot="popover-content"]').getByRole("button", { name: task, exact: true }).click();
    await expect(editor.getByRole("status")).toContainText("Enregistré");
    await editor.getByRole("button", { name: "Fermer", exact: true }).click();
  }

  await classifyFromCalendar("Plans d’exécution");
  await expect(activeActivity).toContainText("Plans d’exécution · " + project);
  await expect(taskChoice).toContainText("Plans d’exécution");
  await expect(projectChoice).toContainText(project);
  await expect(switchActivity).toHaveCount(0);

  await projectChoice.click();
  await page.getByRole("option", { name: /Rénovation Atelier/ }).click();
  await expect(switchActivity).toHaveCount(0);
  await expect(activeActivity).toContainText("Rénovation Atelier");
  await classifyFromCalendar("Coordination technique");
  await expect(activeActivity).toContainText("Coordination technique · " + project);
  await expect(projectChoice).toContainText(project);

  const after = await snapshot();
  expect(after.entries).toHaveLength(before.entries.length);
  expect(after.entries.find((entry: { end: number | null }) => entry.end === null)).toMatchObject({
    id: running.id, start: running.start, task_id: "task-coordination", project_id: "project-cedres",
  });
  await page.reload();
  await expect(taskChoice).toContainText("Coordination technique");
  await expect(projectChoice).toContainText(project);
  await stop.click();
  await expect(stop).toHaveCount(0);
});

test.describe("Reprise depuis le calendrier", () => {
  test.use({ hasTouch: true });

  test("Relance la tâche et garde la modification du créneau accessible", async ({ page }) => {
    await page.goto("/#timer");
    await page.getByRole("button", { name: /Alex Martin/ }).click();
    const snapshot = async (): Promise<Snapshot> => (await page.request.get("/api/state")).json();
    const before = await snapshot();
    const yesterday = shiftDay(dayKey(before.serverNow), -1);
    const marker = "Tâche à reprendre depuis le calendrier";
    const created = await page.request.post("/api/entries", {
      headers: { "X-CSRF-Token": before.csrf, "Idempotency-Key": randomUUID() },
      data: {
        description: marker, task_id: "task-plans", project_id: "project-cedres",
        start: new Date(zoneInstant(yesterday + "T16:50")).toISOString(),
        end: new Date(zoneInstant(yesterday + "T17:50")).toISOString(),
        confirmOverlap: true,
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { entry }: { entry: Entry } = await created.json();

    await page.getByRole("button", { name: "Calendrier", exact: true }).click();
    await page.getByLabel("Jours affichés").selectOption("7");
    await page.getByLabel("Zoom du calendrier").selectOption("75");
    if (new Date(`${yesterday}T12:00:00Z`).getUTCDay() === 0) {
      await page.getByRole("button", { name: "Semaine précédente", exact: true }).click();
    }
    const resume = page.getByRole("button", { name: new RegExp(`^Relancer le chrono · ${marker}`) });
    const edit = page.getByRole("button", { name: new RegExp(`^Modifier ce temps · ${marker}`) });
    const stop = page.getByRole("button", { name: "Arrêter le chrono", exact: true });
    const editor = page.getByRole("dialog", { name: "Modifier le temps", exact: true });
    await edit.click();
    await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(marker);
    await editor.getByRole("button", { name: "Fermer", exact: true }).click();
    await expect(stop).toHaveCount(0);

    await expect(resume).toBeVisible();
    await resume.click();
    await expect(stop).toBeVisible();
    await expect(page.locator(".timer-actions")).toContainText("Plans d’exécution · Résidence Les Cèdres");
    const resumed = (await snapshot()).entries.find((item) => item.user_id === before.me.id && item.end === null);
    expect(resumed).toMatchObject({ description: marker, task_id: entry.task_id, project_id: entry.project_id });
    expect(resumed?.id).not.toBe(entry.id);
    expect(resumed?.start).toBeGreaterThan(entry.end!);
    await resume.click();
    await expect(page.getByText("Le chrono de cette tâche est déjà en cours.")).toBeVisible();
    expect((await snapshot()).entries.find((item) => item.user_id === before.me.id && item.end === null)).toEqual(resumed);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Jour précédent", exact: true }).tap();
    await expect(resume).toBeVisible();
    expect((await resume.boundingBox())?.width).toBeGreaterThanOrEqual(44);
    await edit.tap();
    await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(marker);
    await editor.getByRole("button", { name: "Fermer", exact: true }).tap();
    expect((await snapshot()).entries.find((item) => item.id === resumed?.id)).toEqual(resumed);

    await page.getByLabel("Zoom du calendrier").selectOption("100");
    const switchTo = page.getByRole("button", { name: /^Relancer le chrono · Échange avec l’architecte/ });
    await switchTo.tap();
    await expect(page.locator(".timer-actions")).toContainText("Coordination technique");
    const after = await snapshot();
    const active = after.entries.filter((item) => item.user_id === before.me.id && item.end === null);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ task_id: "task-coordination" });
    expect(after.entries.find((item) => item.id === resumed?.id)?.end).toBe(active[0].start);
    expect(after.entries.find((item) => item.id === entry.id)).toEqual(entry);
    await stop.tap();
    await expect(stop).toHaveCount(0);
  });

  test("Le bouton de reprise apparaît seulement dans un bloc assez grand", async ({ page }) => {
    await page.goto("/#timer");
    await page.getByRole("button", { name: /Alex Martin/ }).click();
    const before: Snapshot = await (await page.request.get("/api/state")).json();
    const yesterday = shiftDay(dayKey(before.serverNow), -1);
    const slots = [
      { label: "Appel éclair", time: "16:05:01", end: "16:05:07", task: "task-plans" },
      { label: "Message éclair", time: "16:05:15", end: "16:05:18", task: "task-coordination" },
      { label: "Note à classer", time: "16:06:00", end: "16:06:03", task: null },
      { label: "Vérification isolée", time: "16:12:00", end: "16:12:05", task: "task-plans" },
      { label: "Revue courte", time: "16:20:00", end: "16:40:00", task: "task-plans" },
      { label: "Créneau voisin", time: "12:10:00", end: "13:05:00", task: "task-coordination" },
      { label: "Vérification superposée", time: "12:15:00", end: "12:15:08", task: "task-plans" },
    ];
    for (const slot of slots) {
      const response = await page.request.post("/api/entries", {
        headers: { "X-CSRF-Token": before.csrf, "Idempotency-Key": randomUUID() },
        data: {
          description: slot.label, task_id: slot.task, project_id: slot.task ? "project-cedres" : null,
          start: new Date(zoneInstant(`${yesterday}T${slot.time}`)).toISOString(),
          end: new Date(zoneInstant(`${yesterday}T${slot.end}`)).toISOString(),
          confirmOverlap: true,
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    }

    await page.getByRole("button", { name: "Calendrier", exact: true }).click();
    await page.getByLabel("Jours affichés").selectOption("7");
    await page.getByLabel("Zoom du calendrier").selectOption("75");
    if (new Date(`${yesterday}T12:00:00Z`).getUTCDay() === 0) {
      await page.getByRole("button", { name: "Semaine précédente", exact: true }).click();
    }
    const resumeLong = page.getByRole("button", { name: /^Relancer le chrono · Créneau voisin/ });
    const column = page.locator(".calendar-day").filter({ has: resumeLong });
    const block = column.locator(".calendar-block").filter({ has: resumeLong });
    await expect(block).toBeVisible();
    expect((await column.boundingBox())!.width - (await block.boundingBox())!.width).toBeLessThan(8);
    const isolated = column.getByRole("button", { name: /^Modifier ce temps · Vérification isolée/ });
    await expect(isolated).toBeVisible();
    expect((await column.boundingBox())!.width - (await isolated.boundingBox())!.width).toBeLessThan(4);
    await expect(column.getByRole("button", { name: /^Relancer le chrono · Appel éclair/ })).toHaveCount(0);
    const editShort = page.getByRole("button", { name: /^Modifier ce temps · Revue courte/ });
    const resumeShort = page.getByRole("button", { name: /^Relancer le chrono · Revue courte/ });
    await expect(editShort.getByText("Revue courte", { exact: true })).toBeVisible();
    await expect(resumeShort).toHaveCount(0);

    const editor = page.getByRole("dialog", { name: "Modifier le temps", exact: true });
    for (const label of ["Appel éclair", "Message éclair"]) {
      await column.getByRole("button", { name: new RegExp(`^Modifier ce temps · ${label}`) }).click();
      await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(label);
      await editor.getByRole("button", { name: "Fermer", exact: true }).click();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Jour précédent", exact: true }).tap();
    await expect(resumeLong).toBeVisible();
    await expect(resumeShort).toHaveCount(0);
    await editShort.tap();
    await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Revue courte");
    await editor.getByRole("button", { name: "Fermer", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Arrêter le chrono", exact: true })).toHaveCount(0);
  });
});

test("Time editor: calendar deletion preserves a cancelled draft and supports undo", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Alex Martin/ }).click();
  await page.getByRole("button", { name: "Mon temps", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter du temps", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "Ajouter du temps", exact: true });
  await expect(creation.getByRole("button", { name: "Supprimer ce temps", exact: true })).toHaveCount(0);
  await creation.getByRole("button", { name: "Fermer", exact: true }).click();

  const snapshot = await (await page.request.get("/api/state")).json();
  const marker = "Suppression calendrier " + Date.now();
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(snapshot.serverNow);
  const monday = new Date(today + "T10:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7);
  const created = await page.request.post("/api/entries", {
    headers: { "X-CSRF-Token": snapshot.csrf, "Idempotency-Key": randomUUID() },
    data: {
      description: marker, task_id: null, project_id: null,
      start: monday.toISOString(), end: new Date(+monday + 3600000).toISOString(),
      confirmOverlap: true,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { entry } = await created.json();
  await page.getByRole("button", { name: "Calendrier", exact: true }).click();
  await page.getByRole("button", { name: "Semaine précédente", exact: true }).click();
  const calendarEntry = page.locator(".calendar-entry").filter({ hasText: marker });
  await calendarEntry.click();
  const editor = page.getByRole("dialog", { name: "Modifier le temps", exact: true });
  const remove = editor.getByRole("button", { name: "Supprimer ce temps", exact: true });
  await editor.getByLabel("Description", { exact: true }).fill(marker + " brouillon");
  await editor.getByLabel("Heure de début", { exact: true }).fill("08:45");
  await remove.click();
  const confirmation = page.getByRole("dialog", { name: "Supprimer ce temps ?", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(marker + " brouillon");
  await expect(editor.getByLabel("Heure de début", { exact: true })).toHaveValue("08:45");
  await expect(editor.getByRole("status")).toContainText("Enregistré");
  const afterCancel = (await (await page.request.get("/api/state")).json()).entries.find((e: Entry) => e.id === entry.id);
  expect(afterCancel.description).toBe(marker + " brouillon");

  await page.setViewportSize({ width: 390, height: 844 });
  await remove.scrollIntoViewIfNeeded();
  await expect(remove).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("suppression-temps-mobile.png") });
  await remove.click();
  const deleted = page.waitForResponse(response => response.url().endsWith(`/api/entries/${entry.id}`) && response.request().method() === "DELETE");
  await confirmation.getByRole("button", { name: "Supprimer", exact: true }).click();
  const deleteResponse = await deleted;
  expect(deleteResponse.status()).toBe(200);
  expect(deleteResponse.request().postDataJSON()).toEqual({ version: afterCancel.version });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(calendarEntry).toHaveCount(0);
  const afterDelete = await (await page.request.get("/api/state")).json();
  expect(afterDelete.entries.some((e: { id: string }) => e.id === entry.id)).toBe(false);
  const deletedHistory = await (await page.request.get(`/api/entries/${entry.id}/history`)).json();
  expect(deletedHistory.items.length).toBeGreaterThan(2);
  expect(deletedHistory.items[0]).toMatchObject({ action: "delete", before: { description: afterCancel.description }, after: { deleted: 1 } });
  await page.getByRole("button", { name: "Rétablir", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(calendarEntry).toBeVisible();
  const restored = (await (await page.request.get("/api/state")).json()).entries.find((e: { id: string }) => e.id === entry.id);
  expect(restored).toMatchObject({
    id: entry.id, description: afterCancel.description, start: afterCancel.start, end: entry.end,
    user_id: entry.user_id, task_id: entry.task_id, project_id: entry.project_id,
    version: afterCancel.version + 2,
  });
  const restoredHistory = await (await page.request.get(`/api/entries/${entry.id}/history`)).json();
  expect(restoredHistory.items.map((item: { action: string }) => item.action)).toEqual(["restore", ...deletedHistory.items.map((item: { action: string }) => item.action)]);
});

test("Time editor: running and concurrently changed entries cannot be deleted", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Alex Martin/ }).click();
  await page.getByRole("button", { name: "Mon temps", exact: true }).click();
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  const stop = page.getByRole("button", { name: "Arrêter le chrono", exact: true });
  if (await stop.isVisible()) await stop.click();
  const marker = "Suppression protégée " + Date.now();
  await page.getByRole("textbox", { name: "Description du chrono", exact: true }).fill(marker);
  await page.getByRole("button", { name: "Démarrer", exact: true }).click();
  await expect(stop).toBeVisible();
  await page.getByRole("button", { name: marker, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Modifier le temps", exact: true });
  const remove = editor.getByRole("button", { name: "Supprimer ce temps", exact: true });
  await expect(remove).toBeDisabled();
  await expect(editor.getByText("Arrêtez le chrono avant de supprimer ce temps.", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Fermer", exact: true }).click();
  await stop.click();
  await expect(stop).toHaveCount(0);
  const snapshot = await (await page.request.get("/api/state")).json();
  const entry = snapshot.entries.find((e: { description: string }) => e.description === marker);
  expect(entry.end).not.toBeNull();
  await page.getByRole("button", { name: marker, exact: true }).click();
  await expect(remove).toBeEnabled();
  await remove.click();
  const confirmation = page.getByRole("dialog", { name: "Supprimer ce temps ?", exact: true });
  const entryPath = `/api/entries/${entry.id}`;
  // A second session edits after confirmation starts but before DELETE reaches the server.
  await page.route("**" + entryPath, async route => {
    if (route.request().method() === "DELETE") {
      const updated = await page.request.patch(entryPath, {
        headers: { "X-CSRF-Token": snapshot.csrf, "Idempotency-Key": randomUUID() },
        data: {
          version: entry.version, description: marker + " autre session",
          task_id: entry.task_id, project_id: entry.project_id,
          start: new Date(entry.start).toISOString(), end: new Date(entry.end).toISOString(),
          confirmOverlap: true,
        },
      });
      expect(updated.ok(), await updated.text()).toBeTruthy();
    }
    await route.continue();
  });
  const rejected = page.waitForResponse(response => response.url().endsWith(entryPath) && response.request().method() === "DELETE");
  await confirmation.getByRole("button", { name: "Supprimer", exact: true }).click();
  const rejection = await rejected;
  expect(rejection.status()).toBe(409);
  expect((await rejection.json()).error).toBe("version_conflict");
  await page.unroute("**" + entryPath);
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("alert")).toContainText("changé");
  const afterConflict = (await (await page.request.get("/api/state")).json()).entries.find((e: { id: string }) => e.id === entry.id);
  expect(afterConflict).toMatchObject({ description: marker + " autre session", version: entry.version + 1 });
  await confirmation.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(marker + " autre session");
  await editor.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.getByRole("button", { name: marker + " autre session", exact: true })).toBeVisible();
});
