let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "",
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  key: string = crypto.randomUUID(),
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (data !== undefined) headers["Content-Type"] = "application/json";
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (method !== "GET") headers["Idempotency-Key"] = key;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("Serveur injoignable. Vérifiez la connexion.");
  }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      result.message +
        (result.requestId ? " Référence : " + result.requestId : ""),
      response.status,
      result.error,
      result.details,
    );
  }
  return result;
}
export async function downloadExport(config: unknown, format: string) {
  const response = await fetch("/api/exports/download", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ config, format }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message);
  }
  const blob = await response.blob();
  const name =
    /filename="([^"]+)"/.exec(
      response.headers.get("Content-Disposition") ?? "",
    )?.[1] ?? "timeteknika." + format;
  saveBlob(blob, name);
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
