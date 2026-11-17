import { test, expect } from "@playwright/test";
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
  await page.getByRole("button", {name:"Enregistrer", exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const entry = (await (await page.request.get("/api/state")).json()).entries.find((e: {description:string}) => e.description === marker);
  expect(entry.start).toBe(Date.parse("2000-01-03T07:15:00Z"));
  expect(entry.end).toBe(Date.parse("2000-01-03T08:45:00Z"));
  expect(entry.task_id).toBe(task.id);
  await fill(marker + " doublon");
  const consent = page.getByRole("checkbox", {name:/Ce créneau chevauche/});
  await expect(consent).not.toBeChecked();
  await page.getByRole("button", {name:"Enregistrer", exact:true}).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("chevauche");
  await consent.check();
  await page.getByRole("button", {name:"Enregistrer", exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
