<template>
    <!-- Connection / welcome screen -->
    <section v-if="!voiceState.connected && !voiceState.reconnecting && !voiceState.reconnectFailed" class="join-page">
      <header class="join-header">
        <div class="brand-lockup">
          <img class="brand-mark" src="/网站图标.jpg" alt="WebSpeak" />
          <div>
            <strong>{{ siteName }}</strong>
            <small>{{ t('browserWorkspace') }}</small>
          </div>
        </div>
        <div class="header-tools"><div class="header-note"><span class="tiny-dot"></span> {{ t('secureGateway') }}</div><a class="github-button" href="https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak" target="_blank" rel="noreferrer" :title="t('githubRepository')" :aria-label="t('githubRepository')"><Icon name="github" :size="18" /><span>{{ t('githubRepository') }}</span></a><button type="button" class="qq-button" :title="t('qqGroup')" :aria-label="t('qqGroup')" aria-haspopup="dialog" @click="qqModalOpen = true"><Icon name="qq" :size="18" /><span class="qq-label">{{ t('qqGroup') }}</span></button><a class="bilibili-button" href="https://space.bilibili.com/25414873" target="_blank" rel="noreferrer" :title="t('bilibiliProfile')" :aria-label="t('bilibiliProfile')"><span class="bilibili-glyph">B</span><span class="bilibili-label">{{ t('bilibiliProfile') }}</span></a><span class="version-badge" :title="`${t('currentVersion')}: v${appVersion}`" :aria-label="`${t('currentVersion')}: v${appVersion}`">v{{ appVersion }}</span><a class="changelog-button" href="https://github.com/EchoSixHIYA/WebSpeak-client-for-TeamSpeak/blob/master/CHANGELOG.md" target="_blank" rel="noreferrer" :title="t('viewChangelog')" :aria-label="t('viewChangelog')"><Icon name="clock" :size="16" /><span>{{ t('viewChangelog') }}</span></a><a class="guide-button" href="/admin" :title="t('adminConsole')" :aria-label="t('adminConsole')"><Icon name="settings" :size="15" /><span>{{ t('adminConsole') }}</span></a><button type="button" class="header-action theme-toggle" :title="themeLabel" :aria-label="themeLabel" @click="cycleTheme"><Icon :name="themeIcon" :size="17" /></button><LanguageSwitcher v-model="language" class="join-language-switcher" :menu-label="t('languageMenu')" @change="persistLanguage" /></div>
      </header>

      <main class="join-content">
        <div class="join-copy">
          <div class="eyebrow"><span class="eyebrow-dot"></span> {{ t('privateAudio') }}</div>
          <h1>{{ t('joinLine1') }}<br /><em>{{ t('joinLine2') }}</em></h1>
          <p class="join-description">{{ localizedWelcomeText }}</p>
          <div class="promise-list">
            <div class="promise-item"><span class="promise-icon"><Icon name="waveform" :size="16" /></span><span><b>{{ t('highQuality') }}</b><small>{{ t('opusAudio') }}</small></span></div>
            <div class="promise-item"><span class="promise-icon mint"><Icon name="shield" :size="16" /></span><span><b>{{ t('secureJoin') }}</b><small>{{ t('inviteProtected') }}</small></span></div>
            <div class="promise-item"><span class="promise-icon sand"><Icon name="users" :size="16" /></span><span><b>{{ t('realtime') }}</b><small>{{ t('membersSync') }}</small></span></div>
          </div>
          <div v-if="visitorNumber !== null" class="visitor-count" role="status" aria-live="polite">
            <span class="visitor-count-orbit" aria-hidden="true"></span>
            <span class="visitor-count-icon"><Icon name="users" :size="15" /></span>
            <span class="visitor-count-label">{{ t('visitorCount', { count: visitorNumber }) }}</span>
            <span v-if="visitorTotal !== null" class="visitor-count-divider" aria-hidden="true"></span>
            <span v-if="visitorTotal !== null" class="visitor-count-total">{{ t('visitorTotal', { count: visitorTotal }) }}</span>
            <span class="visitor-count-spark" aria-hidden="true">✦</span>
          </div>
        </div>

        <div class="join-card">
          <h2>{{ t('welcomeBack') }}</h2>
          <p class="card-lead">{{ t('joinLead') }}</p>

          <div v-if="voiceState.error" class="notice error-notice"><span class="notice-symbol">!</span><span class="notice-content"><span>{{ localizedMessage(voiceState.error) }}</span><code v-if="voiceState.errorCode">{{ t('errorCode') }}: {{ visibleErrorCode(voiceState.errorCode) }}</code></span></div>
          <div v-if="browserError" class="notice warning-notice"><span class="notice-symbol">i</span><span>{{ localizedMessage(browserError) }}</span></div>
          <div v-if="!serverConfigLoading && !initialized" class="notice warning-notice"><span class="notice-symbol">i</span><span>{{ t('notConfigured') }} <a href="/admin">{{ t('configureNow') }}</a></span></div>
          <div v-if="!localPersistenceAvailable" class="notice warning-notice"><span class="notice-symbol">i</span><span>{{ t('localPersistenceUnavailable') }}</span></div>

          <form v-if="initialized" class="join-form" @submit.prevent="doConnect">
            <div v-if="accessMode === 'open'" class="field-grid target-fields">
              <label class="field-label" for="server-address"><span>{{ t('serverAddress') }}</span><div class="field-wrap"><Icon name="server" :size="17" /><input id="server-address" v-model="serverHost" autocomplete="url" :placeholder="t('serverAddressPlaceholder')" /></div></label>
              <label class="field-label" for="server-port"><span>{{ t('serverPort') }}</span><div class="field-wrap"><Icon name="hash" :size="17" /><input id="server-port" v-model="serverPort" inputmode="numeric" type="text" maxlength="5" :placeholder="t('serverPortPlaceholder')" /></div></label>
            </div>
            <div v-if="accelerationAvailable" class="acceleration-choice"><div class="acceleration-copy"><strong>{{ t('relayAcceleration') }}</strong><small>{{ t('relayAccelerationHint') }}</small></div><select v-model="accelerationRelayId" :aria-label="t('relayAcceleration')"><option value="">{{ t('directConnection') }}</option><option v-for="relay in accelerationRelays" :key="relay.id" :value="relay.id">{{ relay.name }}</option></select></div>
            <div v-if="accessMode === 'open' && (favoriteServers.length || recentServers.length)" class="local-servers">
              <div v-if="favoriteServers.length" class="local-server-group"><span>{{ t('favoriteServers') }}</span><button v-for="favorite in favoriteServers" :key="favorite.id" type="button" @click="selectLocalServer(favorite.address, favorite.nickname)">{{ favorite.label }}</button></div>
              <div v-if="recentServers.length" class="local-server-group"><span>{{ t('recentServers') }}</span><button v-for="recent in recentServers" :key="recent.id" type="button" @click="selectLocalServer(recent.address, recent.nickname)">{{ recent.address }}</button></div>
            </div>
            <button v-if="accessMode === 'open' && serverHost.trim()" type="button" class="favorite-toggle" @click="toggleFavorite">{{ isFavorite ? t('removeFavorite') : t('saveFavorite') }}</button>

            <template v-if="accessMode === 'open'">
              <label class="field-label" for="server-password">{{ t('serverPassword') }} <span>{{ t('optional') }}</span></label>
              <div class="field-wrap"><Icon name="lock" :size="17" /><input id="server-password" v-model="serverPassword" type="password" autocomplete="off" :placeholder="t('optionalPassword')" /></div>
            </template>

            <label class="field-label" for="nickname">{{ t('nickname') }}</label>
            <div class="field-wrap">
              <Icon name="users" :size="17" />
              <input id="nickname" v-model="nickname" autocomplete="nickname" maxlength="30" :placeholder="t('nicknamePlaceholder')" autofocus />
            </div>

            <label class="field-label" for="channel">{{ t('targetChannel') }} <span>{{ t('optional') }}</span></label>
            <div class="field-wrap">
              <Icon name="hash" :size="17" />
              <input id="channel" v-model="channel" :placeholder="t('emptyDefault')" @keyup.enter="doConnect" />
            </div>

            <details class="identity-options"><summary>{{ t('identityOptions') }}</summary><label class="remember-identity"><input v-model="rememberIdentity" type="checkbox" /><span><strong>{{ t('rememberIdentity') }}</strong><small>{{ t('rememberIdentityHint') }}</small></span></label></details><p v-if="rememberIdentity" class="identity-warning">{{ t('rememberIdentityConcurrentWarning') }}</p>

            <button class="primary-button connect-button" :disabled="!canJoin || serverConfigLoading || !identityReady || voiceState.connecting" type="submit">
              <span v-if="voiceState.connecting" class="button-spinner"></span>
              <span>{{ voiceState.connecting ? t('connecting') : t('enterVoice') }}</span>
              <Icon v-if="!voiceState.connecting" name="chevron-right" :size="17" />
            </button>
            <button v-if="voiceState.connecting" type="button" class="cancel-connect-button" @click="doDisconnect">{{ t('cancel') }}</button>
          </form>
          <div class="join-meta"><Icon name="lock" :size="14" /> {{ t('connectionAuthorized') }}</div>
        </div>
      </main>

      <footer class="join-footer">
        <span>WebSpeak</span><span class="footer-separator">·</span><span>{{ t('teamSpeakClient') }}</span><span class="footer-spacer"></span><button type="button" class="clear-local-button" @click="clearBrowserData">{{ t('clearLocalData') }}</button><span class="footer-separator">·</span><span>{{ t('browserSupport') }}</span>
      </footer>

      <!-- QQ community modal -->
      <div v-if="qqModalOpen" class="modal-backdrop qq-modal-backdrop" @click.self="qqModalOpen = false">
        <section class="qq-modal-card" role="dialog" aria-modal="true" :aria-labelledby="'qq-group-title'">
          <button type="button" class="qq-modal-close" :aria-label="t('close')" :title="t('close')" @click="qqModalOpen = false"><Icon name="close" :size="19" /></button>
          <div class="qq-modal-heading"><span class="card-kicker">{{ t('qqGroup') }}</span><h2 id="qq-group-title">{{ t('qqGroup') }}</h2></div>
          <img class="qq-qr-image" src="/qq-group-qr.jpg" :alt="t('qqGroupQrAlt')" />
          <p class="qq-direct-join">{{ t('qqJoinDirect') }}</p>
          <a class="qq-join-link" :href="qqJoinUrl" :aria-label="t('joinQqGroup')" target="_blank" rel="noreferrer">{{ qqJoinUrl }}</a>
        </section>
      </div>
    </section>
</template>

<script setup lang="ts">
import Icon from "./Icon.vue";
import LanguageSwitcher from "./LanguageSwitcher.vue";
import type { Language } from "../modules/translations.js";
import type { VoiceState } from "../composables/useVoiceWebSocket.js";
import type { FavoriteServer, RecentServer } from "../services/local-persistence.js";

const language = defineModel<Language>("language", { required: true });
const serverHost = defineModel<string>("serverHost", { required: true });
const serverPort = defineModel<string>("serverPort", { required: true });
const accelerationRelayId = defineModel<string>("accelerationRelayId", { required: true });
const serverPassword = defineModel<string>("serverPassword", { required: true });
const nickname = defineModel<string>("nickname", { required: true });
const channel = defineModel<string>("channel", { required: true });
const rememberIdentity = defineModel<boolean>("rememberIdentity", { required: true });
const qqModalOpen = defineModel<boolean>("qqModalOpen", { required: true });

defineProps<{
  voiceState: VoiceState;
  siteName: string;
  appVersion: string;
  visitorNumber: number | null;
  visitorTotal: number | null;
  localizedWelcomeText: string;
  browserError: string;
  serverConfigLoading: boolean;
  initialized: boolean;
  localPersistenceAvailable: boolean;
  accessMode: "fixed" | "open";
  accelerationAvailable: boolean;
  accelerationRelays: Array<{ id: string; name: string }>;
  favoriteServers: FavoriteServer[];
  recentServers: RecentServer[];
  isFavorite: boolean;
  canJoin: boolean;
  identityReady: boolean;
  qqJoinUrl: string;
  themeLabel: string;
  themeIcon: string;
  t: (key: string, variables?: Record<string, string | number>) => string;
  persistLanguage: () => void;
  cycleTheme: () => void;
  localizedMessage: (message: string) => string;
  visibleErrorCode: (code: string) => string;
  doConnect: () => void;
  doDisconnect: () => void;
  selectLocalServer: (address: string, savedNickname?: string) => void;
  toggleFavorite: () => void;
  clearBrowserData: () => void;
}>();
</script>

<style scoped>
.join-page { min-height: 100dvh; display: flex; flex-direction: column; overflow: hidden; background: #f7f9f8; }
.join-header, .join-content, .join-footer { width: min(1240px, calc(100% - 64px)); margin: 0 auto; }
.join-header, .join-content, .join-footer { position: relative; z-index: 1; }
.join-header { z-index: 10; }
.join-header .language-switcher { z-index: 50; }
.join-footer { z-index: 2; }
.join-header { min-height: 84px; display: flex; align-items: center; justify-content: space-between; }
.brand-lockup { display: flex; align-items: center; gap: 12px; }
.brand-mark, .rail-logo { display: grid; place-items: center; color: #fff; background: #006a64; box-shadow: 0 8px 18px rgba(0, 106, 100, .15); }
.brand-mark { display: block; width: 40px; height: 40px; border-radius: 12px; object-fit: cover; }
.brand-lockup strong { display: block; color: #006a64; font-size: 18px; letter-spacing: -.04em; }
.brand-lockup strong span { color: #24312f; font-weight: 500; }
.brand-lockup small { display: block; margin-top: 2px; color: #7b8885; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.header-tools { display: flex; align-items: center; gap: 17px; }
.github-button { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 13px; color: #fff; background: #1f2d2b; border: 1px solid #1f2d2b; border-radius: 9px; box-shadow: 0 5px 12px rgba(31,45,43,.16); font-size: 12px; font-weight: 800; text-decoration: none; transition: .18s; }
.github-button:hover { color: #fff; background: #006a64; border-color: #006a64; box-shadow: 0 7px 16px rgba(0,106,100,.2); transform: translateY(-1px); }
.github-button .ui-icon { flex: 0 0 auto; }
.version-badge { display: inline-flex; align-items: center; min-height: 30px; padding: 0 9px; color: #006a64; background: #e7f4f1; border: 1px solid #cfe9e4; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: .02em; white-space: nowrap; }
.changelog-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 0 10px; color: #006a64; background: #f2f8f6; border: 1px solid #dcebe7; border-radius: 8px; font-size: 11px; font-weight: 700; text-decoration: none; transition: .18s; }
.changelog-button:hover { color: #fff; background: #006a64; border-color: #006a64; }
.header-note { display: flex; align-items: center; gap: 8px; color: #71807c; font-size: 12px; }
.language-switch { min-width: 50px; min-height: 28px; padding: 0 9px; color: #006a64; background: #e2f2ef; border: 1px solid #c8e6e1; border-radius: 7px; font-size: 10px; font-weight: 700; cursor: pointer; transition: .18s; }
.language-switch:hover { color: #fff; background: #006a64; border-color: #006a64; }
.tiny-dot, .online-dot, .status-pulse { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #65d879; box-shadow: 0 0 0 4px rgba(101, 216, 121, .14); }
.join-content { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(480px, 520px); align-items: center; gap: clamp(40px, 6vw, 88px); padding: 38px 0 56px; }
.join-copy { max-width: 630px; }
.eyebrow, .room-eyebrow { display: flex; align-items: center; gap: 9px; color: #006a64; font-size: 11px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; }
.eyebrow-dot { width: 9px; height: 9px; border-radius: 50%; background: #90f691; }
.join-copy h1 { margin: 20px 0 18px; color: #192120; font-size: clamp(42px, 5.3vw, 72px); line-height: 1.04; letter-spacing: -.075em; }
.join-copy h1 em { color: #006a64; font-style: normal; }
.join-description { max-width: 500px; margin: 0; color: #65736f; font-size: 17px; line-height: 1.75; }
.promise-list { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 42px; }
.promise-item { display: flex; align-items: center; gap: 10px; min-width: 160px; }
.promise-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #006a64; background: #d8f3ef; }
.promise-icon.mint { color: #258844; background: #e0f6e1; }
.promise-icon.sand { color: #9c6739; background: #f7ebdc; }
.promise-item b, .promise-item small { display: block; }
.promise-item b { color: #283431; font-size: 12px; }
.promise-item small { margin-top: 3px; color: #87938f; font-size: 10px; }
.visitor-count { position: relative; display: inline-flex; align-items: center; gap: 10px; width: fit-content; max-width: 100%; min-height: 42px; margin: 30px 0 0; padding: 7px 14px 7px 9px; overflow: hidden; color: #006a64; border: 1px solid rgba(86, 202, 185, .42); border-radius: 999px; background: linear-gradient(110deg, rgba(225, 250, 245, .94), rgba(244, 255, 252, .78)); box-shadow: 0 10px 24px rgba(0, 106, 100, .1), inset 0 0 0 1px rgba(255, 255, 255, .55); font-size: 12px; font-weight: 700; letter-spacing: .035em; }
.visitor-count::before { position: absolute; top: 0; bottom: 0; left: -45%; width: 38%; background: linear-gradient(105deg, transparent, rgba(255, 255, 255, .62), transparent); content: ""; pointer-events: none; transform: skewX(-18deg); animation: visitor-shimmer 3.6s 1.5s ease-in-out infinite; }
.visitor-count-orbit { position: absolute; top: -20px; right: 12px; width: 51px; height: 51px; border: 1px solid rgba(71, 194, 174, .32); border-radius: 50%; pointer-events: none; animation: visitor-orbit 4s ease-in-out infinite; }
.visitor-count-icon { position: relative; z-index: 1; display: grid; place-items: center; width: 27px; height: 27px; flex: 0 0 auto; color: #fff; border-radius: 50%; background: linear-gradient(135deg, #006a64, #32cdb7); box-shadow: 0 0 0 4px rgba(55, 205, 182, .12), 0 0 18px rgba(55, 205, 182, .24); }
.visitor-count-label { position: relative; z-index: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.visitor-count-divider { position: relative; z-index: 1; width: 1px; height: 18px; flex: 0 0 auto; background: currentColor; opacity: .24; }
.visitor-count-total { position: relative; z-index: 1; min-width: 0; overflow: hidden; color: inherit; font-size: .92em; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; opacity: .78; }
.visitor-count-spark { position: relative; z-index: 1; color: #35bea7; font-size: 15px; line-height: 1; animation: visitor-spark 2.1s ease-in-out infinite; }
.join-card { padding: 30px; border: 1px solid rgba(214, 226, 223, .8); border-radius: 20px; background: rgba(255, 255, 255, .86); box-shadow: 0 20px 52px rgba(35, 68, 63, .08); backdrop-filter: blur(12px); }
.card-kicker, .section-kicker { color: #79918c; font-size: 10px; font-weight: 700; letter-spacing: .16em; }
.join-card h2 { margin: 10px 0 7px; color: #1b2825; font-size: 27px; letter-spacing: -.045em; }
.card-lead { margin: 0 0 7px; color: #7b8885; font-size: 13px; }
.notice { display: flex; align-items: flex-start; gap: 10px; min-width: 0; margin: 0 0 10px; padding: 9px 10px; border-radius: 10px; font-size: 12px; line-height: 1.45; }
.notice-content { min-width: 0; overflow-wrap: anywhere; }
.notice-content code { display: block; max-width: 100%; margin-top: 3px; overflow: hidden; color: currentColor; font-family: ui-monospace,SFMono-Regular,Consolas,monospace; font-size: 10px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; opacity: .78; }
.error-notice { color: #a53c38; background: #fff0ef; border: 1px solid #f7d4d1; }
.warning-notice { color: #8a6537; background: #fff8e9; border: 1px solid #f2dfb3; }
.notice-symbol { display: grid; place-items: center; width: 16px; height: 16px; flex: 0 0 auto; border-radius: 50%; color: #fff; background: currentColor; color: #fff; font-size: 10px; font-weight: 800; }
.error-notice .notice-symbol { background: #d95d55; }
.warning-notice .notice-symbol { background: #c89143; }
.join-form { display: grid; gap: 6px; }
.field-grid { display: grid; grid-template-columns: minmax(0, 1fr) 132px; gap: 12px; }
.field-grid .field-label { display: block; }
.field-grid .field-label:not(:first-child) { margin-top: 0; }
.field-label, .settings-label { color: #43514d; font-size: 11px; font-weight: 600; }
.field-label:not(:first-child) { margin-top: 6px; }
.field-label span { color: #a2aaa7; font-weight: 400; }
.field-wrap { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 0 14px; color: #8b9b96; border-radius: 10px; background: #f3f6f5; transition: .2s ease; }
.field-wrap:focus-within { color: #006a64; background: #fff; box-shadow: 0 0 0 2px #81d8d0; }
.field-wrap input { width: 100%; min-width: 0; padding: 0; color: #24312f; outline: none; border: 0; background: transparent; font-size: 13px; }
.field-wrap input::placeholder { color: #a5b0ad; }
.primary-button { display: inline-flex; align-items: center; justify-content: center; gap: 10px; color: #fff; background: #006a64; border-radius: 9px; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform .18s, box-shadow .18s, background .18s; }
.primary-button:hover:not(:disabled) { background: #005650; box-shadow: 0 9px 20px rgba(0, 106, 100, .18); transform: translateY(-1px); }
.primary-button:active:not(:disabled) { transform: translateY(0); }
.primary-button:disabled { cursor: not-allowed; opacity: .45; }
.connect-button { width: 100%; min-height: 44px; margin-top: 10px; font-size: 13px; }
.button-spinner { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
.join-meta { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 12px; color: #96a29f; font-size: 10px; }
.join-footer { display: flex; align-items: center; min-height: 68px; background: var(--surface-0); color: #9ba6a3; border-top: 1px solid #e8edeb; font-size: 11px; }.join-footer a { color: #628e89; text-decoration: none; }.join-footer a:hover { color: #006a64; text-decoration: underline; }
.footer-separator { margin: 0 8px; color: #ccd5d1; }.footer-spacer { flex: 1; }
.workspace { display: flex; min-width: 0; flex-direction: column; background: #fff; }.workspace-header { display: flex; align-items: center; justify-content: space-between; min-height: 73px; padding: 0 29px; border-bottom: 1px solid #eef2f0; }.breadcrumbs { display: flex; align-items: center; gap: 9px; min-width: 0; color: #52605b; font-size: 12px; }.breadcrumbs strong { overflow: hidden; color: #26332f; text-overflow: ellipsis; white-space: nowrap; }.crumb-muted { color: #98a39f; }.mobile-brand { display: none; color: #006a64; font-size: 17px; font-weight: 800; letter-spacing: -.06em; }.mobile-brand em { color: #293632; font-style: normal; font-weight: 500; }.workspace-actions, .dock-actions { display: flex; align-items: center; gap: 8px; }.header-action, .dock-icon { display: grid; place-items: center; color: #75847f; background: transparent; border-radius: 8px; cursor: pointer; transition: .16s; }.header-action { width: 32px; height: 32px; }.header-action:hover, .dock-icon:hover { color: #006a64; background: #edf5f2; }.disconnect-button { display: inline-flex; align-items: center; gap: 6px; min-height: 33px; margin-left: 8px; padding: 0 13px; color: #a94d48; background: #fff2f1; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; }.disconnect-button:hover { color: #fff; background: #c95a54; }
.workspace { display: flex; min-width: 0; flex-direction: column; background: #fff; }.workspace-header { display: flex; align-items: center; justify-content: space-between; min-height: 73px; padding: 0 29px; border-bottom: 1px solid #eef2f0; }.breadcrumbs { display: flex; align-items: center; gap: 9px; min-width: 0; color: #52605b; font-size: 12px; }.breadcrumbs strong { overflow: hidden; color: #26332f; text-overflow: ellipsis; white-space: nowrap; }.crumb-muted { color: #98a39f; }.mobile-brand { display: none; color: #006a64; font-size: 17px; font-weight: 800; letter-spacing: -.06em; }.mobile-brand em { color: #293632; font-style: normal; font-weight: 500; }.workspace-actions, .dock-actions { display: flex; align-items: center; gap: 8px; }.header-action, .dock-icon { display: grid; place-items: center; color: #75847f; background: transparent; border-radius: 8px; cursor: pointer; transition: .16s; }.header-action { width: 32px; height: 32px; }.header-action:hover, .dock-icon:hover { color: #006a64; background: #edf5f2; }.workspace-language { margin-left: 3px; }.disconnect-button { display: inline-flex; align-items: center; gap: 6px; min-height: 33px; margin-left: 8px; padding: 0 13px; color: #a94d48; background: #fff2f1; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; }.disconnect-button:hover { color: #fff; background: #c95a54; }
.modal-backdrop { position: fixed; z-index: 20; inset: 0; display: grid; place-items: center; padding: 28px; background: rgba(25, 33, 31, .42); backdrop-filter: blur(5px); }.settings-modal { display: flex; width: min(920px, 100%); max-height: min(760px, calc(100dvh - 56px)); overflow: hidden; border-radius: 16px; background: #fff; box-shadow: 0 20px 60px rgba(16,40,35,.2); }.settings-nav { display: flex; flex-direction: column; width: 215px; flex: 0 0 auto; padding: 28px 12px 20px; background: #f8faf9; border-right: 1px solid #e6ecea; }.settings-title { padding: 0 13px 20px; color: #25322e; font-size: 19px; font-weight: 700; }.settings-nav-item { display: flex; align-items: center; gap: 12px; padding: 11px 13px; color: #65736f; background: transparent; border-left: 3px solid transparent; border-radius: 8px; font-size: 11px; text-align: left; cursor: pointer; }.settings-nav-item.active { color: #006a64; background: #e2efec; border-left-color: #006a64; font-weight: 700; }.settings-version { margin-top: auto; padding: 20px 13px 0; color: #98a5a0; border-top: 1px solid #e4ebe8; font-size: 10px; line-height: 1.7; }.settings-version span { color: #b0bbb7; }.settings-main { display: flex; min-width: 0; flex: 1; flex-direction: column; }.settings-header { display: flex; align-items: center; justify-content: space-between; min-height: 75px; padding: 0 28px; border-bottom: 1px solid #edf1ef; }.settings-header h2 { margin: 0; color: #202c29; font-size: 22px; letter-spacing: -.045em; }.settings-content { flex: 1; overflow-y: auto; padding: 28px 40px; }.settings-section { max-width: 620px; margin: 0 auto; }.settings-section h3 { display: flex; align-items: center; gap: 9px; margin: 0 0 21px; color: #293631; font-size: 16px; }.settings-section h3 .ui-icon { color: #006a64; }.settings-label { display: block; margin-bottom: 8px; color: #5e6d67; font-size: 10px; font-weight: 500; }.select-like { display: flex; align-items: center; justify-content: space-between; min-height: 39px; margin-bottom: 19px; padding: 0 13px; color: #394742; background: #f4f7f6; border-radius: 8px; font-size: 11px; }.select-like .ui-icon { color: #677671; }.settings-range-row { display: flex; align-items: center; justify-content: space-between; }.settings-range-row .settings-label { margin: 0; }.settings-range-row strong { color: #006a64; font-size: 10px; }.settings-range { width: 100%; height: 6px; margin: 11px 0 20px; appearance: none; border-radius: 999px; outline: none; cursor: pointer; }.settings-range::-webkit-slider-thumb { width: 19px; height: 19px; }.settings-range::-moz-range-thumb { width: 19px; height: 19px; }.mic-test { padding: 15px; border: 1px solid #e5ece9; border-radius: 11px; background: #fafcfb; }.mic-test-header { display: flex; align-items: center; justify-content: space-between; }.mic-test-header strong { color: #36453f; font-size: 11px; }.mic-test-header button { padding: 6px 9px; color: #006a64; background: #e0f1ee; border-radius: 5px; font-size: 10px; cursor: pointer; }.meter { display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; height: 39px; margin-top: 12px; padding: 0 4px 4px; border-bottom: 1px solid #dce6e2; }.meter i { width: 5px; min-height: 4px; border-radius: 3px 3px 0 0; background: #dfe6e3; }.meter i.active { background: #81ed8b; box-shadow: 0 0 7px rgba(129,237,139,.45); animation: meter 1s ease-in-out infinite alternate; }.meter-labels { display: flex; justify-content: space-between; margin-top: 6px; color: #9ba6a2; font-size: 8px; }.settings-separator { max-width: 620px; margin: 32px auto; border-top: 1px solid #edf1ef; }.mode-note { display: flex; align-items: flex-start; gap: 8px; padding: 12px; color: #66817a; background: #eef7f4; border-radius: 8px; font-size: 10px; line-height: 1.5; }.mode-note .ui-icon { color: #4f9c91; }.settings-footer { display: flex; justify-content: flex-end; gap: 16px; min-height: 67px; padding: 15px 28px; border-top: 1px solid #edf1ef; }.text-button { padding: 0 6px; color: #63716c; background: transparent; font-size: 11px; font-weight: 600; cursor: pointer; }.save-button { padding: 0 23px; }.qq-modal-card { position: relative; width: min(460px, 100%); max-height: min(90dvh, 720px); overflow-y: auto; padding: 30px; color: #263431; border: 1px solid #d9e7e3; border-radius: 20px; background: #fff; box-shadow: 0 20px 60px rgba(16,40,35,.22); text-align: center; }.qq-modal-heading { padding: 0 24px 18px; }.qq-modal-heading h2 { margin: 8px 0 0; color: #1d2d29; font-size: 25px; letter-spacing: -.04em; }.qq-modal-close { position: absolute; top: 13px; right: 13px; display: grid; place-items: center; width: 34px; height: 34px; padding: 0; color: #6d7d78; background: #f1f6f4; border: 1px solid #e1ebe8; border-radius: 50%; cursor: pointer; }.qq-modal-close:hover { color: #006a64; background: #e2f2ef; border-color: #c8e6e1; }.qq-qr-image { display: block; width: min(100%, 360px); max-height: min(55vh, 520px); margin: 0 auto; object-fit: contain; border-radius: 12px; }.qq-direct-join { margin: 18px 0 9px; color: #667773; font-size: 13px; }.qq-join-link { display: block; padding: 11px 14px; color: #006a64; background: #edf8f5; border: 1px solid #cfe9e4; border-radius: 10px; font-size: 12px; font-weight: 700; line-height: 1.45; text-decoration: none; overflow-wrap: anywhere; }.qq-join-link:hover { color: #fff; background: #006a64; border-color: #006a64; }.toast { position: fixed; z-index: 30; right: 24px; bottom: 24px; display: flex; align-items: center; gap: 8px; padding: 11px 15px; color: #fff; background: #263e39; border-radius: 9px; box-shadow: 0 10px 24px rgba(16,48,42,.2); font-size: 11px; animation: toast-in .25s ease-out; }
.channel-password-form .field-label { margin-bottom: 8px; }
.channel-password-form .field-wrap { margin-bottom: 12px; }
.channel-password-submit .button-spinner { width: 14px; height: 14px; }
@keyframes join-fade-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes join-title-in { from { opacity: 0; letter-spacing: -.02em; transform: translateY(18px) scale(.98); } to { opacity: 1; letter-spacing: -.075em; transform: translateY(0) scale(1); } }
@keyframes join-accent-breathe { 0%, 100% { transform: translateY(0); text-shadow: 0 0 0 rgba(0, 106, 100, 0); } 50% { transform: translateY(-2px); text-shadow: 0 5px 18px rgba(0, 106, 100, .16); } }
@keyframes join-accent-breathe-dark { 0%, 100% { transform: translateY(0); text-shadow: 0 0 8px rgba(125, 255, 174, .28), 0 0 18px rgba(105, 210, 199, .14); } 50% { transform: translateY(-2px); text-shadow: 0 0 13px rgba(125, 255, 174, .5), 0 0 26px rgba(105, 210, 199, .22); } }
@keyframes join-dot-pulse { 0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(144, 246, 145, .28); } 50% { transform: scale(1.18); box-shadow: 0 0 0 6px rgba(144, 246, 145, 0); } }
.join-page .join-header { animation: join-fade-up .55s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .join-copy .eyebrow { animation: join-fade-up .55s .08s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .join-copy h1 { animation: join-title-in .78s .16s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .join-copy h1 em { display: inline-block; animation: join-accent-breathe 5s 1.15s ease-in-out infinite; }
.join-page .join-description { animation: join-fade-up .58s .36s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .promise-list { animation: join-fade-up .58s .48s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .promise-item:nth-child(2) { animation: join-fade-up .58s .58s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .promise-item:nth-child(3) { animation: join-fade-up .58s .68s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .visitor-count { animation: join-fade-up .58s .76s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .eyebrow-dot { animation: join-dot-pulse 2.8s .8s ease-in-out infinite; }
.join-page .join-card { animation: join-fade-up .68s .24s cubic-bezier(.22, 1, .36, 1) both; }
.join-page .join-footer { animation: join-fade-up .55s .72s cubic-bezier(.22, 1, .36, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .join-page *, .join-page *::before, .join-page *::after { animation: none !important; transition-duration: .01ms !important; }
}
@media (max-width: 980px) { .app-shell { grid-template-columns: 70px 245px minmax(0, 1fr); }.member-panel { display: none; }.room-hero { min-height: 180px; }.hero-visual { right: 24px; opacity: .55; }.join-content { gap: 40px; }.join-card { padding: 28px; } }
@media (max-width: 740px) { .join-header, .join-content, .join-footer { width: min(100% - 32px, 560px); }.join-header { min-height: 70px; }.header-note { display: none; }.join-content { display: flex; flex-direction: column; align-items: stretch; justify-content: center; gap: 35px; padding: 36px 0 48px; }.join-copy h1 { margin-top: 15px; font-size: 45px; }.join-description { font-size: 14px; }.promise-list { gap: 13px; margin-top: 27px; }.promise-item { min-width: 0; flex: 1 1 30%; }.promise-item small { display: none; }.visitor-count { margin-top: 24px; }.join-card { padding: 24px 20px; }.join-footer { min-height: 53px; }.join-footer .footer-spacer { display: none; }.join-footer span:last-child { margin-left: auto; }.field-grid { grid-template-columns: minmax(0, 1fr) 112px; gap: 8px; }.app-shell { display: block; height: 100dvh; }.nav-rail, .channel-sidebar, .member-panel { display: none; }.workspace { height: 100%; }.workspace-header { min-height: 61px; padding: 0 15px; }.mobile-brand { display: inline; }.crumb-muted, .breadcrumbs > .ui-icon, .breadcrumbs > strong { display: none; }.workspace-actions { gap: 3px; }.disconnect-button { margin-left: 2px; padding-inline: 9px; }.disconnect-button .ui-icon { display: none; }.workspace-content { width: calc(100% - 30px); padding-top: 18px; }.room-hero { min-height: 182px; padding: 23px 21px; }.room-hero h1 { font-size: 22px; }.room-hero p { max-width: 74%; font-size: 11px; }.hero-visual { right: -15px; bottom: 4px; transform: scale(.75); transform-origin: right bottom; }.voice-section, .chat-panel { margin-top: 25px; }.voice-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.voice-card { min-height: 143px; }.message-row { max-width: 92%; }.control-dock { min-height: 66px; padding: 8px 15px; }.dock-user { min-width: 0; }.dock-user > div:last-child { display: none; }.dock-center { flex: 1; justify-content: center; }.mic-mode-switch button { padding: 6px 7px; font-size: 9px; }.ptt-indicator { display: none; }.dock-actions { min-width: 75px; }.settings-modal { max-height: calc(100dvh - 28px); }.settings-nav { display: none; }.settings-content { padding: 24px 20px; }.settings-header { min-height: 62px; padding-inline: 20px; }.settings-header h2 { font-size: 19px; }.settings-footer { min-height: 61px; padding-inline: 20px; } }
@media (max-width: 420px) { .join-copy h1 { font-size: 38px; }.promise-list { display: grid; grid-template-columns: 1fr; }.promise-item small { display: block; }.join-card { border-radius: 15px; }.voice-grid { gap: 8px; }.voice-card { padding-inline: 6px; }.section-counter { display: none; }.workspace-actions .header-action:first-child { display: none; }.dock-icon { display: none; }.dock-actions { min-width: 37px; }.room-stats { gap: 6px; }.room-stats span:last-child, .stat-divider { display: none; } }
.identity-options { margin-top: 8px; color: #677872; font-size: 11px; }
.identity-options summary { width: fit-content; color: #277970; cursor: pointer; }
.identity-options[open] summary { margin-bottom: 10px; }
.cancel-connect-button { justify-self: center; min-height: 32px; padding: 0 10px; color: #6b7d77; background: transparent; font-size: 11px; cursor: pointer; }
.cancel-connect-button:hover { color: #006a64; text-decoration: underline; }
.remember-identity { display: flex; align-items: flex-start; gap: 9px; margin-top: 8px; color: #465650; cursor: pointer; }
.acceleration-choice { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0 2px; padding: 10px 11px; color: #245f58; background: #edf9f5; border: 1px solid #c4e9df; border-radius: 10px; }
.acceleration-choice select { min-width: 150px; max-width: 48%; padding: 8px 28px 8px 10px; color: #245f58; background: #fff; border: 1px solid #b9ded5; border-radius: 8px; font: inherit; font-size: 11px; font-weight: 700; }
.acceleration-copy { min-width: 0; }
.acceleration-choice strong, .acceleration-choice small { display: block; }
.acceleration-choice strong { font-size: 11px; font-weight: 800; }
.acceleration-choice small { margin-top: 3px; color: #6b8c85; font-size: 10px; line-height: 1.45; }
.remember-identity input { width: 16px; height: 16px; flex: 0 0 auto; margin: 1px 0 0; accent-color: #087d74; }
.remember-identity strong, .remember-identity small { display: block; }
.remember-identity strong { font-size: 11px; font-weight: 700; }
.remember-identity small { margin-top: 3px; color: #8b9994; font-size: 10px; line-height: 1.4; }
.identity-warning { margin: 8px 0 0; color: #9a6a32; font-size: 10px; line-height: 1.45; }
:global(html[data-theme="dark"] .acceleration-choice) { color: #b8eee3; background: #183530; border-color: #2b645b; }
:global(html[data-theme="dark"] .acceleration-choice small) { color: #91b9b0; }
:global(html[data-theme="dark"] .acceleration-choice select) { color: #d9f8f1; background: #203f39; border-color: #3b766d; }
.local-servers { display: grid; gap: 8px; margin: 1px 0 5px; }
.local-server-group { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.local-server-group > span { width: 100%; color: #87958f; font-size: 10px; font-weight: 700; }
.local-server-group button, .favorite-toggle { padding: 5px 8px; color: #277970; background: #eef8f5; border: 1px solid #d7ebe6; border-radius: 6px; font-size: 10px; cursor: pointer; }
.local-server-group button:hover, .favorite-toggle:hover { background: #e0f3ee; }
.favorite-toggle { justify-self: start; margin: -1px 0 4px; }
.clear-local-button { padding: 0; color: #85928d; background: transparent; border: 0; font-size: 10px; cursor: pointer; }
.clear-local-button:hover { color: #b14e47; text-decoration: underline; }
.join-page .brand-lockup strong { font-size: 22.5px; }
.join-page .brand-lockup small, .join-page .header-note { font-size: 12.5px; }
.join-page .language-switch { font-size: 12.5px; }
.join-page .eyebrow { font-size: 13.75px; }
.join-page .join-copy h1 { font-size: clamp(52px, 6.6vw, 90px); }
.join-page .join-description { font-size: 21.25px; }
.join-page .promise-item b { font-size: 15px; }
.join-page .promise-item small { font-size: 12.5px; }
.join-page .card-kicker { font-size: 12.5px; }
.join-page .join-card h2 { font-size: 33.75px; }
.join-page .card-lead { font-size: 16.25px; }
.join-page .visitor-count { font-size: 15px; }
.join-page .notice { font-size: 15px; }
.join-page .field-label { font-size: 13.75px; }
.join-page .field-wrap input { font-size: 16.25px; }
.join-page .primary-button { font-size: 15px; }
.join-page .connect-button { font-size: 16.25px; }
.join-page .join-meta, .join-page .join-footer { font-size: 12.5px; }
.join-page { height: 100dvh; min-height: 0; overflow-y: auto; }
.header-tools { align-items: center; }
.header-action, .round-icon { line-height: 0; }
.guide-button { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; color: #006a64; background: #edf7f4; border: 1px solid #d7ebe6; border-radius: 8px; font-size: 12px; font-weight: 700; text-decoration: none; cursor: pointer; }
.guide-button:hover { color: #fff; background: #006a64; border-color: #006a64; }
.workspace-actions .header-action { flex: 0 0 34px; padding: 0; line-height: 0; }
.workspace-actions .header-action .ui-icon { margin: 0; }
@media (max-width: 740px) {
  .header-tools { gap: 7px; }
  .header-note, .github-button span, .qq-button .qq-label, .changelog-button span, .guide-button span { display: none; }
  .github-button { width: 34px; justify-content: center; padding: 0; }
  .qq-button { width: 32px; min-width: 32px; min-height: 32px; justify-content: center; padding: 0; }
  .changelog-button { width: 32px; min-width: 32px; min-height: 32px; padding: 0; }
  .guide-button { width: 32px; justify-content: center; padding: 0; }
}
.join-page { background-color: var(--surface-0); color: var(--text-primary); }
.join-page .join-card { position: relative; }
.join-card { background: color-mix(in srgb, var(--surface-1) 92%, transparent); border-color: var(--border); }
.field-wrap, .message-composer, .member-search, .mic-mode-switch, .mode-note { background: var(--surface-2); }
.field-wrap input, .message-composer input, .member-search input, .settings-select { color: var(--text-primary); }
.section-heading h2, .room-hero h1, .join-card h2, .member-panel-heading h2, .message-meta strong, .member-copy strong { color: var(--text-primary); }
.section-kicker, .card-kicker, .settings-label, .header-note, .section-counter, .message-meta time, .member-copy span, .chat-empty, .join-description, .card-lead { color: var(--text-muted); }
:global(html[data-theme="dark"] .join-page .brand-lockup strong) { color: var(--accent); }
:global(html[data-theme="dark"] .join-page .brand-lockup strong span) { color: var(--text-primary); }
:global(html[data-theme="dark"] .join-page .brand-lockup small),
:global(html[data-theme="dark"] .join-page .header-note),
:global(html[data-theme="dark"] .join-page .join-description),
:global(html[data-theme="dark"] .join-page .promise-item small),
:global(html[data-theme="dark"] .join-page .card-lead),
:global(html[data-theme="dark"] .join-page .field-hint),
:global(html[data-theme="dark"] .join-page .join-meta),
:global(html[data-theme="dark"] .join-page .join-footer) { color: var(--text-muted); }
:global(html[data-theme="dark"] .join-page .visitor-count) { color: #b7fff0; border-color: rgba(105, 210, 199, .42); background: linear-gradient(110deg, #173b36, #1c2d2a); box-shadow: 0 10px 28px rgba(0, 0, 0, .24), inset 0 0 0 1px rgba(105, 210, 199, .08); }
:global(html[data-theme="dark"] .join-page .visitor-count::before) { background: linear-gradient(105deg, transparent, rgba(125, 255, 174, .18), transparent); }
:global(html[data-theme="dark"] .join-page .visitor-count-orbit) { border-color: rgba(105, 210, 199, .34); }
:global(html[data-theme="dark"] .join-page .join-copy h1),
:global(html[data-theme="dark"] .join-page .join-card h2),
:global(html[data-theme="dark"] .join-page .promise-item b),
:global(html[data-theme="dark"] .join-page .field-label) { color: var(--text-primary); }
:global(html[data-theme="dark"] .join-page .join-copy h1 em),
:global(html[data-theme="dark"] .join-page .eyebrow),
:global(html[data-theme="dark"] .join-page .card-kicker),
:global(html[data-theme="dark"] .join-page .field-label span),
:global(html[data-theme="dark"] .join-page .join-footer a) { color: var(--accent); }
:global(html[data-theme="dark"] .join-page .join-card) { background: color-mix(in srgb, var(--surface-1) 94%, transparent); border-color: var(--border); box-shadow: 0 20px 52px color-mix(in srgb, var(--text-primary) 14%, transparent); }
:global(html[data-theme="dark"] .join-page .field-wrap) { color: var(--text-muted); background: var(--surface-2); }
:global(html[data-theme="dark"] .join-page .field-wrap input) { color: var(--text-primary); }
:global(html[data-theme="dark"] .join-page .qq-modal-card) { color: var(--text-primary); border-color: var(--border); background: var(--surface-1); box-shadow: 0 20px 60px color-mix(in srgb, var(--text-primary) 18%, transparent); }
:global(html[data-theme="dark"] .join-page .qq-modal-heading h2) { color: var(--text-primary); }
:global(html[data-theme="dark"] .join-page .qq-direct-join) { color: var(--text-muted); }
:global(html[data-theme="dark"] .join-page .qq-modal-close) { color: var(--text-muted); background: var(--surface-2); border-color: var(--border); }
:global(html[data-theme="dark"] .join-page .qq-join-link) { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface-2)); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
:global(html[data-theme="dark"] .join-page .qq-join-link:hover) { color: var(--surface-1); background: var(--accent); border-color: var(--accent); }
:global(html[data-theme="dark"] .join-page .field-wrap input::placeholder) { color: var(--text-muted); }
:global(html[data-theme="dark"] .join-page .join-footer) { border-top-color: var(--border); }
:global(html[data-theme="dark"] .join-page .join-copy h1) {
  color: #f3fffb;
  text-shadow: 0 1px 0 #07100f, 0 0 9px rgba(243, 255, 251, .16);
}
:global(html[data-theme="dark"] .join-page .join-copy h1 em) {
  color: #7dffae;
  text-shadow: 0 0 10px rgba(125, 255, 174, .38), 0 0 22px rgba(105, 210, 199, .18);
  animation-name: join-accent-breathe-dark;
}
:global(html[data-theme="dark"] .join-page .join-description) {
  color: #c4d9d3;
  text-shadow: 0 0 8px rgba(196, 217, 211, .12);
}
:global(html[data-theme="dark"] .join-page .promise-item b) {
  color: #f0fff9;
  text-shadow: 0 0 7px rgba(240, 255, 249, .14);
}
:global(html[data-theme="dark"] .join-page .promise-item small) {
  color: #a9c6be;
}
:global(html[data-theme="dark"] .join-page .promise-icon) {
  box-shadow: 0 0 12px rgba(105, 210, 199, .14);
}
/* Keep the desktop join card comfortable without making the welcome page
   taller than the browser. Smaller viewports can scroll inside the card. */
@media (min-width: 741px) {
  .join-header { min-height: 72px; }
  .join-content { padding: 28px 0 36px; }
  .join-card { max-height: calc(100dvh - 190px); overflow-y: auto; }
  .join-footer { min-height: 54px; }
}
@media (max-width: 740px) {
  .join-card { max-height: none; overflow: visible; }
}
.join-page { height: 100dvh; min-height: 0; overflow: hidden; }
.join-content { min-height: 0; overflow-y: auto; }
@media (min-width: 851px) {
  :global(html), :global(body) { height: 100dvh; max-height: 100dvh; }
  :global(#app), .web-client, .join-page, .app-shell { height: calc(100dvh / var(--ui-scale)); min-height: 0; max-height: calc(100dvh / var(--ui-scale)); }
  .toast { right: calc(24px / var(--ui-scale)); bottom: calc(24px / var(--ui-scale)); }
  .poke-banner { top: calc(82px / var(--ui-scale)); right: calc(24px / var(--ui-scale)); }
}
@media (max-width: 740px) {
  .join-content { overflow-y: auto; }
  .app-shell { height: 100dvh; min-height: 0; max-height: 100dvh; padding-bottom: calc(74px + env(safe-area-inset-bottom, 0px)); overflow: hidden; }
  .app-shell .workspace { height: auto; min-height: 0; flex: 1 1 auto; }
  .app-shell.mobile-view-channels .workspace { display: none; }
  .app-shell .member-panel.mobile-section-visible { flex: 1 1 auto; min-height: 0; max-height: none; }
  .mobile-more-panel { min-height: 0; max-height: none; margin-bottom: 0; overflow-y: auto; }
}
@media (max-width: 740px) {
  :global(html), :global(body), :global(#app) { height: 100dvh; height: 100svh; min-height: 100dvh; min-height: 100svh; max-height: 100dvh; max-height: 100svh; }
  .web-client { height: 100dvh; height: 100svh; min-height: 100dvh; min-height: 100svh; max-height: 100dvh; max-height: 100svh; }
  .app-shell { height: 100dvh; height: 100svh; min-height: 100dvh; min-height: 100svh; max-height: 100dvh; max-height: 100svh; padding-bottom: calc(74px + env(safe-area-inset-bottom, 0px)); overflow: hidden; }
  .app-shell .workspace { height: calc(100dvh - 74px - env(safe-area-inset-bottom, 0px)); height: calc(100svh - 74px - env(safe-area-inset-bottom, 0px)); min-height: 0; max-height: calc(100dvh - 74px - env(safe-area-inset-bottom, 0px)); max-height: calc(100svh - 74px - env(safe-area-inset-bottom, 0px)); overflow: hidden; }
  .app-shell .workspace-scroll { height: 100%; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
  .workspace-header { min-height: calc(60px + env(safe-area-inset-top, 0px)); padding: env(safe-area-inset-top, 0px) 14px 0; box-sizing: border-box; position: sticky; top: 0; z-index: 6; background: color-mix(in srgb, var(--surface-1) 94%, transparent); backdrop-filter: blur(14px); }
  .breadcrumbs { flex: 1 1 auto; min-width: 0; gap: 6px; font-size: 13px; }
  .breadcrumbs .crumb-muted, .breadcrumbs > .ui-icon { display: none; }
  .mobile-brand { display: inline; font-size: 18px; }
  .workspace-actions { flex: 0 0 auto; gap: 3px; }
  .workspace-actions .header-action { width: 36px; height: 36px; flex-basis: 36px; }
  .workspace-actions .theme-toggle, .workspace-actions .workspace-language { display: none; }
  .disconnect-button { width: 36px; height: 36px; min-height: 36px; margin-left: 0; padding: 0; justify-content: center; }
  .disconnect-button .ui-icon { display: block; margin: 0; }
  .disconnect-button span { display: none; }
  .workspace-content { display: block; width: 100%; max-width: none; min-height: 100%; margin: 0; padding: 14px 14px calc(18px + env(safe-area-inset-bottom, 0px)); box-sizing: border-box; }
  .room-hero { min-height: 152px; padding: 22px 20px; border-radius: 18px; }
  .room-hero h1 { margin-top: 14px; font-size: 25px; }
  .room-hero p { max-width: 72%; font-size: 12px; }
  .room-stats { margin-top: 15px; font-size: 11px; }
  .hero-visual { right: -28px; bottom: -2px; transform: scale(.72); transform-origin: right bottom; }
  .voice-section { margin-top: 21px; }
  .section-heading { gap: 10px; }
  .section-heading h2 { font-size: 22px; }
  .voice-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
  .voice-card { position: relative; min-height: 136px; padding: 18px 8px 14px; border-radius: 16px; }
  .voice-avatar-wrap, .voice-avatar { width: 60px; height: 60px; }
  .voice-avatar-wrap { margin-bottom: 10px; }
  .voice-avatar { font-size: 18px; }
  .voice-status { width: 21px; height: 21px; }
  .app-shell .voice-card > strong { max-width: 100%; font-size: 14px; }
  .app-shell .voice-card > span { margin-top: 4px; font-size: 11px; }
  .voice-member-action { position: absolute; top: 7px; right: 7px; display: grid; place-items: center; width: 34px; height: 34px; color: var(--text-muted); background: color-mix(in srgb, var(--surface-2) 78%, transparent); border-radius: 10px; cursor: pointer; }
  .voice-member-action:hover, .voice-member-action:active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface-1)); }
  .mobile-voice-controls { display: flex; align-items: stretch; gap: 8px; margin-top: 14px; padding: 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px; }
  .mobile-voice-toggle, .mobile-voice-settings { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; min-width: 0; padding: 0 11px; color: var(--accent); background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
  .mobile-voice-toggle { flex: 1 1 auto; }
  .mobile-voice-toggle.muted, .mobile-more-panel button.muted { color: var(--danger); }
  .mobile-voice-settings { flex: 0 0 auto; width: 82px; }
  .mobile-voice-settings span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .app-shell .member-panel.mobile-section-visible { display: flex !important; flex: 1 1 auto; width: 100%; height: auto; min-height: 0; max-height: none; padding: 18px 14px 16px; border-top: 0; border-right: 0; overflow: hidden; }
  .member-panel-heading { flex: 0 0 auto; }
  .member-panel-heading h2 { font-size: 23px; }
  .status-button { min-height: 34px; padding-inline: 10px; font-size: 12px; }
  .member-search { flex: 0 0 auto; min-height: 44px; margin-top: 14px; padding: 0 12px; border-radius: 11px; }
  .member-search input { font-size: 15px; }
  .app-shell .member-panel .member-tree { flex: 1 1 auto; min-height: 0; max-height: none; margin-top: 12px; padding: 0 2px 4px 0; overflow-y: auto; scrollbar-gutter: stable; }
  .member-channel-group { padding: 7px 0 12px; }
  .member-channel-heading { min-height: 44px; padding: 0 9px; border-radius: 11px; font-size: 14px; }
  .member-channel-heading small { font-size: 12px; }
  .member-list { gap: 3px; margin-top: 5px; }
  .member-row { min-height: 58px; margin: 0; padding: 7px 7px; gap: 9px; border-radius: 12px; }
  .member-avatar { width: 40px; height: 40px; border-radius: 12px; font-size: 12px; }
  .member-presence { width: 10px; height: 10px; }
  .member-copy strong { font-size: 14px; }
  .member-copy span { margin-top: 3px; font-size: 12px; }
  .desktop-audio-dock, .member-flags, .member-volume, .member-panel-tip { display: none; }
  .member-action-button { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 38px; color: var(--text-muted); background: transparent; border-radius: 10px; cursor: pointer; }
  .member-action-button:hover, .member-action-button:active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface-1)); }

  .app-shell.mobile-view-chat .workspace-scroll { overflow: hidden; }
  .app-shell.mobile-view-chat .workspace-content { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 0 14px calc(8px + env(safe-area-inset-bottom, 0px)); }
  .app-shell.mobile-view-chat .chat-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; margin-top: 0; padding: 0; border-top: 0; }
  .app-shell.mobile-view-chat .chat-tabs { flex: 0 0 auto; margin-top: 0; padding: 10px 0 9px; border-bottom: 1px solid var(--border); scrollbar-width: none; }
  .app-shell.mobile-view-chat .chat-tabs::-webkit-scrollbar { display: none; }
  .app-shell.mobile-view-chat .chat-heading { flex: 0 0 auto; padding: 13px 0 9px; }
  .app-shell.mobile-view-chat .chat-heading h2 { font-size: 21px; }
  .app-shell.mobile-view-chat .message-list { flex: 1 1 auto; min-height: 0; max-height: none; padding: 10px 2px 16px; overflow-y: auto; overscroll-behavior: contain; }
  .app-shell.mobile-view-chat .message-row { max-width: 94%; gap: 9px; }
  .app-shell.mobile-view-chat .message-avatar { width: 36px; height: 36px; }
  .app-shell.mobile-view-chat .message-meta strong { font-size: 12px; }
  .app-shell.mobile-view-chat .message-bubble { padding: 10px 12px; font-size: 14px; }
  .app-shell.mobile-view-chat .message-composer { position: relative; flex: 0 0 auto; min-height: 54px; margin: 0 0 4px; padding: 7px 8px 7px 13px; border: 1px solid var(--border); }
  .app-shell.mobile-view-chat .message-composer input { font-size: 14px; }

  .mobile-more-panel { width: calc(100% - 28px); max-height: none; margin: 16px auto 0; padding: 18px; border-radius: 18px; overflow-y: auto; }
  .mobile-more-panel h2 { font-size: 25px; }
  .mobile-more-panel button { min-height: 52px; font-size: 14px; }
  .mobile-nav { min-height: 74px; padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px)); }
  .mobile-nav button { min-height: 52px; font-size: 12px; }

  .member-menu-backdrop { position: fixed; z-index: 39; inset: 0; display: block; background: rgba(13, 29, 26, .38); backdrop-filter: blur(2px); }
  .member-context-menu { z-index: 40; left: 10px !important; right: 10px; top: auto !important; bottom: calc(74px + env(safe-area-inset-bottom, 0px)) !important; min-width: 0; max-height: calc(100svh - 100px); padding: 12px; border-radius: 18px; box-shadow: 0 18px 42px rgba(13, 38, 33, .25); }
  .member-menu-header strong { padding: 4px 8px 11px; font-size: 16px; }
  .member-menu-close { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 36px; padding: 0 !important; color: var(--text-muted); background: var(--surface-2); border-radius: 10px; }
  .member-context-menu button { min-height: 50px; padding: 8px 10px; border-radius: 10px; font-size: 14px; }
  .member-context-menu .member-menu-close { min-height: 36px; }
  .menu-volume { padding: 5px 8px 11px; font-size: 12px; }
  .menu-volume input { height: 7px; }

  .modal-backdrop { align-items: flex-end; padding: 0; }
  .settings-modal { width: 100%; max-height: calc(100svh - env(safe-area-inset-top, 0px)); border-radius: 22px 22px 0 0; }
  .qq-modal-card { width: 100%; max-height: calc(100svh - env(safe-area-inset-top, 0px)); padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px)); border-radius: 22px 22px 0 0; }
  .qq-qr-image { width: min(100%, 330px); max-height: 52svh; }
  .settings-main { min-height: 0; overflow: hidden; }
  .settings-header { min-height: 64px; padding-inline: 18px; }
  .settings-content { min-height: 0; padding: 20px 18px; overflow-y: auto; }
  .settings-footer { min-height: 68px; padding: 8px 18px calc(8px + env(safe-area-inset-bottom, 0px)); }
  .settings-footer .save-button { min-height: 48px; }
  .microphone-control { align-items: stretch; flex-direction: column; gap: 10px; }
  .microphone-control .settings-hint { max-width: none; }
  .microphone-toggle { width: 100%; min-height: 44px; }

  .join-page { height: 100dvh; height: 100svh; min-height: 100dvh; min-height: 100svh; max-height: 100dvh; max-height: 100svh; }
  .join-header { min-height: calc(62px + env(safe-area-inset-top, 0px)); padding-top: env(safe-area-inset-top, 0px); box-sizing: border-box; }
  .join-content { align-items: stretch; justify-content: flex-start; gap: 24px; width: min(100% - 28px, 560px); padding: 24px 0 28px; overflow-y: auto; }
  .join-copy h1 { margin: 14px 0 14px; font-size: clamp(40px, 12vw, 58px); }
  .join-description { font-size: 15px; line-height: 1.65; }
  .promise-list { margin-top: 23px; }
  .join-card { padding: 22px 18px; border-radius: 18px; }
  .join-card h2 { font-size: 25px; }
  .field-grid { grid-template-columns: minmax(0, 1fr) 112px; }
  .join-footer { width: min(100% - 28px, 560px); }
}
@media (max-width: 390px) {
  .join-page .header-tools { gap: 4px; }
  .join-page .github-button, .join-page .changelog-button, .join-page .guide-button { width: 32px; min-width: 32px; min-height: 32px; height: 32px; }
  .join-page .version-badge { min-height: 32px; padding-inline: 6px; font-size: 10px; }
  .join-page .language-switcher { min-width: 62px; }
  .workspace-header { padding-inline: 10px; }
  .workspace-actions .header-action { width: 32px; height: 32px; flex-basis: 32px; }
  .disconnect-button { width: 32px; height: 32px; }
  .room-hero { padding-inline: 16px; }
  .mobile-voice-settings { width: 56px; padding-inline: 4px; }
  .mobile-voice-toggle { flex: 0 0 44px; padding-inline: 0; }
  .mobile-voice-toggle span { display: none; }
  .mobile-voice-settings span { display: none; }
  .join-content { gap: 18px; }
  .join-card { padding-inline: 15px; }
}
@media (max-width: 420px) {
  .join-page .join-header { width: calc(100% - 20px); gap: 6px; }
  .join-page .brand-lockup { min-width: 0; flex: 1 1 auto; gap: 7px; }
  .join-page .brand-mark { width: 32px; height: 32px; border-radius: 9px; }
  .join-page .brand-lockup strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
  .join-page .brand-lockup small { display: none; }
  .join-page .header-tools { min-width: 0; flex: 0 0 auto; gap: 2px; }
  .join-page .header-tools .theme-toggle { display: none; }
  .join-page .github-button, .join-page .bilibili-button, .join-page .changelog-button, .join-page .guide-button { width: 28px; min-width: 28px; min-height: 28px; height: 28px; padding: 0; }
  .join-page .github-button, .join-page .bilibili-button, .join-page .changelog-button, .join-page .guide-button { justify-content: center; }
  .join-page .github-button .ui-icon { width: 16px; height: 16px; }
  .join-page .bilibili-glyph { width: 18px; height: 18px; }
  .join-page .version-badge { min-width: 28px; min-height: 28px; padding-inline: 4px; font-size: 9px; }
  .join-page .language-switcher { min-width: 58px; }
}
@media (max-width: 360px) {
  .join-page .brand-lockup > div { display: none; }
  .join-page .brand-lockup { flex: 0 0 32px; }
}
.bilibili-button { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 10px; color: #e56b91; background: #fff0f5; border: 1px solid #f6d2df; border-radius: 8px; font-size: 11px; font-weight: 800; text-decoration: none; transition: .18s; }
.bilibili-button:hover { color: #fff; background: #e56b91; border-color: #e56b91; box-shadow: 0 7px 16px rgba(229,107,145,.2); transform: translateY(-1px); }
.bilibili-glyph { display: grid; place-items: center; width: 18px; height: 18px; color: #fff; background: #e56b91; border-radius: 5px; font-size: 11px; line-height: 1; }
.bilibili-button:hover .bilibili-glyph { color: #e56b91; background: #fff; }
.qq-button { display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 10px; color: #1684b8; background: #eef9ff; border: 1px solid #cdeafa; border-radius: 8px; font-size: 11px; font-weight: 800; cursor: pointer; transition: .18s; }
.qq-button:hover { color: #fff; background: #168fca; border-color: #168fca; box-shadow: 0 7px 16px rgba(22,143,202,.2); transform: translateY(-1px); }
.qq-button .ui-icon { color: #168fca; }
.qq-button:hover .ui-icon { color: #fff; }
@media (max-width: 740px) {
  .bilibili-button { width: 32px; min-width: 32px; min-height: 32px; justify-content: center; padding: 0; }
  .bilibili-button .bilibili-label { display: none; }
  .qq-button { width: 32px; min-width: 32px; min-height: 32px; justify-content: center; padding: 0; }
  .qq-button .qq-label { display: none; }
}
@media (max-width: 390px) {
  .join-page .bilibili-button { width: 32px; min-width: 32px; min-height: 32px; height: 32px; }
}
@media (max-width: 420px) {
  .join-page .bilibili-button { width: 28px; min-width: 28px; min-height: 28px; height: 28px; padding: 0; }
  .join-page .qq-button { width: 28px; min-width: 28px; min-height: 28px; height: 28px; padding: 0; }
}
.web-client.language-en .join-page .brand-lockup strong,
.web-client.language-de .join-page .brand-lockup strong { font-size: 19.8px; }
.web-client.language-en .join-page .brand-lockup small,
.web-client.language-en .join-page .header-note,
.web-client.language-de .join-page .brand-lockup small,
.web-client.language-de .join-page .header-note { font-size: 11px; }
.web-client.language-en .join-page .github-button,
.web-client.language-en .join-page .qq-button,
.web-client.language-en .join-page .bilibili-button,
.web-client.language-en .join-page .changelog-button,
.web-client.language-en .join-page .guide-button,
.web-client.language-de .join-page .github-button,
.web-client.language-de .join-page .qq-button,
.web-client.language-de .join-page .bilibili-button,
.web-client.language-de .join-page .changelog-button,
.web-client.language-de .join-page .guide-button { font-size: 9.7px; }
.web-client.language-en .join-page .eyebrow,
.web-client.language-de .join-page .eyebrow { font-size: 12px; }
.web-client.language-en .join-page .join-copy h1,
.web-client.language-de .join-page .join-copy h1 { font-size: clamp(46px, 5.8vw, 79px); }
.web-client.language-en .join-page .join-description,
.web-client.language-de .join-page .join-description { font-size: 18px; }
.web-client.language-en .join-page .promise-item b,
.web-client.language-de .join-page .promise-item b { font-size: 13.2px; }
.web-client.language-en .join-page .promise-item small,
.web-client.language-de .join-page .promise-item small { font-size: 11px; }
.web-client.language-en .join-page .card-kicker,
.web-client.language-de .join-page .card-kicker { font-size: 11px; }
.web-client.language-en .join-page .join-card h2,
.web-client.language-de .join-page .join-card h2 { font-size: 29.7px; }
.web-client.language-en .join-page .card-lead,
.web-client.language-de .join-page .card-lead { font-size: 14.3px; }
.web-client.language-en .join-page .notice,
.web-client.language-de .join-page .notice { font-size: 13.2px; }
.web-client.language-en .join-page .field-label,
.web-client.language-de .join-page .field-label { font-size: 12px; }
.web-client.language-en .join-page .field-wrap input,
.web-client.language-de .join-page .field-wrap input { font-size: 14.3px; }
.web-client.language-en .join-page .primary-button,
.web-client.language-de .join-page .primary-button { font-size: 13.2px; }
.web-client.language-en .join-page .connect-button,
.web-client.language-de .join-page .connect-button { font-size: 14.3px; }
.web-client.language-en .join-page .join-meta,
.web-client.language-en .join-page .join-footer,
.web-client.language-de .join-page .join-meta,
.web-client.language-de .join-page .join-footer { font-size: 11px; }
@media (max-width: 740px) {
  .web-client.language-en .join-page .join-copy h1,
  .web-client.language-de .join-page .join-copy h1 { font-size: clamp(35px, 10.6vw, 51px); }
  .web-client.language-en .join-page .join-description,
  .web-client.language-de .join-page .join-description { font-size: 13.2px; }
  .web-client.language-en .join-page .join-card h2,
  .web-client.language-de .join-page .join-card h2 { font-size: 22px; }
  .web-client.language-en .join-page .card-lead,
  .web-client.language-de .join-page .card-lead { font-size: 13px; }
}
@media (max-width: 420px) {
  .web-client.language-en .join-page .brand-lockup strong,
  .web-client.language-de .join-page .brand-lockup strong { font-size: 13.2px; }
}
</style>
