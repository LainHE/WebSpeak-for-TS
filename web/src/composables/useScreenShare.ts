import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { Ref } from "vue";
import type { ChannelMember, ScreenShareOutputSettings, ScreenShareStream } from "./useVoiceWebSocket.js";

type VoiceApi = ReturnType<typeof import("./useVoiceWebSocket.js").useVoiceWebSocket>;

export function useScreenShare(options: {
  screenShareStreams: VoiceApi["screenShareStreams"];
  screenShareActive: VoiceApi["screenShareActive"];
  screenShareStarting: VoiceApi["screenShareStarting"];
  screenShareViewing: VoiceApi["screenShareViewing"];
  screenShareViewingStreamId: VoiceApi["screenShareViewingStreamId"];
  screenShareRemoteStream: VoiceApi["screenShareRemoteStream"];
  screenShareError: VoiceApi["screenShareError"];
  screenShareErrorCode: VoiceApi["screenShareErrorCode"];
  screenShareRemoteVolume: VoiceApi["screenShareRemoteVolume"];
  startAccompaniment: VoiceApi["startAccompaniment"];
  stopAccompaniment: VoiceApi["stopAccompaniment"];
  accompanimentActive: VoiceApi["accompanimentActive"];
  accompanimentErrorCode: VoiceApi["accompanimentErrorCode"];
  startScreenShare: VoiceApi["startScreenShare"];
  stopScreenShare: VoiceApi["stopScreenShare"];
  joinScreenShare: VoiceApi["joinScreenShare"];
  leaveScreenShare: VoiceApi["leaveScreenShare"];
  t: (key: string, variables?: Record<string, string | number>) => string;
  localizedMessage: (message: string) => string;
  showToast: (message: string) => void;
  avatarStyle: (name: string, isSelf?: boolean, avatar?: string) => { backgroundImage?: string; backgroundPosition?: string; backgroundSize?: string; background: string };
  nickname: Ref<string>;
}) {
  const { screenShareStreams, screenShareActive, screenShareStarting, screenShareViewing, screenShareViewingStreamId, screenShareRemoteStream, screenShareError, screenShareErrorCode, screenShareRemoteVolume, startAccompaniment, stopAccompaniment, accompanimentActive, accompanimentErrorCode, startScreenShare, stopScreenShare, joinScreenShare, leaveScreenShare, t, localizedMessage, showToast, avatarStyle, nickname } = options;

const screenVideoEl = ref<HTMLVideoElement | null>(null);
const screenSharePlayerEl = ref<HTMLElement | null>(null);
const screenShareFullscreen = ref(false);
type ScreenShareResolutionPreset = "source" | "720p" | "1080p";
const screenShareResolutionOptions: Array<{ value: ScreenShareResolutionPreset; width?: number; height?: number; label: string }> = [
  { value: "source", label: "screenShareResolutionSource" },
  { value: "720p", width: 1280, height: 720, label: "screenShareResolution720p" },
  { value: "1080p", width: 1920, height: 1080, label: "screenShareResolution1080p" },
];
const screenShareFrameRateOptions = [5, 10, 15, 24, 30, 60];
const storedScreenShareResolution = localStorage.getItem("webspeak:screen-share-resolution") as ScreenShareResolutionPreset | null;
const screenShareResolutionPreset = ref<ScreenShareResolutionPreset>(screenShareResolutionOptions.some((option) => option.value === storedScreenShareResolution) ? storedScreenShareResolution! : "1080p");
const storedScreenShareFrameRate = Number(localStorage.getItem("webspeak:screen-share-framerate"));
const screenShareFrameRate = ref(screenShareFrameRateOptions.includes(storedScreenShareFrameRate) ? storedScreenShareFrameRate : 15);
const screenShareSettingsOpen = ref(false);
function setScreenVideoElement(element: unknown): void {
  screenVideoEl.value = element instanceof HTMLVideoElement ? element : null;
}
const screenShareIndicatorBars = [5, 10, 7, 12, 8, 10];

const screenShareErrorText = computed(() => {
  if (screenShareErrorCode.value === "SCREEN_SHARE_NATIVE_BRIDGE_REQUIRED") return t("screenShareNativeUnavailable");
  return screenShareError.value;
});
const activeScreenShareStream = computed<ScreenShareStream | null>(() => screenShareStreams.find((stream) => stream.streamId === screenShareViewingStreamId.value) ?? null);
const screenSharePlayerViewers = computed(() => activeScreenShareStream.value?.viewers.slice(-5) ?? []);
const screenSharePlayerViewerCount = computed(() => activeScreenShareStream.value?.viewerCount ?? activeScreenShareStream.value?.viewers.length ?? 0);
const screenSharePlayerOwnerName = computed(() => activeScreenShareStream.value?.ownerNickname ?? t("screenShare"));
function screenShareStreamForMember(member: ChannelMember): ScreenShareStream | null {
  return screenShareStreams.find((stream) => {
    if (typeof stream.ownerClientId === "number" && stream.ownerClientId === member.id) return true;
    if (stream.source === "teamspeak" && stream.ownerPeerId === `ts-${member.id}`) return true;
    return stream.ownerNickname === member.nickname;
  }) ?? null;
}
function toggleScreenShareForMember(member: ChannelMember): void {
  const stream = screenShareStreamForMember(member);
  if (!stream) return;
  if (screenShareViewingStreamId.value === stream.streamId) leaveScreenShare();
  else joinScreenShare(stream.streamId);
}
function screenShareViewerStyle(viewer: { nickname: string; avatar?: string }) {
  return avatarStyle(viewer.nickname, viewer.nickname === nickname.value, viewer.avatar ?? "");
}
watch([screenShareRemoteStream, screenShareRemoteVolume], ([stream, volume]) => {
  void nextTick(() => {
    const video = screenVideoEl.value;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.volume = Math.max(0, Math.min(1, volume ?? 1));
    if (stream) void video.play().catch(() => undefined);
  });
});
watch(screenShareViewing, (viewing) => {
  if (!viewing && document.fullscreenElement === screenSharePlayerEl.value) void document.exitFullscreen().catch(() => undefined);
});
function onScreenShareVolume(event: Event): void {
  screenShareRemoteVolume.value = Math.max(0, Math.min(1, Number((event.target as HTMLInputElement).value) / 100));
}

function syncScreenShareFullscreen(): void {
  screenShareFullscreen.value = document.fullscreenElement === screenSharePlayerEl.value;
}

async function toggleScreenShareFullscreen(): Promise<void> {
  const player = screenSharePlayerEl.value;
  if (!player) return;
  try {
    if (document.fullscreenElement === player) await document.exitFullscreen();
    else if (player.requestFullscreen) await player.requestFullscreen();
  } catch {
    screenShareFullscreen.value = false;
  }
}

async function startScreenShareWithSettings(): Promise<void> {
  const preset = screenShareResolutionOptions.find((option) => option.value === screenShareResolutionPreset.value);
  const settings: ScreenShareOutputSettings = {
    ...(preset?.width && preset.height ? { maxWidth: preset.width, maxHeight: preset.height } : {}),
    maxFrameRate: screenShareFrameRate.value,
  };
  localStorage.setItem("webspeak:screen-share-resolution", screenShareResolutionPreset.value);
  localStorage.setItem("webspeak:screen-share-framerate", String(screenShareFrameRate.value));
  screenShareSettingsOpen.value = false;
  await startScreenShare(true, settings);
}

async function toggleAccompaniment(): Promise<void> {
  try {
    if (accompanimentActive.value) {
      await stopAccompaniment();
      showToast(t("accompanimentStopped"));
      return;
    }
    await startAccompaniment();
    if (accompanimentActive.value) showToast(t("accompanimentStarted"));
  } catch {
    const messageKey = accompanimentErrorCode.value === "needsWebRtc"
      ? "accompanimentNeedsWebRtc"
      : accompanimentErrorCode.value === "noAudio"
        ? "accompanimentNoAudio"
        : accompanimentErrorCode.value === "unsupported"
          ? "accompanimentUnsupported"
          : "accompanimentPermissionDenied";
    showToast(t(messageKey));
  }
}


  let fullscreenChangeHandler: (() => void) | undefined;

  onMounted(() => {
    fullscreenChangeHandler = syncScreenShareFullscreen;
    document.addEventListener("fullscreenchange", fullscreenChangeHandler);
  });
  onUnmounted(() => {
    if (fullscreenChangeHandler) document.removeEventListener("fullscreenchange", fullscreenChangeHandler);
  });

  return { screenVideoEl, screenSharePlayerEl, screenShareFullscreen, screenShareResolutionOptions, screenShareFrameRateOptions, screenShareResolutionPreset, screenShareFrameRate, screenShareSettingsOpen, setScreenVideoElement, screenShareIndicatorBars, screenShareErrorText, activeScreenShareStream, screenSharePlayerViewers, screenSharePlayerViewerCount, screenSharePlayerOwnerName, screenShareStreamForMember, toggleScreenShareForMember, screenShareViewerStyle, onScreenShareVolume, toggleScreenShareFullscreen, startScreenShareWithSettings, toggleAccompaniment };
}
