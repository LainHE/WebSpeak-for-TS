import { computed, type Ref } from "vue";
import { combineTeamSpeakTarget, splitTeamSpeakTarget } from "../../services/teamspeak-target.js";
import { copy, DEFAULT_WELCOME_TEXTS, welcomeLanguageOptions, welcomeTextFieldByLanguage } from "../../modules/admin/translations.js";
import type { ProbeState, RelayNodeForm, WelcomeLanguage } from "./context.js";
import type { ApiError } from "./api.js";

export function setupAdminServerSettings(vc: any): void {
  const serverForm = vc.serverForm as Record<string, any>;
  const welcomeLanguage = vc.welcomeLanguage as Ref<WelcomeLanguage>;
  const selectedWelcomeText = computed<string>({
    get: () => serverForm[welcomeTextFieldByLanguage[welcomeLanguage.value]],
    set: (value: string) => { serverForm[welcomeTextFieldByLanguage[welcomeLanguage.value]] = value; },
  });
  const selectedWelcomeLanguageLabel = computed(() => welcomeLanguageOptions.find((option) => option.value === welcomeLanguage.value)?.label ?? "");
  const selectedWelcomeDefault = computed(() => serverForm.welcomeDefaults[welcomeLanguage.value] || DEFAULT_WELCOME_TEXTS[welcomeLanguage.value]);
  const testResultTitle = computed(() => {
    const result = vc.testResult.value;
    if (!result) return "";
    if (result.ok) return result.checkType === "network" ? vc.tr("networkReachable") : vc.tr("connectionReady");
    const names: Record<string, keyof typeof copy.zh> = {
      INVALID_TARGET: "serverAddress",
      INVALID_NICKNAME: "invalidNicknameError",
      HOST_NOT_FOUND: "hostNotFoundError",
      UNREACHABLE: "networkUnreachableError",
      CONNECTION_REFUSED: "connectionRefusedError",
      CONNECTION_RESET: "connectionResetError",
      TIMEOUT: "networkTimeoutError",
      PASSWORD_REQUIRED: "serverPasswordRequiredError",
      INVALID_PASSWORD: "invalidServerPasswordError",
      PROTOCOL_NEGOTIATION_FAILED: "protocolFailureError",
      SERVER_REJECTED: "serverRejectedError",
      PING_UNAVAILABLE: "pingUnavailableError",
    };
    return vc.tr(names[result.code ?? result.errorCode ?? ""] ?? "connectionFailed");
  });
  const testResultText = computed(() => { if (!vc.testResult.value) return ""; const result = vc.testResult.value; const toolUnavailable = result.errorCode === "PING_UNAVAILABLE"; const loss = toolUnavailable || result.packetLossPercent == null ? null : `${vc.tr('packetLoss')} ${result.packetLossPercent}%`; if (!result.ok) return [vc.connectionFailureText(result.code ?? result.errorCode), loss].filter(Boolean).join(" · "); if (result.checkType === "network") return [vc.tr("networkReachableHint"), result.latencyMs == null ? null : `${result.latencyMs} ms`, loss].filter(Boolean).join(" · "); return [result.serverName, result.latencyMs == null ? null : `${result.latencyMs} ms`, loss].filter(Boolean).join(" · "); });
  const webrtcPortRangeText = computed(() => `${serverForm.webRtcUdpStart}–${serverForm.webRtcUdpEnd}`);
  function mapRelayNodes(value: unknown): RelayNodeForm[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: any) => {
      if (!item || typeof item !== "object") return [];
      const node = item as { id?: unknown; name?: unknown; enabled?: unknown; target?: unknown; hasToken?: unknown };
      if (typeof node.id !== "string" || typeof node.name !== "string" || typeof node.target !== "string") return [];
      return [{ id: node.id, name: node.name, enabled: node.enabled === true, target: node.target, token: "", tokenAction: "keep" as const, hasToken: node.hasToken === true }];
    });
  }
  function createRelayNode(): RelayNodeForm { return { id: `relay-new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: "", enabled: false, target: "", token: "", tokenAction: "replace", hasToken: false }; }
  function addRelayNode() { serverForm.relayNodes.push(createRelayNode()); serverForm.relaySettingsTouched = true; }
  function removeRelayNode(index: number) { serverForm.relayNodes.splice(index, 1); serverForm.relaySettingsTouched = true; }
  async function loadServerSettings() { const value = await vc.getJson("/api/admin/server"); const target = splitTeamSpeakTarget(value.target); Object.assign(serverForm, value, { address: target.address, port: target.port, serverPassword: "", passwordAction: "keep", welcomeTextDe: String(value.welcomeTextDe || ""), welcomeTextRu: String(value.welcomeTextRu || ""), welcomeTextJa: String(value.welcomeTextJa || ""), welcomeDefaults: { ...DEFAULT_WELCOME_TEXTS, ...(value.welcomeDefaults && typeof value.welcomeDefaults === "object" ? value.welcomeDefaults : {}) }, webRtcEnabled: value.webRtcEnabled === true, webRtcUdpStart: Number(value.webRtcUdpStart || 40000), webRtcUdpEnd: Number(value.webRtcUdpEnd || 40099), relayConfigured: value.relayConfigured === true, relayEnabled: value.relayEnabled === true, relayName: String(value.relayName || ""), relayTarget: String(value.relayTarget || ""), relayToken: "", relayTokenAction: "keep", hasRelayToken: value.hasRelayToken === true, relaySettingsTouched: false, relayNodes: mapRelayNodes(value.relayNodes) }); }
  async function saveServerSettings() { vc.submitting.value = true; vc.errorMessage.value = ""; try { const result = await vc.sendJson("/api/admin/server", "PUT", serverPayload()); const target = splitTeamSpeakTarget(result.settings?.target); Object.assign(serverForm, result.settings, { address: target.address, port: target.port, serverPassword: "", passwordAction: "keep", welcomeTextDe: String(result.settings.welcomeTextDe || ""), welcomeTextRu: String(result.settings.welcomeTextRu || ""), welcomeTextJa: String(result.settings.welcomeTextJa || ""), welcomeDefaults: { ...DEFAULT_WELCOME_TEXTS, ...(result.settings.welcomeDefaults && typeof result.settings.welcomeDefaults === "object" ? result.settings.welcomeDefaults : {}) }, webRtcEnabled: result.settings.webRtcEnabled === true, webRtcUdpStart: Number(result.settings.webRtcUdpStart || 40000), webRtcUdpEnd: Number(result.settings.webRtcUdpEnd || 40099), relayConfigured: result.settings.relayConfigured === true, relayEnabled: result.settings.relayEnabled === true, relayName: String(result.settings.relayName || ""), relayTarget: String(result.settings.relayTarget || ""), relayToken: "", relayTokenAction: "keep", hasRelayToken: result.settings.hasRelayToken === true, relaySettingsTouched: false, relayNodes: mapRelayNodes(result.settings.relayNodes) }); await vc.loadOverview(); } catch (error) { vc.errorMessage.value = vc.errorText((error as ApiError).code); } finally { vc.submitting.value = false; } }
  function handleWebRtcToggle() { if (serverForm.webRtcEnabled) vc.webrtcPortNoticeOpen.value = true; }
  async function testServerConnection() { await runTest("/api/admin/server/test", { target: combineTeamSpeakTarget(serverForm.address, serverForm.port), serverPassword: serverForm.passwordAction === "replace" ? serverForm.serverPassword : undefined, passwordAction: serverForm.passwordAction }); if (vc.testResult.value) { await vc.loadOverview(); serverForm.lastTestAt = new Date().toISOString(); serverForm.lastTestLatencyMs = vc.testResult.value.ok ? (vc.testResult.value.latencyMs ?? null) : null; } }
  function touchRelaySettings() { serverForm.relaySettingsTouched = true; }
  function serverPayload() { return { target: combineTeamSpeakTarget(serverForm.address, serverForm.port), serverPassword: serverForm.passwordAction === "replace" ? serverForm.serverPassword : undefined, passwordAction: serverForm.passwordAction, accessMode: serverForm.accessMode, siteName: serverForm.siteName, welcomeText: serverForm.welcomeText, welcomeTextEn: serverForm.welcomeTextEn, welcomeTextDe: serverForm.welcomeTextDe, welcomeTextRu: serverForm.welcomeTextRu, welcomeTextJa: serverForm.welcomeTextJa, webRtcEnabled: serverForm.webRtcEnabled, webRtcUdpStart: serverForm.webRtcUdpStart, webRtcUdpEnd: serverForm.webRtcUdpEnd, relayNodes: serverForm.relayNodes.map((node: RelayNodeForm) => ({ id: node.id, name: node.name, target: node.target, enabled: node.enabled, tokenAction: node.tokenAction, ...(node.tokenAction === "replace" ? { token: node.token } : {}) })) }; }
  async function runTest(url: string, body: Record<string, unknown>) { vc.testing.value = true; vc.errorMessage.value = ""; vc.testResult.value = null; try { vc.testResult.value = await vc.sendJson(url, "POST", body, url.includes("/server/test")); } catch (error) { vc.testResult.value = { ok: false, code: (error as ApiError).code }; } finally { vc.testing.value = false; } }
  vc.selectedWelcomeText = selectedWelcomeText;
  vc.selectedWelcomeLanguageLabel = selectedWelcomeLanguageLabel;
  vc.selectedWelcomeDefault = selectedWelcomeDefault;
  vc.testResultTitle = testResultTitle;
  vc.testResultText = testResultText;
  vc.webrtcPortRangeText = webrtcPortRangeText;
  vc.mapRelayNodes = mapRelayNodes;
  vc.createRelayNode = createRelayNode;
  vc.addRelayNode = addRelayNode;
  vc.removeRelayNode = removeRelayNode;
  vc.loadServerSettings = loadServerSettings;
  vc.saveServerSettings = saveServerSettings;
  vc.handleWebRtcToggle = handleWebRtcToggle;
  vc.testServerConnection = testServerConnection;
  vc.touchRelaySettings = touchRelaySettings;
  vc.serverPayload = serverPayload;
  vc.runTest = runTest;
  vc.welcomeLanguageOptions = welcomeLanguageOptions;
}
