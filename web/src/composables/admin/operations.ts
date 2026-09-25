import { copy } from "../../modules/admin/translations.js";
import type { ApiError } from "./api.js";
import type { AdminConnectionRecord, AdminSession, ManagedInvite } from "./context.js";


export function setupAdminOperations(vc: any): void {
  async function loadOperations() { vc.operationsLoading.value = true; try { const [sessions, invites, diagnostics, logs, audit] = await Promise.all([vc.getJson("/api/admin/sessions"), vc.getJson("/api/admin/invites"), vc.getJson("/api/admin/diagnostics"), vc.getJson("/api/admin/logs?limit=100"), vc.getJson("/api/admin/audit?limit=50")]); vc.operations.sessions = Array.isArray(sessions.sessions) ? sessions.sessions : []; vc.operations.invites = Array.isArray(invites.invites) ? invites.invites : []; vc.operations.diagnostics = { version: String(diagnostics.gateway?.version || ""), node: String(diagnostics.gateway?.node || ""), platform: String(diagnostics.gateway?.platform || ""), arch: String(diagnostics.gateway?.arch || ""), schemaVersion: Number(diagnostics.database?.schemaVersion || 0), createdSessions: Number(diagnostics.sessions?.created || 0) }; vc.operations.logs = { available: Boolean(logs.available), entries: Array.isArray(logs.entries) ? logs.entries : [], sessions: Array.isArray(logs.sessions) ? logs.sessions : [] }; vc.operations.audit = Array.isArray(audit.events) ? audit.events : []; } catch (error) { vc.errorMessage.value = vc.errorText((error as ApiError).code); } finally { vc.operationsLoading.value = false; } }
  async function terminateSession(session: AdminSession) { if (!window.confirm(vc.tr('confirmTerminate', { nickname: session.nickname }))) return; vc.terminatingSession.value = session.id; vc.errorMessage.value = ""; try { await vc.sendJson(`/api/admin/sessions/${encodeURIComponent(session.id)}/terminate`, "POST", {}); await Promise.all([loadOperations(), vc.loadOverview()]); } catch (error) { vc.errorMessage.value = vc.errorText((error as ApiError).code); } finally { vc.terminatingSession.value = ""; } }
  async function createInvite() { vc.submitting.value = true; vc.errorMessage.value = ""; vc.createdInvite.value = null; try { const result = await vc.sendJson("/api/admin/invites", "POST", { channel: vc.inviteForm.channel, expiresInHours: vc.inviteForm.expiresInHours, maxUses: vc.inviteForm.maxUses }); if (typeof result.token !== "string") throw new Error("INVITE_CREATE_FAILED"); vc.createdInvite.value = { token: result.token, link: `${location.origin}/?invite=${encodeURIComponent(result.token)}` }; vc.inviteForm.channel = ""; await loadOperations(); } catch (error) { vc.errorMessage.value = vc.errorText((error as ApiError).code); } finally { vc.submitting.value = false; } }
  async function revokeInvite(invite: ManagedInvite) { if (!window.confirm(vc.tr('confirmRevoke'))) return; try { await vc.sendJson(`/api/admin/invites/${encodeURIComponent(invite.id)}/revoke`, "POST", {}); await loadOperations(); } catch (error) { vc.errorMessage.value = vc.errorText((error as ApiError).code); } }
  async function copyInviteLink() { if (!vc.createdInvite.value) return; try { await navigator.clipboard.writeText(vc.createdInvite.value.link); showOperationNotice(vc.tr('copiedLink')); } catch { vc.errorMessage.value = vc.tr('operationFailed'); } }
  function showOperationNotice(message: string) { vc.errorMessage.value = message; window.setTimeout(() => { if (vc.errorMessage.value === message) vc.errorMessage.value = ""; }, 2200); }
  async function downloadBackup() { try { const response = await fetch("/api/admin/backup", { headers: { accept: "application/octet-stream" } }); if (!response.ok) throw new Error("BACKUP_FAILED"); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `webspeak-backup-${new Date().toISOString().slice(0, 10)}.db`; anchor.click(); URL.revokeObjectURL(url); await loadOperations(); } catch (error) { vc.errorMessage.value = vc.errorText((error as ApiError).code); } }
  function connectionStatusLabel(status: AdminConnectionRecord["status"]) { const names: Record<AdminConnectionRecord["status"], keyof typeof copy.zh> = { active: "connectionActive", connecting: "connectionConnecting", disconnected: "connectionDisconnected", failed: "connectionFailed" }; return vc.tr(names[status]); }
  function connectionRoute(record: AdminConnectionRecord) {
    const route = vc.tr("connectionFromTo", { ip: record.clientIp || "—", target: record.target || "—" });
    if (!record.relayName && !record.relayTarget) return route;
    const relay = [record.relayName, record.relayTarget].filter(Boolean).join(" · ") || "—";
    return `${route} · ${vc.tr("connectionViaRelay", { relay })}`;
  }
  function sessionStateLabel(state: string) { const names: Record<string, { zh: string; en: string; de: string }> = { connecting: { zh: "连接中", en: "Connecting", de: "Verbindung wird hergestellt" }, authenticating: { zh: "认证中", en: "Authenticating", de: "Authentifizierung" }, syncing: { zh: "同步中", en: "Syncing", de: "Synchronisierung" }, connected: { zh: "已连接", en: "Connected", de: "Verbunden" }, interrupted: { zh: "已中断", en: "Interrupted", de: "Unterbrochen" }, reconnecting: { zh: "重连中", en: "Reconnecting", de: "Wiederverbindung" }, disconnecting: { zh: "断开中", en: "Disconnecting", de: "Wird getrennt" }, failed: { zh: "失败", en: "Failed", de: "Fehlgeschlagen" }, idle: { zh: "空闲", en: "Idle", de: "Inaktiv" } }; const locale = vc.language.value === "zh" ? "zh" : vc.language.value === "de" ? "de" : "en"; return names[state]?.[locale] ?? state; }
  function inviteStatusLabel(status: ManagedInvite["status"]) { const names: Record<ManagedInvite["status"], keyof typeof copy.zh> = { active: "active", expired: "expired", exhausted: "exhausted", revoked: "revoked" }; return vc.tr(names[status]); }
  function formatContext(context: Record<string, string | number | boolean>) { return Object.entries(context).map(([key, value]) => `${key}=${value}`).join(" · "); }
  vc.loadOperations = loadOperations;
  vc.terminateSession = terminateSession;
  vc.createInvite = createInvite;
  vc.revokeInvite = revokeInvite;
  vc.copyInviteLink = copyInviteLink;
  vc.showOperationNotice = showOperationNotice;
  vc.downloadBackup = downloadBackup;
  vc.connectionStatusLabel = connectionStatusLabel;
  vc.connectionRoute = connectionRoute;
  vc.sessionStateLabel = sessionStateLabel;
  vc.inviteStatusLabel = inviteStatusLabel;
  vc.formatContext = formatContext;
}
