import { computed } from "vue";
import { copy, germanCopy, russianCopy, japaneseCopy } from "../../modules/admin/translations.js";
import { isDarkTheme, nextTheme, saveTheme } from "../../services/theme.js";


export function setupAdminI18n(vc: any): void {
  function tr(key: keyof typeof copy.zh, vars: Record<string, string | number> = {}): string { let value: string = vc.language.value === "zh" ? copy.zh[key] : vc.language.value === "de" ? germanCopy[key] ?? copy.en[key] ?? copy.zh[key] : vc.language.value === "ru" ? russianCopy[key] ?? copy.en[key] ?? copy.zh[key] : vc.language.value === "ja" ? japaneseCopy[key] ?? copy.en[key] ?? copy.zh[key] : copy.en[key] ?? copy.zh[key]; for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{{${name}}}`, String(replacement)); return value; }
  const themeIcon = computed(() => isDarkTheme(vc.themeMode.value) ? "sun" : "moon");
  const themeLabel = computed(() => isDarkTheme(vc.themeMode.value) ? vc.tr("switchToLightTheme") : vc.tr("switchToDarkTheme"));
  const currentPageTitle = computed(() => vc.route.path === "/admin/server" ? vc.tr('server') : vc.route.path === "/admin/operations" ? vc.tr('operations') : vc.tr('overview'));
  function persistLanguage() { localStorage.setItem("webspeak:language", vc.language.value); }
  function cycleTheme() { vc.themeMode.value = nextTheme(vc.themeMode.value); saveTheme(vc.themeMode.value); }
  function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat(vc.language.value === "zh" ? "zh-CN" : vc.language.value === "de" ? "de-DE" : vc.language.value === "ru" ? "ru-RU" : vc.language.value === "ja" ? "ja-JP" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
  function formatUptime(seconds: number) { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); if (vc.language.value === "zh") return `已运行 ${hours} 小时 ${minutes} 分钟`; if (vc.language.value === "de") return `${hours} Std. ${minutes} Min. aktiv`; if (vc.language.value === "ru") return `Работает ${hours} ч ${minutes} мин`; if (vc.language.value === "ja") return `${hours}時間 ${minutes}分 稼働`; return `Up ${hours}h ${minutes}m`; }
  function formatAge(seconds: number | null) { if (seconds == null) return "—"; if (seconds < 60) { if (vc.language.value === "zh") return `${seconds} 秒`; if (vc.language.value === "de") return `${seconds} Sek.`; if (vc.language.value === "ru") return `${seconds} с`; if (vc.language.value === "ja") return `${seconds}秒`; return `${seconds}s`; } const minutes = Math.floor(seconds / 60); if (minutes < 60) { if (vc.language.value === "zh") return `${minutes} 分钟`; if (vc.language.value === "de") return `${minutes} Min.`; if (vc.language.value === "ru") return `${minutes} мин`; if (vc.language.value === "ja") return `${minutes}分`; return `${minutes}m`; } const hours = Math.floor(minutes / 60); const rest = minutes % 60; if (vc.language.value === "zh") return `${hours} 小时 ${rest} 分钟`; if (vc.language.value === "de") return `${hours} Std. ${rest} Min.`; if (vc.language.value === "ru") return `${hours} ч ${rest} мин`; if (vc.language.value === "ja") return `${hours}時間 ${rest}分`; return `${hours}h ${rest}m`; }
  function eventName(event: string) { if (event === "ADMIN_LOGIN_FAILED") return vc.language.value === "zh" ? "管理员登录失败" : vc.language.value === "ru" ? "Ошибка входа администратора" : vc.language.value === "ja" ? "管理者ログイン失敗" : vc.language.value === "de" ? "Administrator-Anmeldung fehlgeschlagen" : "Administrator login failed"; if (event === "CONNECTION_TEST_SUCCEEDED") return vc.language.value === "zh" ? "连接测试成功" : vc.language.value === "ru" ? "Проверка подключения успешна" : vc.language.value === "ja" ? "接続テスト成功" : vc.language.value === "de" ? "Verbindungstest erfolgreich" : "Connection test succeeded"; if (event === "CONNECTION_TEST_FAILED") return vc.language.value === "zh" ? "连接测试失败" : vc.language.value === "ru" ? "Проверка подключения не удалась" : vc.language.value === "ja" ? "接続テスト失敗" : vc.language.value === "de" ? "Verbindungstest fehlgeschlagen" : "Connection test failed"; const names: Record<string, keyof typeof copy.zh> = { ADMIN_LOGIN_SUCCEEDED: "loginEvent", ADMIN_LOGOUT: "logoutEvent", SETTINGS_CHANGED: "settingsEvent", ADMIN_INITIALIZED: "initializedEvent", LEGACY_CONFIG_IMPORTED: "importedEvent", CONNECTION_TEST: "testEvent" }; return names[event] ? vc.tr(names[event]) : vc.language.value === "zh" ? "系统事件" : event.replaceAll("_", " "); }
  function errorText(code?: string) {
    if (code === "INVALID_PASSWORD") return vc.tr('invalidPassword');
    if (code === "INVALID_ADMIN_PASSWORD") return vc.tr('setupPasswordShort');
    if (code === "PASSWORD_CHANGE_REQUIRED") return vc.tr('changePasswordLead');
    if (code === "RATE_LIMITED") return vc.tr('rateLimited');
    if (code === "INVALID_WEBRTC_PORT_RANGE") {
      if (vc.language.value === "zh") return "WebRTC UDP 端口范围无效，请填写 1024–65535 且起始端口不能大于结束端口。";
      if (vc.language.value === "de") return "Der WebRTC-UDP-Portbereich ist ungültig. Verwende 1024–65535; der Startport darf nicht größer als der Endport sein.";
      if (vc.language.value === "ru") return "Диапазон UDP-портов WebRTC некорректен. Используйте 1024–65535; начальный порт не может быть больше конечного.";
      if (vc.language.value === "ja") return "WebRTC UDP ポート範囲が正しくありません。1024–65535 の範囲で、開始ポートを終了ポート以下にしてください。";
      return "The WebRTC UDP port range is invalid. Use 1024–65535 with the start no greater than the end.";
    }
    if (code === "WEBRTC_PORT_LOCKED") {
      if (vc.language.value === "zh") return "WebRTC 已开启，请先关闭并保存后再修改端口范围。";
      if (vc.language.value === "de") return "WebRTC ist aktiviert. Deaktiviere es und speichere zuerst, bevor du den Portbereich änderst.";
      if (vc.language.value === "ru") return "WebRTC включён. Сначала отключите его и сохраните настройки, затем изменяйте диапазон портов.";
      if (vc.language.value === "ja") return "WebRTC が有効です。ポート範囲を変更する前に無効にして保存してください。";
      return "WebRTC is enabled. Turn it off and save before changing the port range.";
    }
    const locale = vc.language.value === "zh" ? "zh" : vc.language.value === "de" ? "de" : "en";
    const relayErrors: Record<string, { zh: string; en: string; de: string }> = {
      INVALID_RELAY_NAME: { zh: "中继名称无效或为空。", en: "The relay name is invalid or empty.", de: "Der Relay-Name ist ungültig oder leer." },
      INVALID_RELAY_TARGET: { zh: "中继服务器地址无效。", en: "The relay server address is invalid.", de: "Die Relay-Serveradresse ist ungültig." },
      INVALID_RELAY_TOKEN: { zh: "启用中继时必须填写令牌。", en: "A relay token is required when the relay is enabled.", de: "Beim Aktivieren des Relays ist ein Token erforderlich." },
    };
    if (relayErrors[code || ""]) return relayErrors[code || ""][locale];
    const probe: Record<string, { zh: string; en: string; de: string }> = {
      INVALID_TARGET: { zh: "TeamSpeak 服务器地址格式无效。", en: "The TeamSpeak server address is invalid.", de: "Die TeamSpeak-Serveradresse ist ungültig." },
      PING_UNAVAILABLE: { zh: "当前运行环境没有可用的 ICMP Ping 工具。", en: "The runtime does not provide an ICMP ping tool.", de: "In der Laufzeitumgebung ist kein ICMP-Ping-Tool verfügbar." },
      HOST_NOT_FOUND: { zh: "找不到服务器主机名。", en: "The server hostname could not be resolved.", de: "Der Servername konnte nicht aufgelöst werden." },
      UNREACHABLE: { zh: "无法连接 TeamSpeak 服务器。", en: "The TeamSpeak server is unreachable.", de: "Der TeamSpeak-Server ist nicht erreichbar." },
      TIMEOUT: { zh: "连接 TeamSpeak 超时。", en: "The TeamSpeak connection timed out.", de: "Die Verbindung zu TeamSpeak ist abgelaufen." },
      PROTOCOL_NEGOTIATION_FAILED: { zh: "无法识别 TeamSpeak 协议。", en: "TeamSpeak protocol negotiation failed.", de: "Die Aushandlung des TeamSpeak-Protokolls ist fehlgeschlagen." },
      SERVER_REJECTED: { zh: "TeamSpeak 服务器拒绝了连接。", en: "The TeamSpeak server rejected the connection.", de: "Der TeamSpeak-Server hat die Verbindung abgelehnt." },
      TARGET_NOT_ALLOWED: { zh: "此地址不允许在开放模式中使用。", en: "This target is not allowed in open mode.", de: "Dieses Ziel ist im offenen Modus nicht erlaubt." },
    };
    return probe[code || ""]?.[locale] ?? vc.tr('requestFailed');
  }
  function connectionFailureText(code?: string) {
    const names: Record<string, keyof typeof copy.zh> = {
      PASSWORD_REQUIRED: "serverPasswordRequiredError",
      SERVER_PASSWORD_REQUIRED: "serverPasswordRequiredError",
    INVALID_PASSWORD: "invalidServerPasswordError",
    INVALID_SERVER_PASSWORD: "invalidServerPasswordError",
      INVALID_TARGET: "serverAddress",
      INVALID_NICKNAME: "invalidNicknameError",
    HOST_NOT_FOUND: "hostNotFoundError",
    UNREACHABLE: "networkUnreachableError",
    CONNECTION_REFUSED: "connectionRefusedError",
    CONNECTION_RESET: "connectionResetError",
    TIMEOUT: "networkTimeoutError",
      PROTOCOL_NEGOTIATION_FAILED: "protocolFailureError",
      SERVER_REJECTED: "serverRejectedError",
    PING_UNAVAILABLE: "pingUnavailableError",
    CONNECTION_FAILED: "connectionFailed",
    };
    return names[code || ""] ? vc.tr(names[code || ""]) : vc.errorText(code);
  }
  vc.tr = tr;
  vc.themeIcon = themeIcon;
  vc.themeLabel = themeLabel;
  vc.currentPageTitle = currentPageTitle;
  vc.persistLanguage = persistLanguage;
  vc.cycleTheme = cycleTheme;
  vc.formatDate = formatDate;
  vc.formatUptime = formatUptime;
  vc.formatAge = formatAge;
  vc.eventName = eventName;
  vc.errorText = errorText;
  vc.connectionFailureText = connectionFailureText;
}
