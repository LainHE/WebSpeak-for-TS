import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { Ref } from "vue";

type VoiceApi = ReturnType<typeof import("./useVoiceWebSocket.js").useVoiceWebSocket>;

export function useAudioSettings(options: {
  volumes: VoiceApi["volumes"];
  setVolume: VoiceApi["setVolume"];
  setInputVolume: VoiceApi["setInputVolume"];
  setNoiseSuppressionEnabled: VoiceApi["setNoiseSuppressionEnabled"];
  setOutputVolume: VoiceApi["setOutputVolume"];
  setVoxThreshold: VoiceApi["setVoxThreshold"];
  setNotificationVolume: VoiceApi["setNotificationVolume"];
  setInputDevice: VoiceApi["setInputDevice"];
  setOutputDevice: VoiceApi["setOutputDevice"];
  prepareInputDevices: VoiceApi["prepareInputDevices"];
  refreshAudioDevices: VoiceApi["refreshAudioDevices"];
  startMicrophoneTest: VoiceApi["startMicrophoneTest"];
  stopMicrophoneTest: VoiceApi["stopMicrophoneTest"];
  microphoneTestActive: VoiceApi["microphoneTestActive"];
  micLevel: VoiceApi["micLevel"];
  microphoneMuted: VoiceApi["microphoneMuted"];
  setMicrophoneMuted: VoiceApi["setMicrophoneMuted"];
  t: (key: string, variables?: Record<string, string | number>) => string;
  localizedMessage: (message: string) => string;
  showToast: (message: string) => void;
}) {
  const { volumes, setVolume, setInputVolume, setNoiseSuppressionEnabled, setOutputVolume, setVoxThreshold, setNotificationVolume, setInputDevice, setOutputDevice, prepareInputDevices, refreshAudioDevices, startMicrophoneTest, stopMicrophoneTest, microphoneTestActive, micLevel, microphoneMuted, setMicrophoneMuted, t, localizedMessage, showToast } = options;

const settingsOpen = ref(false);
const audioSettingsError = ref("");
watch(settingsOpen, (open) => {
  if (open) {
    audioSettingsError.value = "";
    prepareInputDevices().catch((error: unknown) => {
      audioSettingsError.value = microphoneErrorMessage(error);
    });
  } else {
    stopMicrophoneTest();
  }
});
function onVolInput(clientId: number, event: Event) {
  setVolume(clientId, Number((event.target as HTMLInputElement).value) / 100);
}

function onInputVolume(event: Event) {
  setInputVolume(Number((event.target as HTMLInputElement).value) / 100);
}

function onNoiseSuppressionToggle(event: Event) {
  void setNoiseSuppressionEnabled((event.target as HTMLInputElement).checked);
}

function onOutputVolume(event: Event) {
  setOutputVolume(Number((event.target as HTMLInputElement).value) / 100);
}

function onVoxThreshold(event: Event) {
  setVoxThreshold(Number((event.target as HTMLInputElement).value) / 1000);
}

function onNotificationVolume(event: Event) {
  setNotificationVolume(Number((event.target as HTMLInputElement).value) / 100);
}

async function onInputDeviceChange(event: Event) {
  audioSettingsError.value = "";
  try {
    await setInputDevice((event.target as HTMLSelectElement).value);
  } catch (error: unknown) {
    audioSettingsError.value = microphoneErrorMessage(error, "无法切换麦克风");
  }
}

async function onOutputDeviceChange(event: Event) {
  audioSettingsError.value = "";
  try {
    await setOutputDevice((event.target as HTMLSelectElement).value);
  } catch (error: unknown) {
    audioSettingsError.value = localizedMessage(error instanceof Error ? error.message : "无法切换扬声器");
  }
}

async function toggleMicTest() {
  audioSettingsError.value = "";
  try {
    if (microphoneTestActive.value) stopMicrophoneTest();
    else await startMicrophoneTest();
  } catch (error: unknown) {
    audioSettingsError.value = microphoneErrorMessage(error);
  }
}

function microphoneErrorMessage(error: unknown, fallback = "请检查浏览器权限") {
  const name = error instanceof DOMException ? error.name : "";
  const reasons: Record<string, string> = {
    NotAllowedError: "浏览器未授予麦克风权限",
    NotFoundError: "未找到可用的麦克风",
    NotReadableError: "麦克风可能正被其他程序占用",
    OverconstrainedError: "所选麦克风当前不可用",
    SecurityError: "浏览器阻止了麦克风访问",
  };
  return `麦克风访问失败：${reasons[name] ?? fallback}`;
}

const micMeterBars = computed(() => Math.round(micLevel.value * 24));
function meterBarHeight(index: number) {
  if (!microphoneTestActive.value) return 5;
  const intensity = Math.max(0, micLevel.value - (index / 24) * 0.65);
  return 5 + Math.round(intensity * 34);
}

function toggleMicrophone(): void {
  setMicrophoneMuted(!microphoneMuted.value);
  showToast(microphoneMuted.value ? t("microphoneMuted") : t("microphoneActive"));
}


  let deviceChangeHandler: (() => void) | undefined;

  onMounted(() => {
    deviceChangeHandler = () => { void refreshAudioDevices().catch(() => undefined); };
    navigator.mediaDevices?.addEventListener("devicechange", deviceChangeHandler);
  });
  onUnmounted(() => {
    if (deviceChangeHandler) navigator.mediaDevices?.removeEventListener("devicechange", deviceChangeHandler);
  });

  return { settingsOpen, audioSettingsError, onVolInput, onInputVolume, onNoiseSuppressionToggle, onOutputVolume, onVoxThreshold, onNotificationVolume, onInputDeviceChange, onOutputDeviceChange, toggleMicTest, microphoneErrorMessage, micMeterBars, meterBarHeight, toggleMicrophone };
}
