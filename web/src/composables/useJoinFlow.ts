import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import type { ComputedRef, Ref } from "vue";
import { combineTeamSpeakTarget, DEFAULT_TEAM_SPEAK_PORT, isValidTeamSpeakPort, splitTeamSpeakTarget } from "../services/teamspeak-target.js";
import { clearLocalData as clearStoredLocalData, isLocalPersistenceAvailable, listFavorites, listRecentServers, loadStoredIdentity, recordRecentServer, removeFavorite, removeStoredIdentity, saveFavorite, saveLocalPreferences, saveStoredIdentity } from "../services/local-persistence.js";
import type { FavoriteServer, RecentServer } from "../services/local-persistence.js";
import type { ThemeMode } from "../services/theme.js";
import type { TreeChannel } from "./useChannelTree.js";

type VoiceApi = ReturnType<typeof import("./useVoiceWebSocket.js").useVoiceWebSocket>;

export function useJoinFlow(options: {
  voiceState: VoiceApi["state"];
  connect: VoiceApi["connect"];
  disconnect: VoiceApi["disconnect"];
  switchChannel: VoiceApi["switchChannel"];
  clearError: VoiceApi["clearError"];
  identityMaterial: VoiceApi["identityMaterial"];
  playNotification: VoiceApi["playNotification"];
  checkSupport: VoiceApi["checkSupport"];
  t: (key: string, variables?: Record<string, string | number>) => string;
  showToast: (message: string) => void;
  channel: Ref<string>;
  selectedChannelId: Ref<string>;
  channelTree: ComputedRef<TreeChannel[]>;
  themeMode: Ref<ThemeMode>;
  applyTheme: (mode: ThemeMode) => void;
  performancePanelOpen: Ref<boolean>;
  startPerformanceMonitoring: () => void;
  stopPerformanceMonitoring: () => void;
  saveLocalPreferences: typeof saveLocalPreferences;
  recordRecentServer: typeof recordRecentServer;
  listRecentServers: typeof listRecentServers;
  loadStoredIdentity: typeof loadStoredIdentity;
  saveStoredIdentity: typeof saveStoredIdentity;
  removeStoredIdentity: typeof removeStoredIdentity;
  listFavorites: typeof listFavorites;
  saveFavorite: typeof saveFavorite;
  removeFavorite: typeof removeFavorite;
  clearStoredLocalData: typeof clearStoredLocalData;
  isLocalPersistenceAvailable: typeof isLocalPersistenceAvailable;
  welcomeTextZh: Ref<string>;
  welcomeTextEn: Ref<string>;
  welcomeTextDe: Ref<string>;
  welcomeTextRu: Ref<string>;
  welcomeTextJa: Ref<string>;
}) {
  const { voiceState, connect, disconnect, switchChannel, clearError, identityMaterial, playNotification, checkSupport, t, showToast, channel, selectedChannelId, channelTree, themeMode, applyTheme, performancePanelOpen, startPerformanceMonitoring, stopPerformanceMonitoring, saveLocalPreferences, recordRecentServer, listRecentServers, loadStoredIdentity, saveStoredIdentity, removeStoredIdentity, listFavorites, saveFavorite, removeFavorite, clearStoredLocalData, isLocalPersistenceAvailable, welcomeTextZh, welcomeTextEn, welcomeTextDe, welcomeTextRu, welcomeTextJa } = options;

const query = new URLSearchParams(location.search);
const initialChannel = query.get("channel") ?? "";
const inviteToken = query.get("invite") ?? "";
const initialTarget = initialServerTarget();
const nickname = ref(localStorage.getItem("webspeak:nickname") ?? "");
const serverHost = ref(initialTarget.address);
const serverPort = ref(initialTarget.port);
const serverPassword = ref("");
const accessMode = ref<"fixed" | "open">("fixed");
const rememberIdentity = ref(localStorage.getItem("webspeak:remember-identity") !== "0");
const favoriteServers = ref<FavoriteServer[]>([]);
const recentServers = ref<RecentServer[]>([]);
const initialized = ref(false);
const siteName = ref("WebSpeak");
const appVersion = ref("0.2.4");
const visitorNumber = ref<number | null>(null);
const visitorTotal = ref<number | null>(null);
const accelerationRelays = ref<Array<{ id: string; name: string }>>([]);
const accelerationRelayId = ref("");
const accelerationAvailable = computed(() => accelerationRelays.value.length > 0);
const browserError = ref("");
const serverConfigLoading = ref(true);
const channelPasswordDialog = reactive({ open: false, channelId: "", password: "", error: "", submitting: false });
const serverPasswordDialog = reactive({ open: false, password: "", errorCode: "" });
const localPersistenceAvailable = isLocalPersistenceAvailable();
const identityReady = ref(!localPersistenceAvailable);
function initialServerTarget() {
  const explicit = query.get("server") ?? query.get("target");
  if (explicit?.trim()) return splitTeamSpeakTarget(explicit);
  const host = (query.get("tsHost") ?? location.hostname).trim();
  const port = (query.get("tsPort") ?? DEFAULT_TEAM_SPEAK_PORT).trim();
  return splitTeamSpeakTarget(host, port || DEFAULT_TEAM_SPEAK_PORT);
}

watch(() => voiceState.errorCode, (code) => {
  if (code !== "CHANNEL_PASSWORD_REQUIRED" || !selectedChannelId.value) return;
  channelPasswordDialog.open = true;
  channelPasswordDialog.channelId = selectedChannelId.value;
  channelPasswordDialog.password = "";
  channelPasswordDialog.error = t("channelPasswordRetry");
  channelPasswordDialog.submitting = false;
  clearError();
  void nextTick(() => document.getElementById("channel-password-input")?.focus());
});
watch(() => voiceState.errorCode, (code) => {
  if (code !== "SERVER_PASSWORD_REQUIRED" && code !== "INVALID_SERVER_PASSWORD") return;
  serverPasswordDialog.open = true;
  serverPasswordDialog.password = "";
  serverPasswordDialog.errorCode = code;
  clearError();
  void nextTick(() => document.getElementById("retry-server-password-input")?.focus());
});
watch(() => voiceState.channelSwitchedChannelId, (channelId) => {
  if (!channelPasswordDialog.open || !channelId || channelId !== channelPasswordDialog.channelId) return;
  channelPasswordDialog.open = false;
  channelPasswordDialog.channelId = "";
  channelPasswordDialog.password = "";
  channelPasswordDialog.error = "";
  channelPasswordDialog.submitting = false;
});
watch(rememberIdentity, (remember) => {
  localStorage.setItem("webspeak:remember-identity", remember ? "1" : "0");
  if (!remember) {
    identityMaterial.value = "";
    void removeStoredIdentity();
  }
});
watch([rememberIdentity, identityMaterial], ([remember, material]) => {
  if (remember && material) void saveStoredIdentity(material);
  if (!remember && material) identityMaterial.value = "";
});
watch(() => voiceState.connected, (connected) => {
  if (!connected) {
    stopPerformanceMonitoring();
    return;
  }
  playNotification("connected");
  const address = currentServerTarget();
  if (!address) return;
  const recent: RecentServer = {
    id: serverKey(address),
    address,
    ...(nickname.value.trim() ? { nickname: nickname.value.trim() } : {}),
    ...(rememberIdentity.value && identityMaterial.value ? { identityId: "current" } : {}),
    lastConnectedAt: Date.now(),
    ...(channel.value.trim() ? { lastChannelHint: { name: channel.value.trim() } } : {}),
  };
  void recordRecentServer(recent).then(() => listRecentServers().then((items) => { recentServers.value = items; }));
  if (performancePanelOpen.value) startPerformanceMonitoring();
});

watch(() => voiceState.reconnecting, (reconnecting, wasReconnecting) => {
  if (reconnecting && !wasReconnecting) {
    playNotification("disconnected");
  }
});
watch(() => voiceState.reconnectFailed, (failed, wasFailed) => {
  if (failed && !wasFailed) playNotification("reconnectFailed");
});

function doConnect() {
  if (!canJoin.value || voiceState.connecting) return;
  clearError();
  nickname.value = nickname.value.trim();
  localStorage.setItem("webspeak:nickname", nickname.value);
  void saveLocalPreferences({ schemaVersion: 1, lastNickname: nickname.value });
  if (accessMode.value === "open") {
    serverHost.value = serverHost.value.trim();
    serverPort.value = serverPort.value.trim();
  }
  selectedChannelId.value = "";
  // Keep the password field available for a retry even when the target is
  // administrator-managed. The gateway still controls the target in fixed
  // mode and only accepts a non-empty retry password for that target.
  connect(currentServerTarget(), channel.value.trim(), nickname.value, serverPassword.value, rememberIdentity.value ? identityMaterial.value : "", rememberIdentity.value, inviteToken, Boolean(accelerationRelayId.value), accelerationRelayId.value);
}

function doDisconnect() {
  disconnect();
  selectedChannelId.value = "";
  showToast(t("leftToast"));
}

function submitServerPassword() {
  if (!serverPasswordDialog.open || !serverPasswordDialog.password) return;
  serverPassword.value = serverPasswordDialog.password;
  serverPasswordDialog.open = false;
  serverPasswordDialog.password = "";
  serverPasswordDialog.errorCode = "";
  doConnect();
}

function cancelServerPassword() {
  serverPasswordDialog.open = false;
  serverPasswordDialog.password = "";
  serverPasswordDialog.errorCode = "";
  clearError();
}

function submitChannelPassword() {
  if (!channelPasswordDialog.open || !channelPasswordDialog.channelId || !channelPasswordDialog.password) return;
  channelPasswordDialog.error = "";
  channelPasswordDialog.submitting = true;
  switchChannel(channelPasswordDialog.channelId, channelPasswordDialog.password);
}

function cancelChannelPassword() {
  const ownChannel = channelTree.value.find((item) => item.members.some((member) => member.id === voiceState.tsClientId));
  if (ownChannel) selectedChannelId.value = ownChannel.id;
  channelPasswordDialog.open = false;
  channelPasswordDialog.channelId = "";
  channelPasswordDialog.password = "";
  channelPasswordDialog.error = "";
  channelPasswordDialog.submitting = false;
  clearError();
}

function doShare() {
  const invite = new URL(location.href);
  invite.searchParams.delete("token");
  invite.searchParams.delete("target");
  invite.searchParams.delete("tsHost");
  invite.searchParams.delete("tsPort");
  invite.searchParams.delete("server");
  if (accessMode.value === "open" && serverHost.value.trim()) invite.searchParams.set("server", currentServerTarget());
  if (channel.value) invite.searchParams.set("channel", channel.value);
  navigator.clipboard?.writeText(invite.toString()).then(() => showToast(t("copiedToast")), () => showToast(t("copyFailedToast")));
}

const canJoin = computed(() => Boolean(
  initialized.value
  && nickname.value.trim()
  && (accessMode.value === "fixed" || (serverHost.value.trim() && isValidTeamSpeakPort(serverPort.value))),
));
const isFavorite = computed(() => favoriteServers.value.some((favorite) => favorite.id === serverKey(currentServerTarget())));

function currentServerTarget(): string {
  return combineTeamSpeakTarget(serverHost.value, serverPort.value);
}

function serverKey(address: string): string {
  return address.trim().toLocaleLowerCase();
}

function selectLocalServer(address: string, savedNickname?: string): void {
  const target = splitTeamSpeakTarget(address);
  serverHost.value = target.address;
  serverPort.value = target.port;
  if (savedNickname && !nickname.value.trim()) nickname.value = savedNickname;
}

async function toggleFavorite(): Promise<void> {
  const address = currentServerTarget();
  if (!address) return;
  const id = serverKey(address);
  const existing = favoriteServers.value.find((favorite) => favorite.id === id);
  if (existing) {
    await removeFavorite(id);
    favoriteServers.value = favoriteServers.value.filter((favorite) => favorite.id !== id);
    showToast(t("removedFavoriteToast"));
    return;
  }
  const favorite: FavoriteServer = { id, label: address, address, ...(nickname.value.trim() ? { nickname: nickname.value.trim() } : {}), ...(rememberIdentity.value && identityMaterial.value ? { identityId: "current" } : {}), ...(channel.value.trim() ? { lastChannelHint: { name: channel.value.trim() } } : {}) };
  await saveFavorite(favorite);
  favoriteServers.value = [...favoriteServers.value, favorite].sort((a, b) => a.label.localeCompare(b.label));
  showToast(t("savedFavoriteToast"));
}

async function clearBrowserData(): Promise<void> {
  if (!window.confirm(t("clearLocalDataConfirm"))) return;
  await clearStoredLocalData();
  for (const key of ["webspeak:nickname", "webspeak:language", "webspeak:theme", "webspeak:input-device", "webspeak:output-device", "webspeak:remember-identity"]) localStorage.removeItem(key);
  themeMode.value = "system";
  applyTheme(themeMode.value);
  identityMaterial.value = "";
  rememberIdentity.value = false;
  favoriteServers.value = [];
  recentServers.value = [];
  showToast(t("localDataCleared"));
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/public-config", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const config = await response.json() as { version?: unknown; initialized?: unknown; siteName?: unknown; welcomeText?: unknown; welcomeTextEn?: unknown; welcomeTexts?: unknown; accessMode?: unknown; target?: unknown; visitorNumber?: unknown; visitorTotal?: unknown; accelerationAvailable?: unknown; accelerationRelays?: unknown };
    if (typeof config.version === "string" && config.version.trim()) appVersion.value = config.version.trim();
    visitorNumber.value = Number.isSafeInteger(config.visitorNumber) && Number(config.visitorNumber) > 0 ? Number(config.visitorNumber) : null;
    visitorTotal.value = Number.isSafeInteger(config.visitorTotal) && Number(config.visitorTotal) > 0 ? Number(config.visitorTotal) : null;
    initialized.value = config.initialized === true;
    if (typeof config.siteName === "string" && config.siteName.trim()) siteName.value = config.siteName.trim();
    if (typeof config.welcomeText === "string") welcomeTextZh.value = config.welcomeText;
    if (typeof config.welcomeTextEn === "string") welcomeTextEn.value = config.welcomeTextEn;
    if (config.welcomeTexts && typeof config.welcomeTexts === "object" && !Array.isArray(config.welcomeTexts)) {
      const welcomeTexts = config.welcomeTexts as Record<string, unknown>;
      if (typeof welcomeTexts.zh === "string") welcomeTextZh.value = welcomeTexts.zh;
      if (typeof welcomeTexts.en === "string") welcomeTextEn.value = welcomeTexts.en;
      if (typeof welcomeTexts.de === "string") welcomeTextDe.value = welcomeTexts.de;
      if (typeof welcomeTexts.ru === "string") welcomeTextRu.value = welcomeTexts.ru;
      if (typeof welcomeTexts.ja === "string") welcomeTextJa.value = welcomeTexts.ja;
    }
    accessMode.value = config.accessMode === "open" ? "open" : "fixed";
    accelerationRelays.value = Array.isArray(config.accelerationRelays)
      ? config.accelerationRelays.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const relay = value as { id?: unknown; name?: unknown };
        return typeof relay.id === "string" && typeof relay.name === "string" && relay.id && relay.name
          ? [{ id: relay.id, name: relay.name }]
          : [];
      })
      : [];
    if (!accelerationAvailable.value || !accelerationRelays.value.some((relay) => relay.id === accelerationRelayId.value)) accelerationRelayId.value = "";
    const hasInviteTarget = query.has("server") || query.has("target") || query.has("tsHost") || query.has("tsPort");
    if (!hasInviteTarget && typeof config.target === "string" && config.target.trim()) {
      const target = splitTeamSpeakTarget(config.target);
      serverHost.value = target.address;
      serverPort.value = target.port;
    }
  } catch {
    // Keep joining disabled until the gateway can confirm its initialized policy.
  } finally {
    serverConfigLoading.value = false;
  }
}


  onMounted(() => {
    browserError.value = checkSupport() ?? "";
    void loadPublicConfig();
    void loadStoredIdentity().then((stored) => {
      if (stored && localStorage.getItem("webspeak:remember-identity") === "1") {
        identityMaterial.value = stored.privateMaterial;
        rememberIdentity.value = true;
      }
    }).finally(() => {
      identityReady.value = true;
    });
    void listFavorites().then((items) => { favoriteServers.value = items; });
    void listRecentServers().then((items) => { recentServers.value = items; });
  });
  onUnmounted(() => {
    disconnect();
  });

  return { nickname, serverHost, serverPort, serverPassword, accessMode, rememberIdentity, favoriteServers, recentServers, initialized, siteName, welcomeTextZh, welcomeTextEn, welcomeTextDe, welcomeTextRu, welcomeTextJa, appVersion, visitorNumber, visitorTotal, accelerationRelays, accelerationRelayId, accelerationAvailable, browserError, serverConfigLoading, channelPasswordDialog, serverPasswordDialog, localPersistenceAvailable, identityReady, canJoin, isFavorite, doConnect, doDisconnect, submitServerPassword, cancelServerPassword, submitChannelPassword, cancelChannelPassword, doShare, selectLocalServer, toggleFavorite, clearBrowserData, loadPublicConfig };
}
