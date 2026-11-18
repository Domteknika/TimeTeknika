import { test, expect } from "@playwright/test";
import { dayKey, prettyDay, shiftDay } from "../../src/lib/time";

test("L’objectif hebdomadaire accepte 32.8 heures", async ({ page }) => {
  await page.goto("/#settings");
  await page.getByRole("button", { name: /Alex Martin/ }).click();
  const target = page.getByLabel("Objectif hebdomadaire (heures)", { exact: true });
  await target.fill("32.8");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("Préférences enregistrées.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(target).toHaveValue("32.8");
  await page.getByRole("button", { name: "Mon temps", exact: true }).click();
  await expect(page.getByLabel("Résumé de mon temps")).toContainText("/ 32:48");
});

test("Le menu du chrono permet de créer et sélectionner une tâche", async ({ page }) => {
  await page.goto("/#timer");
  await page.getByRole("button", { name: /Emma Laurent/ }).click();
  const description = page.getByRole("textbox", { name: "Description du chrono" });
  await description.fill("Activité en cours");
  await page.getByRole("button", { name: "Démarrer", exact: true }).click();
  const stop = page.getByRole("button", { name: "Arrêter le chrono", exact: true });
  await expect(stop).toBeVisible();
  const snapshot = async () => (await page.request.get("/api/state")).json();
  const before = await snapshot();
  const running = before.entries.find((entry: { end: number | null }) => entry.end === null);
  const project = before.projects.find((item: { archived: boolean }) => !item.archived);
  const taskName = "Tâche créée depuis le chrono";
  await description.fill("Activité suivante");
  const projectChoice = page.getByRole("combobox", { name: "Projet", exact: true });
  await projectChoice.click();
  await page.getByRole("option", { name: project.name }).click();
  const task = page.getByRole("combobox", { name: "Tâche", exact: true });
  await task.click();
  await page.getByRole("button", { name: "Créer une tâche", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Créer une tâche", exact: true });
  await expect(editor.getByRole("combobox", { name: "Projet de la tâche" })).toContainText(project.name);
  await editor.getByLabel("Nom", { exact: true }).fill(taskName);
  await editor.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(task).toContainText(taskName);
  await expect(description).toHaveValue("Activité suivante");
  const after = await snapshot();
  expect(after.entries.find((entry: { id: string }) => entry.id === running.id)).toEqual(running);
  const created = after.tasks.find((item: { name: string }) => item.name === taskName);
  expect(created).toMatchObject({ project_id: project.id, assignees: [after.me.id] });
  await page.getByRole("button", { name: "Basculer sur cette activité", exact: true }).click();
  await expect.poll(async () => (await snapshot()).entries.find((entry: { end: number | null }) => entry.end === null)?.task_id).toBe(created.id);
  await stop.click();
  await expect(stop).toHaveCount(0);
});

test.describe("Calendrier mobile", () => {
  test.use({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });

  test("Affiche aujourd’hui, puis permet de naviguer jour par jour", async ({ page }, testInfo) => {
    await page.goto("/#timer");
    await page.getByRole("button", { name: /Alex Martin/ }).tap();
    await page.getByRole("button", { name: "Calendrier", exact: true }).tap();
    const { serverNow } = await (await page.request.get("/api/state")).json();
    const today = dayKey(serverNow);
    const previous = page.getByRole("button", { name: "Jour précédent", exact: true });
    const next = page.getByRole("button", { name: "Jour suivant", exact: true });
    const day = page.locator(".calendar-day");
    await expect(day).toHaveCount(1);
    await expect(day).toHaveClass(/\btoday\b/);
    await expect(page.getByText(prettyDay(today), { exact: true })).toBeVisible();
    await expect(page.getByLabel("Jours affichés")).toHaveCount(0);
    expect(await page.locator(".calendar-scroll").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.locator(".calendar-grid").screenshot({ path: testInfo.outputPath("calendrier-mobile.png") });
    await previous.tap();
    await expect(page.getByText(prettyDay(shiftDay(today, -1)), { exact: true })).toBeVisible();
    await next.tap();
    await expect(day).toHaveClass(/\btoday\b/);
    await next.tap();
    const tomorrow = shiftDay(today, 1);
    await expect(page.getByText(prettyDay(tomorrow), { exact: true })).toBeVisible();
    await day.tap({ position: { x: 16, y: 80 } });
    const editor = page.getByRole("dialog", { name: "Ajouter du temps", exact: true });
    await expect(editor.getByLabel("Date de début", { exact: true })).toHaveValue(tomorrow);
    await editor.getByRole("button", { name: "Annuler", exact: true }).tap();
    await page.getByRole("button", { name: "Aujourd’hui", exact: true }).tap();
    await expect(day).toHaveClass(/\btoday\b/);
    await page.setViewportSize({ width: 800, height: 360 });
    await expect(day).toHaveCount(1);
    await expect(previous).toBeVisible();
  });
});

test("React workspace: timer, catalog, exports, calendar, mobile and permissions", async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#timer");
  await page.getByRole("button", { name: /Alex Martin/ }).click();
  await expect(
    page.getByRole("heading", { name: "Votre temps, en perspective." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  const existingStop = page.getByRole("button", {
    name: "Arrêter le chrono",
    exact: true,
  });
  if (await existingStop.isVisible()) await existingStop.click();
  const marker = "Recette React " + Date.now();
  const timerInput = page.getByRole("textbox", {
    name: "Description du chrono",
  });
  await timerInput.fill(marker);
  await page.getByRole("button", { name: "Démarrer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Arrêter le chrono", exact: true }),
  ).toBeVisible();
  const favicon = page.locator('link[rel="icon"]');
  await expect(favicon).toHaveAttribute("href", "/favicon-active.svg");
  const iconChanges = await page.evaluate(() => new Promise<number>(resolve => {
    let changes = 0;
    const observer = new MutationObserver(records => { changes += records.length; });
    observer.observe(document.querySelector('link[rel="icon"]')!, {attributes:true, attributeFilter:["href"]});
    setTimeout(() => { observer.disconnect(); resolve(changes); }, 2200);
  }));
  expect(iconChanges).toBe(0);
  await expect(favicon).toHaveAttribute("href", "/favicon-active.svg");

  await page
    .getByRole("button", { name: "Arrêter le chrono", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Démarrer", exact: true }),
  ).toBeVisible();
  await expect(favicon).toHaveAttribute("href", "/favicon.svg");
  await page.waitForTimeout(1200);
  await expect(favicon).toHaveAttribute("href", "/favicon.svg");
  const originalTimes = (await (await page.request.get("/api/state")).json()).entries.find((e: {description: string}) => e.description === marker);
  await expect(
    page.getByRole("button", { name: marker, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: marker, exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Modifier le temps" }),
  ).toBeVisible();
  await expect(page.getByLabel("Date de début", {exact:true})).toBeVisible();
  await expect(page.getByLabel("Heure de début", {exact:true})).toBeVisible();
  await page.getByLabel("Afficher les secondes", {exact:true}).check();
  await expect(page.getByLabel("Heure de début", {exact:true})).toHaveValue(/[0-9]{2}:[0-9]{2}(:[0-9]{2})?/);
  await page.getByLabel("Afficher les secondes", {exact:true}).uncheck();
  await page.getByRole("combobox", {name:"Projet", exact:true}).click();
  await page.getByRole("textbox", {name:"Rechercher Projet", exact:true}).fill("Introuvable fictif");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", {name:"Rechercher Projet", exact:true})).toHaveCount(0);
  await page.screenshot({path: testInfo.outputPath("editeur-temps.png")});
  await page
    .getByLabel("Description", { exact: true })
    .fill(marker + " modifié");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: marker + " modifié", exact: true }),
  ).toBeVisible();
  const savedTimes = (await (await page.request.get("/api/state")).json()).entries.find((e: {id:string}) => e.id === originalTimes.id);
  expect([savedTimes.start, savedTimes.end]).toEqual([originalTimes.start, originalTimes.end]);
  await page.getByRole("button", { name: "Calendrier", exact: true }).click();
  await expect(page.getByLabel("Jours affichés")).toBeVisible();
  await page.getByLabel("Jours affichés").selectOption("7");
  await expect(page.locator(".calendar-day-head")).toHaveCount(7);
  await page.getByLabel("Plage horaire").selectOption("extended");
  await expect(page.locator(".calendar-hours span").first()).toHaveText("8:00");
  await expect(page.locator(".calendar-hours span").last()).toHaveText("19:00");
  await expect(page.locator(".calendar-hours span")).toHaveCount(12);
  await expect.poll(async () => (await (await page.request.get("/api/state")).json()).me.preferences.calendarRange).toBe("extended");
  await page.screenshot({
    path: testInfo.outputPath("calendrier.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Clients", exact: true })
    .click();
  await page.getByRole("button", { name: "Nouveau client" }).click();
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill(marker);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Rechercher dans le catalogue" })
    .fill(marker);
  await expect(page.getByRole("row").filter({ hasText: marker })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Projets", exact: true })
    .click();
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page
    .getByRole("textbox", { name: "Nom", exact: true })
    .fill(marker + " projet");
  await page.getByRole("combobox", { name: "Client du projet" }).click();
  await page.getByRole("option", { name: marker, exact: true }).click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Tâches", exact: true })
    .click();
  await page.getByRole("button", { name: "Nouvelle tâche" }).click();
  await page
    .getByRole("textbox", { name: "Nom", exact: true })
    .fill(marker + " tâche");
  await page.getByRole("combobox", { name: "Projet de la tâche" }).click();
  await page
    .getByRole("option", { name: marker + " projet", exact: true })
    .click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Rechercher dans le catalogue" })
    .fill(marker);
  await expect(
    page.getByRole("row").filter({ hasText: marker + " tâche" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("button", { name: "Rapports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Le recul pour mieux avancer." }),
  ).toBeVisible();
  await expect(
    page.getByText("Calculé en Europe/Zurich", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Camembert", exact: true }).click();
  await expect
    .poll(() => page.locator(".recharts-pie-sector").count())
    .toBeGreaterThan(0);
  await page.screenshot({
    path: testInfo.outputPath("rapports.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Exporter les temps", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Des relevés prêts à partager." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "CSV", exact: true }),
  ).toBeEnabled();
  for (const name of ["CSV", "Excel", "PDF"]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    const file = await download;
    expect(await file.failure()).toBeNull();
  }
  await page.getByRole("button", { name: "Enregistrer un modèle" }).click();
  await page
    .getByRole("textbox", { name: "Nom du modèle" })
    .fill(marker + " modèle");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Mon profil", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Les personnes de l’équipe" }),
  ).toBeVisible();
  const emmaRow = page.getByRole("row").filter({ hasText: "Emma Laurent" });
  await emmaRow.getByRole("button", { name: "Modifier l’identifiant de Emma Laurent", exact: true }).click();
  await page.getByLabel("Nouvel identifiant", { exact: true }).fill("emma.updated");
  await page.getByRole("button", { name: "Enregistrer l’identifiant", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(emmaRow).toContainText("emma.updated");
  const alexRow = page.getByRole("row").filter({ hasText: "Alex Martin" });
  await expect(alexRow.getByRole("button", { name: "Supprimer l’utilisateur Alex Martin", exact: true })).toHaveCount(0);

  await expect(alexRow).toContainText("Administrateur");
  await alexRow.getByRole("button", { name: "Modifier le rôle de Alex Martin", exact: true }).click();
  await page.getByLabel("Nouveau rôle", { exact: true }).selectOption("manager");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Il faut conserver au moins un administrateur actif.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await emmaRow.getByRole("button", { name: "Modifier le rôle de Emma Laurent", exact: true }).click();
  await page.getByLabel("Nouveau rôle", { exact: true }).selectOption("admin");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(emmaRow).toContainText("Administrateur");
  await emmaRow.getByRole("button", { name: "Modifier le rôle de Emma Laurent", exact: true }).click();
  await page.getByLabel("Nouveau rôle", { exact: true }).selectOption("member");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const lucasRow = page.getByRole("row").filter({ hasText: "Lucas Morel" });
  await lucasRow.getByRole("button", { name: "Supprimer l’utilisateur Lucas Morel", exact: true }).click();
  await page.getByLabel("Identifiant de confirmation", { exact: true }).fill("lucas@demo.local");
  await page.getByRole("button", { name: "Supprimer l’accès", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(lucasRow).toHaveCount(0);
  await page.getByRole("button", { name: "Afficher les comptes retirés", exact: true }).click();
  await expect(lucasRow).toContainText("Accès retiré");
  await expect(lucasRow.getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "Consulter le journal" }).click();
  await page
    .getByRole("button", { name: "Vérifier l’intégrité", exact: true })
    .click();
  await expect(
    page.getByText("Intégrité vérifiée", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("button", { name: "Mon temps", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Votre temps, en perspective." }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Liste", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("mon-temps.png"),
    fullPage: true,
  });
  const memberContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const member = await memberContext.newPage();
  await member.goto("/");
  await member.getByRole("button", { name: /Emma Laurent/ }).click();
  await expect(
    member.getByRole("heading", { name: "Votre temps, en perspective." }),
  ).toBeVisible();
  await expect(
    member.getByRole("button", { name: marker + " modifié", exact: true }),
  ).toHaveCount(0);
  await member.getByRole("button", { name: "Mon profil", exact: true }).click();
  await expect(
    member.getByRole("button", { name: "Ajouter un membre", exact: true }),
  ).toHaveCount(0);
  await expect(
    member.getByRole("button", { name: "Consulter le journal", exact: true }),
  ).toHaveCount(0);
  await member.getByRole("button", { name: "Mon temps", exact: true }).click();
  await member.getByRole("textbox", {name:"Description du chrono"}).fill("Test icône déconnexion");
  await member.getByRole("button", {name:"Démarrer", exact:true}).click();
  await expect(member.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon-active.svg");
  await member.getByRole("button", {name:"Se déconnecter", exact:true}).click();
  await expect(member.getByRole("button", {name:/Emma Laurent/})).toBeVisible();
  await expect(member.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  await member.waitForTimeout(1200);
  await expect(member.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  await memberContext.close();
  expect(errors).toEqual([]);
});
