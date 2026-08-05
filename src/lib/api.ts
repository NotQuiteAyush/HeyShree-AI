function packagedBackendBase(): string {
  const configured = new URLSearchParams(window.location.search).get("backendUrl") || "";
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(configured)) {
    throw new Error("The packaged SHREE backend endpoint is missing or invalid.");
  }
  const port = Number(new URL(configured).port);
  if (port < 1 || port > 65535) throw new Error("The packaged SHREE backend port is invalid.");
  return configured;
}

export const API_BASE = window.location.protocol === "file:" ? packagedBackendBase() : "";

function backendAuthorizationHeaders(): Record<string, string> {
  const token = window.shreeDesktop?.backendToken || "";
  return token ? { "X-Shree-Token": token } : {};
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(!isFormData ? { "Content-Type": "application/json" } : {}), ...backendAuthorizationHeaders(), ...(init?.headers || {}) },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = typeof body.detail === "string" ? body.detail : body.detail?.message || JSON.stringify(body.detail);
    } catch {}
    throw new Error(detail);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export async function apiDownload(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, { headers: backendAuthorizationHeaders() });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.blob();
}

export function liveWebSocketUrl(): string {
  const base = window.location.protocol === "file:"
    ? `${API_BASE.replace("http://", "ws://")}/live`
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/live`;
  const url = new URL(base);
  const token = window.shreeDesktop?.backendToken || "";
  if (token) url.searchParams.set("token", token);
  return url.toString();
}
