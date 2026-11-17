export interface Preferences {
  page?: string;
  timerView?: "list" | "calendar";
  taskScope?: "mine" | "all";
  weeklyTargetMinutes?: number | null;
  balanceStartDate?: string;
  reminderHour?: number;
  calendarDays?: number;
  calendarZoom?: number;
  calendarRange?: "full" | "workday" | "extended";
  calendarFit?: boolean;
  reportChart?: "columns" | "line" | "pie" | "bars";
  taskProjects?: Record<string, { pinned?: boolean; collapsed?: boolean }>;
}
export interface Person {
  id: string;
  name: string;
  username: string;
  role: "admin" | "manager" | "member";
  active: number;
  color: string;
  preferences: Preferences;
}
export interface Client {
  id: string;
  name: string;
  version: number;
}
export interface Project extends Client {
  client_id: string;
  color: string;
  description: string;
  archived: number;
}
export interface Task extends Client {
  project_id: string;
  description: string;
  status: "todo" | "doing" | "done";
  archived: number;
  assignees: string[];
}
export interface Entry {
  id: string;
  user_id: string;
  task_id: string | null;
  project_id: string | null;
  description: string;
  start: number;
  end: number | null;
  version: number;
  deleted: number;
}
export interface ExportConfig {
  version: number;
  mode: "detail" | "summary";
  period: { preset: string; from: string; to: string };
  filters: {
    people: string[] | null;
    clients: string[] | null;
    projects: string[] | null;
    tasks: string[] | null;
    query: string;
    classification: string;
    timers: string;
  };
  columns: { key: string; label: string }[];
  groups: string[];
  sort: { key: string; direction: string };
  subtotals: boolean;
  total: boolean;
  excluded: string[];
  document: {
    title: string;
    company: string;
    reference: string;
    note: string;
    orientation: string;
  };
}
export interface Snapshot {
  me: Person;
  users: Person[];
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  entries: Entry[];
  csrf: string;
  serverNow: number;
  revision: number;
  demo: boolean;
  timezone: string;
  exportTemplates: {
    id: string;
    name: string;
    config: ExportConfig;
    version: number;
  }[];
  access?: { url: string; secure: boolean; demo: boolean };
}
export interface Info {
  setup: boolean;
  demo: boolean;
  demoUsers: Person[];
}
export interface ReportRow extends Entry {
  project: string;
  task: string;
  client: string;
  client_id: string | null;
  person: string;
  seconds: number;
}
export interface Report {
  rows: ReportRow[];
  groups: {
    key: string;
    label: string;
    person: string;
    seconds: number;
    completed: number;
    running: number;
    count: number;
  }[];
  days: { date: string; seconds: number }[];
  total: number;
  completed: number;
  running: number;
  unclassified: number;
  asOf: number;
}
