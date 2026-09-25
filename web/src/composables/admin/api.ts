export interface ApiError extends Error { code?: string }


export function setupAdminApi(vc: any): void {
  async function getJson(url: string): Promise<any> { const response = await fetch(url, { headers: { accept: "application/json" } }); return parseResponse(response); }
  async function sendJson(url: string, method: string, body: unknown, authenticated = true): Promise<any> { const response = await fetch(url, { method, headers: { "content-type": "application/json", accept: "application/json", ...(authenticated && vc.csrfToken.value ? { "x-csrf-token": vc.csrfToken.value } : {}) }, body: JSON.stringify(body) }); return parseResponse(response); }
  async function parseResponse(response: Response) { const value = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(String(value.code || response.statusText)) as ApiError; error.code = String(value.code || "REQUEST_FAILED"); if (response.status === 401 && vc.screen.value === "admin") { vc.screen.value = "login"; void vc.router.replace("/admin/login"); } throw error; } return value; }
  vc.getJson = getJson;
  vc.sendJson = sendJson;
  vc.parseResponse = parseResponse;
}
