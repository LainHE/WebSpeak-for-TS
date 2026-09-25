import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import { loadLocalPreferences, saveLocalPreferences } from "../../services/local-persistence.js";
import { AUDIO_FRAME_SAMPLES, MAX_AUDIO_BUFFERED_BYTES, MAX_REMOTE_DECODE_QUEUE_FRAMES, MAX_REMOTE_PLAY_AHEAD_SECONDS, SPEAKING_HOLD_MS, VOX_ATTACK_FRAMES, VOX_HOLD, micCaptureWorkletUrl } from "./constants.js";
import { normalizeMicrophoneFailure, safeClientErrorCode } from "./errors.js";
import type { AudioOutputDevice, ChannelMember } from "./types.js";

type SinkAudioContext = AudioContext & {
  sinkId?: string;
  setSinkId?: (sinkId: string) => Promise<void>;
};

type SinkAudioElement = HTMLAudioElement & {
  sinkId?: string;
};

export function setupAudioEngine(vc: any) {

  async function saveAudioPreferences(): Promise<void> {
    await saveLocalPreferences({
      schemaVersion: 1,
      preferredInputDeviceId: vc.selectedInputDeviceId.value,
      inputDeviceId: vc.selectedInputDeviceId.value,
      microphoneMuted: vc.microphoneMuted.value,
      noiseSuppressionEnabled: vc.noiseSuppressionEnabled.value,
      voxThreshold: vc.voxThreshold.value,
      inputGain: vc.inputVolume.value,
      outputVolume: vc.outputVolume.value,
      notificationVolume: vc.notificationVolume.value,
      preferredOutputDeviceId: vc.selectedOutputDeviceId.value,
      volumesByUid: { ...vc.storedVolumesByUid },
    });
  }

  function syncKnownMemberVolumes(): void {
    for (const member of vc.members) {
      if (!member.uid) continue;
      const saved = vc.storedVolumesByUid[member.uid];
      if (saved !== undefined) vc.volumes[member.id] = Math.max(0, Math.min(4, saved));
    }
  }

  vc.audioPreferencesReady = loadLocalPreferences().then((preferences) => {
    if (!vc.selectedInputDeviceId.value) vc.selectedInputDeviceId.value = preferences.preferredInputDeviceId ?? preferences.inputDeviceId ?? "";
    if (typeof preferences.microphoneMuted === "boolean") vc.microphoneMuted.value = preferences.microphoneMuted;
    if (typeof preferences.noiseSuppressionEnabled === "boolean") vc.noiseSuppressionEnabled.value = preferences.noiseSuppressionEnabled;
    if (typeof preferences.voxThreshold === "number") vc.voxThreshold.value = clamp(preferences.voxThreshold, 0.001, 0.08);
    if (typeof preferences.inputGain === "number") vc.inputVolume.value = Math.max(0, Math.min(1, preferences.inputGain));
    if (typeof preferences.outputVolume === "number") vc.outputVolume.value = Math.max(0, Math.min(1, preferences.outputVolume));
    if (!vc.selectedOutputDeviceId.value) vc.selectedOutputDeviceId.value = preferences.preferredOutputDeviceId ?? "";
    if (typeof preferences.notificationVolume === "number") vc.notificationVolume.value = clamp(preferences.notificationVolume, 0, 1);
    Object.assign(vc.storedVolumesByUid, preferences.volumesByUid ?? {});
    syncKnownMemberVolumes();
  });

  function markSpeaking(clientId: number): void {
    if (!clientId) return;
    vc.speakingIds.add(clientId);
    const previous = vc.speakingTimers.get(clientId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      vc.speakingIds.delete(clientId);
      vc.speakingTimers.delete(clientId);
    }, SPEAKING_HOLD_MS);
    vc.speakingTimers.set(clientId, timer);
  }

  function clearSpeaking(clientId: number): void {
    const timer = vc.speakingTimers.get(clientId);
    if (timer) clearTimeout(timer);
    vc.speakingTimers.delete(clientId);
    vc.speakingIds.delete(clientId);
  }

  function clearSpeakingState(): void {
    for (const timer of vc.speakingTimers.values()) clearTimeout(timer);
    vc.speakingTimers.clear();
    vc.speakingIds.clear();
  }

  function effectiveOutputVolume(): number {
    return vc.outputMuted.value ? 0 : vc.outputVolume.value;
  }

  function applyOutputVolume(): void {
    const level = effectiveOutputVolume();
    for (const [clientId, gain] of vc.remoteGains) gain.gain.value = (vc.volumes[clientId] ?? 1) * level;
    if (vc.webrtcOutputElement) vc.webrtcOutputElement.volume = level;
  }

  function getAudioCtx(): SinkAudioContext {
    if (!vc.audioCtx) {
      vc.audioCtx = new AudioContext({ sampleRate: 48000 }) as SinkAudioContext;
      vc.audioContextState.value = vc.audioCtx.state;
      vc.audioCtx.addEventListener("statechange", () => {
        if (vc.audioCtx) vc.audioContextState.value = vc.audioCtx.state;
      });
      vc.outputDeviceSupported.value = typeof vc.audioCtx.setSinkId === "function"
        || typeof (HTMLMediaElement.prototype as SinkAudioElement).setSinkId === "function";
      if (vc.selectedOutputDeviceId.value && vc.outputDeviceSupported.value) {
        void setAudioSink(vc.audioCtx, vc.selectedOutputDeviceId.value).catch(() => undefined);
      }
    }
    return vc.audioCtx;
  }

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }

  /**
   * Microphone failures are a degraded vc.state, not a connection failure: the room
   * stays joined, so they get their own slot instead of taking over `error`.
   */
  function setMicrophoneError(error: unknown): string {
    const failure = normalizeMicrophoneFailure(error);
    vc.state.microphoneErrorCode = failure.code;
    vc.state.microphoneError = failure.message;
    return failure.message;
  }

  function clearMicrophoneError(): void {
    vc.state.microphoneError = "";
    vc.state.microphoneErrorCode = "";
  }

  /** Non-fatal audio notice (WebRTC fallback, blocked autoplay, device list failure...). */
  function setAudioNotice(code: string, message: string): void {
    vc.state.audioNoticeCode = safeClientErrorCode(code) || "AUDIO_NOTICE";
    vc.state.audioNotice = message;
  }

  function clearAudioNotice(code?: string): void {
    if (code && vc.state.audioNoticeCode !== safeClientErrorCode(code)) return;
    vc.state.audioNotice = "";
    vc.state.audioNoticeCode = "";
  }

  /** A suspended AudioContext silently swallows capture: say so instead of pretending. */
  function syncAudioContextNotice(): void {
    if (vc.audioCtx && vc.audioCtx.state === "suspended") {
      setAudioNotice("AUDIO_CONTEXT_SUSPENDED", "浏览器的音频处理被暂停（需要一次页面交互），麦克风与扬声器可能无声：请点击页面任意位置后重试");
    } else {
      clearAudioNotice("AUDIO_CONTEXT_SUSPENDED");
    }
  }

  async function setAudioSink(ctx: SinkAudioContext, deviceId: string): Promise<void> {
    const mediaSinkSupported = typeof (HTMLMediaElement.prototype as SinkAudioElement).setSinkId === "function";
    if (!ctx.setSinkId && !mediaSinkSupported) {
      vc.outputDeviceSupported.value = false;
      if (deviceId) throw new Error("当前浏览器不支持扬声器设备选择，将使用默认输出设备");
      return;
    }
    vc.outputDeviceSupported.value = true;
    if (ctx.setSinkId) await ctx.setSinkId(deviceId || "default");
    if (vc.webrtcOutputElement?.setSinkId) await vc.webrtcOutputElement.setSinkId(deviceId || "default");
  }

  function installWebRtcPlaybackRetry(): void {
    if (vc.webrtcPlaybackRetryCleanup) return;
    const retry = () => { void syncWebRtcPlayback(); };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "touchstart", "keydown"];
    for (const event of events) window.addEventListener(event, retry, { passive: true });
    document.addEventListener("visibilitychange", retry, { passive: true });
    vc.webrtcPlaybackRetryCleanup = () => {
      for (const event of events) window.removeEventListener(event, retry);
      document.removeEventListener("visibilitychange", retry);
      vc.webrtcPlaybackRetryCleanup = null;
    };
  }

  async function syncWebRtcPlayback(): Promise<void> {
    const output = vc.webrtcOutputElement;
    if (!output || !vc.webrtcPlaybackStream) return;
    // Keep WebRTC on the browser's native MediaStream playback path. The
    // capture AudioContext is intentionally not used as a second output
    // route: a running-but-silent graph could leave the UI reporting a live
    // speaker while the actual remote audio element remained muted.
    output.muted = false;
    if (vc.audioCtx && vc.audioCtx.state === "suspended") {
      try { await vc.audioCtx.resume(); } catch { /* a user gesture is still required */ }
    }
    try {
      await output.play();
      vc.webrtcPlaybackRetryCleanup?.();
      clearAudioNotice("PLAYBACK_BLOCKED");
      syncAudioContextNotice();
    } catch {
      // Mobile and privacy-focused browsers can require a gesture even for a
      // MediaStream. Keep retrying after the next real interaction, but tell the
      // user why the remote audio is missing instead of staying silent.
      setAudioNotice("PLAYBACK_BLOCKED", "浏览器阻止了音频自动播放，暂时听不到其他成员的声音：请点击页面任意位置，或在地址栏允许本站播放声音");
      installWebRtcPlaybackRetry();
    }
  }

  function checkSupport(): string | null {
    if (typeof window === "undefined") return null;
    if (!window.isSecureContext) return "语音功能需要 HTTPS 安全连接";
    if (!navigator.mediaDevices?.getUserMedia) return "当前浏览器不支持麦克风访问";
    if (typeof AudioContext === "undefined") return "当前浏览器不支持 Web Audio 音频处理";
    if (typeof AudioDecoder === "undefined") return "当前浏览器不支持音频解码，请使用最新版 Chrome 或 Edge";
    return null;
  }

  function microphoneConstraints(): MediaTrackConstraints {
    const constraints: MediaTrackConstraints = {
      sampleRate: { ideal: 48000 },
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: vc.noiseSuppressionEnabled.value,
      // Keep the microphone's natural dynamics. Browser AGC can make speech
      // pump in volume, especially while background noise changes.
      autoGainControl: false,
    };
    if (vc.selectedInputDeviceId.value) constraints.deviceId = { exact: vc.selectedInputDeviceId.value };
    return constraints;
  }

  async function refreshAudioDevices(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      vc.inputDevices.length = 0;
      vc.outputDevices.length = 0;
      setAudioNotice("DEVICE_LIST_UNAVAILABLE", "无法读取音频设备列表，将使用浏览器默认音频设备：请在系统或浏览器隐私设置中允许读取设备信息");
      return;
    }
    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
      clearAudioNotice("DEVICE_LIST_UNAVAILABLE");
    } catch {
      // enumerateDevices rejects when the device list is blocked (for example in a
      // locked-down iframe). Use the browser defaults and explain the limitation.
      vc.inputDevices.length = 0;
      vc.outputDevices.length = 0;
      setAudioNotice("DEVICE_LIST_UNAVAILABLE", "无法读取音频设备列表，将使用浏览器默认音频设备：请在系统或浏览器隐私设置中允许读取设备信息");
      return;
    }
    const microphones = devices
      .filter((device) => device.kind === "audioinput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }));
    const speakers = devices
      .filter((device) => device.kind === "audiooutput")
      .map((device) => ({ deviceId: device.deviceId, label: device.label, groupId: device.groupId }));
    vc.inputDevices.splice(0, vc.inputDevices.length, ...microphones);
    vc.outputDevices.splice(0, vc.outputDevices.length, ...speakers);
    if (vc.selectedInputDeviceId.value && !microphones.some((device) => device.deviceId === vc.selectedInputDeviceId.value)) {
      vc.selectedInputDeviceId.value = "";
      localStorage.setItem("webspeak:input-device", vc.selectedInputDeviceId.value);
      void saveAudioPreferences();
      if (vc.micStream) void startMicrophone().catch(() => undefined);
    }
    if (vc.selectedOutputDeviceId.value && !speakers.some((device) => device.deviceId === vc.selectedOutputDeviceId.value)) {
      vc.selectedOutputDeviceId.value = "";
      localStorage.setItem("webspeak:output-device", "");
      void saveAudioPreferences();
      if (vc.audioCtx && vc.outputDeviceSupported.value) void setAudioSink(vc.audioCtx, "").catch(() => undefined);
    }
  }

  async function refreshInputDevices(): Promise<void> {
    await refreshAudioDevices();
  }

  async function createRnnoiseNode(ctx: AudioContext): Promise<RnnoiseWorkletNode | null> {
    if (typeof AudioWorkletNode === "undefined" || !ctx.audioWorklet) {
      vc.microphoneProcessing.rnnoise = false;
      return null;
    }
    try {
      if (!vc.rnnoiseWasmPromise) {
        vc.rnnoiseWasmPromise = loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl }).catch((error) => {
          vc.rnnoiseWasmPromise = null;
          throw error;
        });
      }
      if (!vc.rnnoiseWorkletModulePromise) {
        vc.rnnoiseWorkletModulePromise = ctx.audioWorklet.addModule(rnnoiseWorkletUrl).catch((error) => {
          vc.rnnoiseWorkletModulePromise = null;
          throw error;
        });
      }
      const [wasmBinary] = await Promise.all([vc.rnnoiseWasmPromise, vc.rnnoiseWorkletModulePromise]);
      const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
      vc.microphoneProcessing.rnnoise = true;
      return node;
    } catch {
      // Native browser NS remains active as a fallback. RNNoise is an optional
      // enhancement and must never prevent a microphone from starting.
      vc.microphoneProcessing.rnnoise = false;
      return null;
    }
  }

  async function startMicrophone(): Promise<void> {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch { /* the audio context notice explains the silence */ }
    }
    // Acquire the replacement stream before tearing down the current graph so
    // changing devices does not interrupt an active microphone on failure.
    let nextStream: MediaStream;
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints() });
      vc.audioPermission.value = "granted";
      clearMicrophoneError();
    } catch (error) {
      if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) vc.audioPermission.value = "denied";
      // Never let the raw DOMException (usually an English message) reach the UI:
      // record a readable failure first, then let the caller decide how to show it.
      setMicrophoneError(error);
      throw error;
    }
    const microphoneTrack = nextStream.getAudioTracks()[0];
    const settings = microphoneTrack?.getSettings();
    vc.microphoneProcessing.echoCancellation = typeof settings?.echoCancellation === "boolean" ? settings.echoCancellation : null;
    vc.microphoneProcessing.noiseSuppression = typeof settings?.noiseSuppression === "boolean" ? settings.noiseSuppression : null;
    vc.microphoneProcessing.autoGainControl = typeof settings?.autoGainControl === "boolean" ? settings.autoGainControl : null;
    stopMicrophone(false);
    vc.micStream = nextStream;

    vc.micSource = ctx.createMediaStreamSource(vc.micStream);
    vc.rnnoiseNode = vc.noiseSuppressionEnabled.value ? await createRnnoiseNode(ctx) : null;
    if (!vc.noiseSuppressionEnabled.value) vc.microphoneProcessing.rnnoise = false;
    const processedSource: AudioNode = vc.rnnoiseNode ?? vc.micSource;
    if (vc.rnnoiseNode) vc.micSource.connect(vc.rnnoiseNode);
    vc.processedMicDestination = ctx.createMediaStreamDestination();
    vc.processedMicDestination.channelCount = 1;
    vc.processedMicDestination.channelCountMode = "explicit";
    processedSource.connect(vc.processedMicDestination);
    vc.micGain = ctx.createGain();
    vc.micGain.gain.value = vc.inputVolume.value;
    vc.silentGain = ctx.createGain();
    vc.silentGain.gain.value = 0;

    const handleCaptureChunk = (input: Float32Array, rms?: number): void => {
      if (!input.length) return;
      vc.micLevel.value = Math.min(1, (rms ?? Math.sqrt(input.reduce((sum, sample) => sum + sample * sample, 0) / input.length)) * 6);
      const socket = vc.ws.value;
      const shouldSend = !vc.microphoneMuted.value
        && !vc.microphoneTestActive.value
        && !vc.webrtcActive.value
        && socket?.readyState === WebSocket.OPEN
        && voxGate(input);
      if (!shouldSend) {
        vc.accumLen = 0;
        if (vc.microphoneMuted.value) {
          vc.voxAttack = 0;
          vc.voxRelease = 0;
        }
        return;
      }
      if (!socket) {
        vc.accumLen = 0;
        return;
      }
      const bufferedBytes = socket.bufferedAmount;
      if (bufferedBytes > MAX_AUDIO_BUFFERED_BYTES) {
        vc.accumLen = 0;
        return;
      }

      if (vc.convBuf.length < input.length) vc.convBuf = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const sample = Math.max(-1, Math.min(1, input[i]!));
        vc.convBuf[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      const need = vc.accumLen + input.length;
      if (vc.accumBuf.length < need) vc.accumBuf = new Int16Array(Math.max(need, vc.accumBuf.length * 2));
      vc.accumBuf.set(vc.convBuf.subarray(0, input.length), vc.accumLen);
      vc.accumLen = need;

      let offset = 0;
      while (offset + AUDIO_FRAME_SAMPLES <= vc.accumLen && socket.readyState === WebSocket.OPEN && socket.bufferedAmount <= MAX_AUDIO_BUFFERED_BYTES) {
        socket.send(vc.accumBuf.slice(offset, offset + AUDIO_FRAME_SAMPLES).buffer);
        offset += AUDIO_FRAME_SAMPLES;
      }
      if (offset > 0) markSpeaking(vc.state.tsClientId);
      vc.accumLen -= offset;
      if (offset > 0) vc.accumBuf.set(vc.accumBuf.subarray(offset, offset + vc.accumLen), 0);
    };

    if (typeof AudioWorkletNode !== "undefined" && ctx.audioWorklet) {
      try {
        if (vc.workletContext !== ctx || !vc.workletModulePromise) {
          vc.workletContext = ctx;
          vc.workletModulePromise = ctx.audioWorklet.addModule(micCaptureWorkletUrl);
        }
        await vc.workletModulePromise;
        vc.workletNode = new AudioWorkletNode(ctx, "webspeak-mic-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        vc.workletNode.port.onmessage = (event: MessageEvent<{ samples?: Float32Array; rms?: number }>) => {
          const samples = event.data?.samples;
          if (samples instanceof Float32Array) handleCaptureChunk(samples, event.data.rms);
        };
      } catch {
        vc.workletNode?.disconnect();
        vc.workletNode = null;
        vc.workletContext = null;
        vc.workletModulePromise = null;
      }
    }

    if (!vc.workletNode) {
      vc.scriptNode = ctx.createScriptProcessor(1024, 1, 1);
      vc.scriptNode.onaudioprocess = (event: AudioProcessingEvent) => handleCaptureChunk(event.inputBuffer.getChannelData(0));
    }

    processedSource.connect(vc.micGain);
    const captureNode = vc.workletNode ?? vc.scriptNode!;
    vc.micGain.connect(captureNode);
    captureNode.connect(vc.silentGain);
    vc.silentGain.connect(ctx.destination);
    await refreshAudioDevices();
    syncAudioContextNotice();
  }

  // 导出给 WebClient：开麦前先 await 此函数完成真实采集，避免出现“假成功”
  async function ensureMicrophone(): Promise<void> {
    if (vc.micStream) return;
    if (!vc.microphoneStartPromise) {
      vc.microphoneStartPromise = startMicrophone().finally(() => {
        vc.microphoneStartPromise = null;
      });
    }
    await vc.microphoneStartPromise;
  }

  function voxGate(samples: Float32Array): boolean {
    let sum = 0;
    const count = Math.min(256, samples.length);
    for (let i = 0; i < count; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / count);
    if (rms >= vc.voxThreshold.value) {
      vc.voxAttack = Math.min(VOX_ATTACK_FRAMES, vc.voxAttack + 1);
      vc.voxRelease = VOX_HOLD;
      return vc.voxAttack >= VOX_ATTACK_FRAMES;
    }
    vc.voxAttack = 0;
    if (vc.voxRelease > 0) {
      vc.voxRelease--;
      return true;
    }
    return false;
  }

  function stopWebRtcMix(): void {
    vc.webrtcMixAccompanimentSource?.disconnect();
    vc.webrtcMixMicSource?.disconnect();
    vc.webrtcMixMicGain?.disconnect();
    vc.webrtcMixDestination?.disconnect();
    vc.webrtcMixAccompanimentSource = null;
    vc.webrtcMixMicSource = null;
    vc.webrtcMixMicGain = null;
    vc.webrtcMixDestination = null;
  }

  function releaseAccompanimentStream(): void {
    vc.accompanimentStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    vc.accompanimentStream = null;
    vc.accompanimentActive.value = false;
  }

  function createWebRtcMixStream(): MediaStream {
    if (!vc.micStream) throw new Error("没有可用的麦克风音轨");
    const ctx = getAudioCtx();
    stopWebRtcMix();
    const destination = ctx.createMediaStreamDestination();
    destination.channelCount = 1;
    destination.channelCountMode = "explicit";
    // Use the browser-native processed track plus the browser-side RNNoise
    // graph. Display/application audio is added separately below and never
    // passes through this microphone denoiser.
    const microphoneStream = vc.processedMicDestination?.stream ?? vc.micStream;
    const microphoneSource = ctx.createMediaStreamSource(microphoneStream);
    const microphoneGain = ctx.createGain();
    microphoneGain.gain.value = vc.microphoneMuted.value ? 0 : vc.inputVolume.value;
    microphoneSource.connect(microphoneGain);
    microphoneGain.connect(destination);

    vc.webrtcMixDestination = destination;
    vc.webrtcMixMicSource = microphoneSource;
    vc.webrtcMixMicGain = microphoneGain;

    const accompanimentTrack = vc.accompanimentStream?.getAudioTracks()[0];
    if (accompanimentTrack) {
      const accompanimentSource = ctx.createMediaStreamSource(vc.accompanimentStream!);
      // Keep the captured application audio at its source level. Do not add
      // a fixed attenuation/gain node: it makes music sound quieter than the
      // source and encourages later "compensation" steps to pump its volume.
      accompanimentSource.connect(destination);
      vc.webrtcMixAccompanimentSource = accompanimentSource;
    }
    return destination.stream;
  }

  async function replaceWebRtcAudioTrack(): Promise<void> {
    if (!vc.webrtcPeer || !vc.micStream) return;
    const sender = vc.webrtcPeer.getSenders().find((candidate: RTCRtpSender) => candidate.track?.kind === "audio");
    if (!sender) throw new Error("WebRTC 音频轨道尚未就绪");
    const mixedStream = createWebRtcMixStream();
    const mixedTrack = mixedStream.getAudioTracks()[0];
    if (!mixedTrack) throw new Error("混合音频轨道创建失败");
    await sender.replaceTrack(mixedTrack);
  }

  async function startAccompaniment(): Promise<void> {
    vc.accompanimentErrorCode.value = "";
    if (!vc.accompanimentSupported.value) {
      vc.accompanimentErrorCode.value = "unsupported";
      throw new Error("伴奏共享不可用");
    }
    if (!vc.webrtcActive.value || !vc.webrtcPeer || !vc.micStream) {
      vc.accompanimentErrorCode.value = "needsWebRtc";
      throw new Error("伴奏功能需要启用 WebRTC");
    }

    const captureProcessingConstraints: MediaTrackConstraints = {
      // Display/application audio must not pass through browser voice
      // processing. Those processors are designed for speech and can change
      // music level from frame to frame (AGC), suppress quiet passages, or
      // cancel sustained tones.
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    };
    const audioConstraints = { ...captureProcessingConstraints } as MediaTrackConstraints & { restrictOwnAudio?: boolean };
    const supportedConstraints = navigator.mediaDevices.getSupportedConstraints?.() as Record<string, boolean> | undefined;
    if (supportedConstraints?.restrictOwnAudio) audioConstraints.restrictOwnAudio = true;
    const options = {
      video: { displaySurface: "browser" },
      audio: audioConstraints,
      selfBrowserSurface: "exclude",
      systemAudio: "include",
      windowAudio: "window",
    } as unknown as DisplayMediaStreamOptions;

    let nextStream: MediaStream;
    try {
      nextStream = await navigator.mediaDevices.getDisplayMedia(options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      vc.accompanimentErrorCode.value = "permission";
      throw error;
    }
    const audioTrack = nextStream.getAudioTracks()[0];
    nextStream.getVideoTracks().forEach((track) => track.stop());
    if (!audioTrack) {
      nextStream.getTracks().forEach((track) => track.stop());
      vc.accompanimentErrorCode.value = "noAudio";
      throw new Error("所选来源没有可共享音频");
    }

    try {
      // Do not pass the Chromium-only restrictOwnAudio hint to
      // applyConstraints: rejecting an unknown key could otherwise cause the
      // browser to discard all three standard processing-off constraints.
      await audioTrack.applyConstraints(captureProcessingConstraints);
    } catch {
      // Some browsers expose display audio but reject one or more optional
      // processing constraints. The capture can still proceed without
      // introducing a WebSpeak-side gain stage.
    }
    if ("contentHint" in audioTrack) audioTrack.contentHint = "music";

    vc.accompanimentStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    vc.accompanimentStream = nextStream;
    vc.accompanimentActive.value = true;
    vc.sendCmd("setAccompanimentActive", { active: true });
    audioTrack.addEventListener("ended", () => { void stopAccompaniment(); }, { once: true });
    try {
      await replaceWebRtcAudioTrack();
    } catch (error) {
      releaseAccompanimentStream();
      vc.sendCmd("setAccompanimentActive", { active: false });
      stopWebRtcMix();
      vc.accompanimentErrorCode.value = "permission";
      throw error;
    }
  }

  async function stopAccompaniment(): Promise<void> {
    vc.accompanimentErrorCode.value = "";
    releaseAccompanimentStream();
    if (vc.webrtcActive.value) vc.sendCmd("setAccompanimentActive", { active: false });
    if (vc.webrtcActive.value && vc.webrtcPeer && vc.micStream) await replaceWebRtcAudioTrack();
    else stopWebRtcMix();
  }

  async function startWebRtcTransport(sequence: number, socket: WebSocket): Promise<void> {
    if (typeof RTCPeerConnection === "undefined") throw new Error("当前浏览器不支持 WebRTC");
    await ensureMicrophone();
    if (sequence !== vc.connectionSequence || socket.readyState !== WebSocket.OPEN || !vc.micStream) return;
    const microphoneTrack = vc.micStream.getAudioTracks()[0];
    if (!microphoneTrack) throw new Error("没有可用的麦克风音轨");

    stopCaptureGraph();
    const peer = new RTCPeerConnection({ iceServers: [] });
    vc.webrtcPeer = peer;
    vc.webrtcFallbackStarted = false;
    microphoneTrack.enabled = !vc.microphoneMuted.value;
    const mixedStream = createWebRtcMixStream();
    const mixedTrack = mixedStream.getAudioTracks()[0];
    if (!mixedTrack) throw new Error("混合音频轨道创建失败");
    peer.addTrack(mixedTrack, mixedStream);
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      // Use the browser's native WebRTC media output. Routing the remote
      // track through AudioContext made playback depend on autoplay policy:
      // the control channel could report speaking while a suspended context
      // silently discarded the actual audio. A hidden autoplaying media
      // element keeps WebRTC's decoder and jitter buffer on the native path.
      stopWebRtcPlayback();
      const output = document.createElement("audio") as SinkAudioElement;
      output.autoplay = true;
      output.muted = false;
      output.setAttribute("playsinline", "");
      output.volume = effectiveOutputVolume();
      output.setAttribute("aria-hidden", "true");
      output.tabIndex = -1;
      output.style.position = "fixed";
      output.style.width = "1px";
      output.style.height = "1px";
      output.style.opacity = "0";
      output.style.pointerEvents = "none";
      output.srcObject = stream;
      document.body.append(output);
      vc.webrtcOutputElement = output;
      vc.webrtcPlaybackStream = stream;
      if (vc.selectedOutputDeviceId.value && output.setSinkId) {
        void output.setSinkId(vc.selectedOutputDeviceId.value).catch(() => undefined);
      }
      void syncWebRtcPlayback();
    };
    startWebRtcMicMonitor(getAudioCtx(), vc.micStream, microphoneTrack);
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") void fallbackFromWebRtc(sequence, socket, "WEBRTC_CONNECTION_FAILED");
    };

    const negotiation = (async () => {
      vc.webrtcActive.value = true;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      if (sequence !== vc.connectionSequence || vc.webrtcPeer !== peer || socket.readyState !== WebSocket.OPEN) return;
      const description = peer.localDescription;
      if (!description) throw new Error("WebRTC offer was not created");
      socket.send(JSON.stringify({ type: "webrtcOffer", payload: {
        sdp: { type: description.type, sdp: description.sdp },
        muted: vc.microphoneMuted.value,
        accompanimentActive: vc.accompanimentActive.value,
      } }));
      window.setTimeout(() => {
        if (vc.webrtcPeer === peer && !peer.remoteDescription) void fallbackFromWebRtc(sequence, socket, "WEBRTC_ANSWER_TIMEOUT");
      }, 8_000);
    })();
    vc.webrtcNegotiationPromise = negotiation;
    try {
      await negotiation;
    } catch (error) {
      if (vc.webrtcPeer === peer) await fallbackFromWebRtc(sequence, socket, "WEBRTC_NEGOTIATION_FAILED");
      throw error;
    } finally {
      if (vc.webrtcNegotiationPromise === negotiation) vc.webrtcNegotiationPromise = null;
    }
  }

  async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      };
      const onStateChange = () => {
        if (peer.iceGatheringState === "complete") finish();
      };
      const timer = window.setTimeout(finish, 5_000);
      peer.addEventListener("icegatheringstatechange", onStateChange);
    });
  }

  async function applyWebRtcAnswer(description: unknown): Promise<void> {
    if (!vc.webrtcPeer || !isSessionDescription(description, "answer")) return;
    try {
      await vc.webrtcPeer.setRemoteDescription(description);
      vc.webrtcActive.value = true;
      syncWebRtcMemberVolumes();
    } catch {
      if (vc.lastConnection && vc.ws.value) await fallbackFromWebRtc(vc.connectionSequence, vc.ws.value, "WEBRTC_ANSWER_REJECTED");
    }
  }

  async function fallbackFromWebRtc(sequence: number, socket: WebSocket, reasonCode = "WEBRTC_UNAVAILABLE"): Promise<void> {
    if (sequence !== vc.connectionSequence || vc.webrtcFallbackStarted) return;
    vc.webrtcFallbackStarted = true;
    vc.webrtcActive.value = false;
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "webrtcStop" }));
    stopWebRtcTransport();
    if (socket.readyState === WebSocket.OPEN && vc.state.connected) {
      // Degrading to the compatibility transport must be visible: the user is
      // still connected, but with different latency and audio quality.
      setAudioNotice("WEBRTC_FALLBACK", `实时语音（WebRTC）不可用（错误代码：${safeClientErrorCode(reasonCode) || "WEBRTC_UNAVAILABLE"}），已切换为兼容传输：延迟与音质可能下降`);
      try { await startMicrophone(); } catch (error: unknown) {
        setMicrophoneError(error);
      }
    }
  }

  function stopWebRtcTransport(): void {
    const peer = vc.webrtcPeer;
    vc.webrtcPeer = null;
    vc.webrtcActive.value = false;
    vc.webrtcNegotiationPromise = null;
    releaseAccompanimentStream();
    stopWebRtcMix();
    stopWebRtcMicMonitor();
    stopWebRtcPlayback();
    if (peer) void peer.close();
  }

  function stopWebRtcPlayback(): void {
    vc.webrtcPlaybackRetryCleanup?.();
    vc.webrtcPlaybackStream = null;
    vc.webrtcOutputElement?.pause();
    if (vc.webrtcOutputElement) {
      vc.webrtcOutputElement.srcObject = null;
      vc.webrtcOutputElement.remove();
    }
    vc.webrtcOutputElement = null;
  }

  function startWebRtcMicMonitor(ctx: AudioContext, stream: MediaStream, track: MediaStreamTrack): void {
    stopWebRtcMicMonitor(false);
    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const silent = ctx.createGain();
      silent.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silent);
      silent.connect(ctx.destination);
      const samples = new Float32Array(analyser.fftSize);
      vc.webrtcMicMonitorSource = source;
      vc.webrtcMicMonitorAnalyser = analyser;
      vc.webrtcMicMonitorGain = silent;
      vc.webrtcMicMonitorTimer = setInterval(() => {
        if (!vc.webrtcMicMonitorAnalyser) return;
        vc.webrtcMicMonitorAnalyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        const rms = Math.sqrt(sum / samples.length);
        vc.micLevel.value = Math.min(1, rms * 6);
        if (!vc.microphoneMuted.value && track.enabled && rms >= vc.voxThreshold.value) markSpeaking(vc.state.tsClientId);
        else if (vc.state.tsClientId) clearSpeaking(vc.state.tsClientId);
      }, 50);
    } catch {
      stopWebRtcMicMonitor(false);
    }
  }

  function stopWebRtcMicMonitor(resetLevel = true): void {
    if (vc.webrtcMicMonitorTimer) clearInterval(vc.webrtcMicMonitorTimer);
    vc.webrtcMicMonitorTimer = null;
    vc.webrtcMicMonitorSource?.disconnect();
    vc.webrtcMicMonitorAnalyser?.disconnect();
    vc.webrtcMicMonitorGain?.disconnect();
    vc.webrtcMicMonitorSource = null;
    vc.webrtcMicMonitorAnalyser = null;
    vc.webrtcMicMonitorGain = null;
    if (resetLevel) vc.micLevel.value = 0;
  }

  function isSessionDescription(value: unknown, type: "answer"): value is RTCSessionDescriptionInit {
    return Boolean(value) && typeof value === "object"
      && (value as { type?: unknown }).type === type
      && typeof (value as { sdp?: unknown }).sdp === "string";
  }

  function stopCaptureGraph(): void {
    vc.accumLen = 0;
    vc.voxAttack = 0;
    vc.voxRelease = 0;
    vc.micLevel.value = 0;
    vc.scriptNode?.disconnect();
    vc.workletNode?.port.close();
    vc.workletNode?.disconnect();
    vc.micGain?.disconnect();
    vc.silentGain?.disconnect();
    vc.scriptNode = null;
    vc.workletNode = null;
    vc.micGain = null;
    vc.silentGain = null;
  }

  function stopMicrophoneProcessingGraph(): void {
    vc.rnnoiseNode?.destroy();
    vc.rnnoiseNode?.disconnect();
    vc.rnnoiseNode = null;
    vc.micSource?.disconnect();
    vc.processedMicDestination?.disconnect();
    vc.processedMicDestination?.stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    vc.micSource = null;
    vc.processedMicDestination = null;
  }

  function stopMicrophone(closeContext = true): void {
    stopCaptureGraph();
    stopMicrophoneProcessingGraph();
    releaseAccompanimentStream();
    stopWebRtcMix();
    vc.micStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    vc.micStream = null;
    if (closeContext) {
      vc.audioCtx?.close();
      vc.audioCtx = null;
      vc.workletContext = null;
      vc.workletModulePromise = null;
      vc.rnnoiseWorkletModulePromise = null;
    }
  }

  async function prepareInputDevices(): Promise<void> {
    if (!vc.micStream) await startMicrophone();
    else await refreshAudioDevices();
  }

  async function setInputDevice(deviceId: string): Promise<void> {
    const previousDeviceId = vc.selectedInputDeviceId.value;
    const shouldRestartWebRtc = vc.webrtcActive.value && Boolean(vc.ws.value);
    vc.selectedInputDeviceId.value = deviceId;
    localStorage.setItem("webspeak:input-device", deviceId);
    void saveAudioPreferences();
    try {
      if (shouldRestartWebRtc) stopWebRtcTransport();
      if (vc.micStream) await startMicrophone();
      if (shouldRestartWebRtc && vc.ws.value) {
        stopWebRtcTransport();
        await startWebRtcTransport(vc.connectionSequence, vc.ws.value);
      }
      await refreshAudioDevices();
    } catch (error) {
      vc.selectedInputDeviceId.value = previousDeviceId;
      localStorage.setItem("webspeak:input-device", previousDeviceId);
      throw error;
    }
  }

  async function startMicrophoneTest(): Promise<void> {
    vc.microphoneTestActive.value = true;
    if (vc.testAudioUrl.value) {
      URL.revokeObjectURL(vc.testAudioUrl.value);
      vc.testAudioUrl.value = "";
    }
    try {
      await prepareInputDevices();
      if (typeof MediaRecorder !== "undefined" && vc.micStream) {
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(vc.micStream);
        vc.testRecorder = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        recorder.onstop = () => {
          if (chunks.length) {
            vc.testAudioUrl.value = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
          }
          if (vc.testRecorder === recorder) vc.testRecorder = null;
        };
        recorder.start();
        vc.testRecorderTimer = setTimeout(() => stopMicrophoneTest(), 5_000);
      }
    } catch (error) {
      vc.microphoneTestActive.value = false;
      throw error;
    }
  }

  function stopMicrophoneTest(): void {
    vc.microphoneTestActive.value = false;
    if (vc.testRecorderTimer) clearTimeout(vc.testRecorderTimer);
    vc.testRecorderTimer = null;
    if (vc.testRecorder && vc.testRecorder.state !== "inactive") vc.testRecorder.stop();
    if (!vc.state.connected) stopMicrophone();
  }

  async function setOutputDevice(deviceId: string): Promise<void> {
    const previousDeviceId = vc.selectedOutputDeviceId.value;
    if (deviceId && !vc.outputDevices.some((device: AudioOutputDevice) => device.deviceId === deviceId)) {
      throw new Error("所选扬声器当前不可用");
    }
    vc.selectedOutputDeviceId.value = deviceId;
    localStorage.setItem("webspeak:output-device", deviceId);
    try {
      await setAudioSink(getAudioCtx(), deviceId);
      await saveAudioPreferences();
    } catch (error) {
      vc.selectedOutputDeviceId.value = previousDeviceId;
      localStorage.setItem("webspeak:output-device", previousDeviceId);
      throw error;
    }
  }

  function playNotification(kind: "connected" | "disconnected" | "poke" | "private" | "reconnectFailed"): void {
    if (vc.notificationVolume.value <= 0 || vc.outputMuted.value || effectiveOutputVolume() <= 0 || typeof window === "undefined") return;
    try {
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") return;
      const frequencies: Record<typeof kind, number[]> = {
        connected: [660, 880],
        disconnected: [440, 330],
        poke: [740, 980],
        private: [600, 760],
        reconnectFailed: [300, 220],
      };
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      oscillator.frequency.setValueAtTime(frequencies[kind][0], now);
      oscillator.frequency.setValueAtTime(frequencies[kind][1], now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vc.notificationVolume.value * effectiveOutputVolume() * 0.12), now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } catch {
      // Notification sounds are best effort and must never affect the session.
    }
  }

  function playAudioFrame(clientId: number, opusData: Uint8Array): void {
    if (opusData.length < 3) return;
    let decoder = vc.remoteDecoders.get(clientId);
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const scheduledUntil = vc.remotePlayTimes.get(clientId) ?? now;
    const decodeQueueSize = decoder?.decodeQueueSize ?? 0;
    if (
      decoder &&
      (scheduledUntil > now + MAX_REMOTE_PLAY_AHEAD_SECONDS || decodeQueueSize >= MAX_REMOTE_DECODE_QUEUE_FRAMES)
    ) {
      resetRemotePlayback(clientId);
      decoder = undefined;
    }

    if (!decoder) {
      const gainNode = ctx.createGain();
      gainNode.gain.value = (vc.volumes[clientId] ?? 1) * effectiveOutputVolume();
      gainNode.connect(ctx.destination);
      vc.remoteGains.set(clientId, gainNode);
      const generation = ++vc.nextRemoteDecoderGeneration;
      const nextDecoder = new AudioDecoder({
        output: (chunk: AudioData) => {
          if (vc.remoteDecoderGenerations.get(clientId) !== generation) {
            chunk.close();
            return;
          }
          try {
            const { sampleRate, numberOfChannels, numberOfFrames } = chunk;
            const buffer = ctx.createBuffer(numberOfChannels, numberOfFrames, sampleRate);
            for (let ch = 0; ch < numberOfChannels; ch++) {
              const data = new Float32Array(numberOfFrames);
              chunk.copyTo(data, { planeIndex: ch, format: "f32-planar" });
              buffer.copyToChannel(data, ch);
            }
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(gainNode);
            let sources = vc.remotePlaybackSources.get(clientId);
            if (!sources) {
              sources = new Set<AudioBufferSourceNode>();
              vc.remotePlaybackSources.set(clientId, sources);
            }
            sources.add(source);
            source.addEventListener("ended", () => {
              source.disconnect();
              sources?.delete(source);
              if (sources?.size === 0) vc.remotePlaybackSources.delete(clientId);
            }, { once: true });
            let playTime = vc.remotePlayTimes.get(clientId) ?? ctx.currentTime;
            if (playTime < ctx.currentTime) playTime = ctx.currentTime;
            if (playTime + numberOfFrames / sampleRate > ctx.currentTime + MAX_REMOTE_PLAY_AHEAD_SECONDS) {
              source.disconnect();
              sources.delete(source);
              if (sources.size === 0) vc.remotePlaybackSources.delete(clientId);
              chunk.close();
              resetRemotePlayback(clientId);
              return;
            }
            source.start(playTime);
            vc.remotePlayTimes.set(clientId, playTime + numberOfFrames / sampleRate);
          } catch {
            // A decoder can finish while the audio context is being torn down.
          }
          chunk.close();
        },
        error: () => {
          if (vc.remoteDecoderGenerations.get(clientId) === generation) {
            vc.remoteDecoderGenerations.delete(clientId);
            vc.remoteDecoders.delete(clientId);
          }
        },
      });
      nextDecoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 1 });
      decoder = nextDecoder;
      vc.remoteDecoderGenerations.set(clientId, generation);
      vc.remoteDecoders.set(clientId, decoder);
    }

    try {
      const timestamp = vc.remoteDecodeTimestamps.get(clientId) ?? 0;
      decoder.decode(new EncodedAudioChunk({ type: "key", timestamp, duration: 20_000, data: opusData }));
      vc.remoteDecodeTimestamps.set(clientId, timestamp + 20_000);
    } catch {
      // Ignore malformed frames; the next valid frame can still be decoded.
    }
  }

  function clearRemotePlayback(clientId: number): void {
    const decoder = vc.remoteDecoders.get(clientId);
    if (decoder) {
      try { decoder.close(); } catch { /* already closed */ }
    }
    vc.remoteDecoders.delete(clientId);
    vc.remoteDecoderGenerations.delete(clientId);
    vc.remotePlayTimes.delete(clientId);
    vc.remoteDecodeTimestamps.delete(clientId);
    const sources = vc.remotePlaybackSources.get(clientId);
    if (sources) {
      for (const source of sources) {
        try { source.stop(); } catch { /* already ended */ }
        source.disconnect();
      }
      vc.remotePlaybackSources.delete(clientId);
    }
  }

  function resetRemotePlayback(clientId: number): void {
    clearRemotePlayback(clientId);
  }

  function setMicrophoneMuted(muted: boolean): void {
    vc.microphoneMuted.value = muted;
    vc.voxAttack = 0;
    vc.voxRelease = 0;
    vc.accumLen = 0;
    if (vc.webrtcActive.value) vc.micStream?.getAudioTracks().forEach((track: MediaStreamTrack) => { track.enabled = !muted; });
    if (vc.webrtcMixMicGain) vc.webrtcMixMicGain.gain.value = muted ? 0 : vc.inputVolume.value;
    vc.sendCmd("setMicrophoneMuted", { muted });
    if (muted && vc.state.tsClientId) clearSpeaking(vc.state.tsClientId);
    void saveAudioPreferences();
  }

  function setVolume(clientId: number, volume: number): void {
    const normalized = Math.max(0, Math.min(4, volume));
    vc.volumes[clientId] = normalized;
    const member = vc.members.find((candidate: ChannelMember) => candidate.id === clientId);
    if (member?.uid) {
      vc.storedVolumesByUid[member.uid] = normalized;
      void saveAudioPreferences();
    }
    const gain = vc.remoteGains.get(clientId);
    if (gain) gain.gain.value = normalized * effectiveOutputVolume();
    if (vc.webrtcPeer || vc.webrtcActive.value) vc.sendCmd("setMemberVolume", { clientId, volume: normalized });
  }

  function syncWebRtcMemberVolumes(): void {
    if (!vc.webrtcActive.value || vc.ws.value?.readyState !== WebSocket.OPEN) return;
    for (const [rawClientId, volume] of Object.entries(vc.volumes)) {
      const clientId = Number(rawClientId);
      if (!Number.isInteger(clientId) || clientId <= 0) continue;
      vc.sendCmd("setMemberVolume", { clientId, volume });
    }
  }

  function setInputVolume(volume: number): void {
    vc.inputVolume.value = Math.max(0, Math.min(1, volume));
    if (vc.micGain) vc.micGain.gain.value = vc.inputVolume.value;
    if (vc.webrtcMixMicGain) vc.webrtcMixMicGain.gain.value = vc.microphoneMuted.value ? 0 : vc.inputVolume.value;
    void saveAudioPreferences();
  }

  async function setNoiseSuppressionEnabled(enabled: boolean): Promise<void> {
    if (vc.noiseSuppressionEnabled.value === enabled) return;
    const shouldRestartWebRtc = vc.webrtcActive.value && Boolean(vc.ws.value);
    vc.noiseSuppressionEnabled.value = enabled;
    void saveAudioPreferences();
    if (!vc.micStream) return;
    try {
      if (shouldRestartWebRtc) stopWebRtcTransport();
      await startMicrophone();
      if (shouldRestartWebRtc && vc.ws.value) await startWebRtcTransport(vc.connectionSequence, vc.ws.value);
    } catch (error) {
      setMicrophoneError(error);
    }
  }

  function setOutputVolume(volume: number): void {
    vc.outputVolume.value = Math.max(0, Math.min(1, volume));
    applyOutputVolume();
    void saveAudioPreferences();
  }

  function toggleOutputMute(): void {
    vc.outputMuted.value = !vc.outputMuted.value;
    applyOutputVolume();
  }

  function setVoxThreshold(threshold: number): void {
    vc.voxThreshold.value = clamp(threshold, 0.001, 0.08);
    void saveAudioPreferences();
  }

  function setNotificationVolume(volume: number): void {
    vc.notificationVolume.value = clamp(volume, 0, 1);
    void saveAudioPreferences();
  }
  return {
    setVolume,
    setInputVolume,
    setNoiseSuppressionEnabled,
    setOutputVolume,
    toggleOutputMute,
    setVoxThreshold,
    setNotificationVolume,
    prepareInputDevices,
    refreshAudioDevices,
    setInputDevice,
    setOutputDevice,
    startMicrophoneTest,
    stopMicrophoneTest,
    playNotification,
    setMicrophoneMuted,
    ensureMicrophone,
    startAccompaniment,
    stopAccompaniment,
    checkSupport,
  };
}