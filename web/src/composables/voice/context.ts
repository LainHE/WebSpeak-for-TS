import { reactive, ref } from "vue";
import { DEFAULT_SCREEN_SHARE_ICE_SERVERS } from "./ice-servers.js";
import type { RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import type { AudioInputDevice, AudioOutputDevice, AudioPermission, ChannelInfo, ChannelMember, ChatMessage, LatencyProbeResult, MicrophoneProcessingSettings, ScreenShareOutputSettings, ScreenShareStream, ScreenShareWebRtcStats, ServerEvent, VoiceState } from "./types.js";

type SinkAudioContext = AudioContext & {
  sinkId?: string;
  setSinkId?: (sinkId: string) => Promise<void>;
};

type SinkAudioElement = HTMLAudioElement & {
  sinkId?: string;
};

export type VoiceSharedState = ReturnType<typeof createVoiceContext>;
export interface VoiceContext extends VoiceSharedState {}

export function createVoiceContext() {
  const ws = ref<WebSocket | null>(null);
  const state = reactive<VoiceState>({ connected: false, connecting: false, reconnecting: false, reconnectAttempt: 0, reconnectFailed: false, tsClientId: 0, error: "", errorCode: "", microphoneError: "", microphoneErrorCode: "", audioNotice: "", audioNoticeCode: "", channelSwitchedChannelId: "" });
  const members = reactive<ChannelMember[]>([]);
  const channels = reactive<ChannelInfo[]>([]);
  const chatMessages = reactive<ChatMessage[]>([]);
  const serverEvents = reactive<ServerEvent[]>([]);
  const pokeNotifications = reactive<{ id: string; invokerId: number; invokerUid: string; invokerName: string; message: string; timestamp: number }[]>([]);
  let connectionSequence = 0;
  let lastConnection: { target: string; channel: string; nickname: string; serverPassword: string; identity?: string; rememberIdentity: boolean; accelerated: boolean; accelerationRelayId: string } | null = null;
  let latencyProbeSequence = 0;
  const pendingLatencyProbes = new Map<string, { startedAt: number; resolve: (result: LatencyProbeResult | null) => void; timer: ReturnType<typeof setTimeout> }>();
  let commandSequence = 0;
  const pendingCommands = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let webrtcPeer: RTCPeerConnection | null = null;
  let webrtcOutputElement: SinkAudioElement | null = null;
  let webrtcPlaybackStream: MediaStream | null = null;
  let webrtcPlaybackRetryCleanup: (() => void) | null = null;
  let webrtcNegotiationPromise: Promise<void> | null = null;
  let webrtcFallbackStarted = false;
  const webrtcActive = ref(false);
  const identityMaterial = ref("");
  const storedVolumesByUid = reactive<Record<string, number>>({});
  let microphoneStartPromise: Promise<void> | null = null;

  // WebRTC carries audio when the gateway advertises it. The bounded PCM
  // WebSocket path remains the compatibility fallback for older browsers and
  // for deployments where the gateway's built-in UDP media range is unavailable.
  let audioCtx: SinkAudioContext | null = null;
  let micStream: MediaStream | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let workletContext: AudioContext | null = null;
  let workletModulePromise: Promise<void> | null = null;
  let rnnoiseNode: RnnoiseWorkletNode | null = null;
  let rnnoiseWorkletModulePromise: Promise<void> | null = null;
  let rnnoiseWasmPromise: Promise<ArrayBuffer> | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let micGain: GainNode | null = null;
  let silentGain: GainNode | null = null;
  let processedMicDestination: MediaStreamAudioDestinationNode | null = null;
  const accompanimentActive = ref(false);
  const accompanimentSupported = ref(typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia));
  const accompanimentErrorCode = ref<"" | "unsupported" | "needsWebRtc" | "noAudio" | "permission">("");
  let accompanimentStream: MediaStream | null = null;
  const screenShareStreams = reactive<ScreenShareStream[]>([]);
  const screenShareActive = ref(false);
  const screenShareStarting = ref(false);
  const screenShareActiveStreamId = ref("");
  const screenShareViewing = ref(false);
  const screenShareViewingStreamId = ref("");
  const screenShareRemoteStream = ref<MediaStream | null>(null);
  const screenShareError = ref("");
  const screenShareErrorCode = ref("");
  const screenShareRemoteVolume = ref(1);
  let screenShareLocalStream: MediaStream | null = null;
  // These are encoder/output limits. The display track itself must keep the
  // source resolution so selecting a high-resolution desktop or game window
  // never changes that source before capture.
  let screenShareOutputSettings: ScreenShareOutputSettings | null = null;
  const screenSharePeers = new Map<string, RTCPeerConnection>();
  const screenSharePeerRoles = new Map<string, "owner" | "viewer">();
  const screenShareWebRtcStats = reactive<ScreenShareWebRtcStats>({ updatedAt: null, capture: null, peers: [] });
  const screenShareStatsPrevious = new Map<string, { sampledAt: number; bytes: number | null; frames: number | null }>();
  let screenShareStatsTimer: ReturnType<typeof setInterval> | null = null;
  let screenShareStatsCollecting = false;
  const screenSharePendingIce = new Map<string, RTCIceCandidateInit[]>();
  const screenSharePeerStreams = new Map<string, MediaStream>();
  const screenSharePeerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let screenShareRequestSequence = 0;
  let screenSharePendingStartId = "";
  let screenShareStartCancelled = false;
  let screenShareStartGeneration = 0;
  let webrtcMixDestination: MediaStreamAudioDestinationNode | null = null;
  let webrtcMixMicSource: MediaStreamAudioSourceNode | null = null;
  let webrtcMixMicGain: GainNode | null = null;
  let webrtcMixAccompanimentSource: MediaStreamAudioSourceNode | null = null;
  let webrtcMicMonitorSource: MediaStreamAudioSourceNode | null = null;
  let webrtcMicMonitorAnalyser: AnalyserNode | null = null;
  let webrtcMicMonitorGain: GainNode | null = null;
  let webrtcMicMonitorTimer: ReturnType<typeof setInterval> | null = null;
  const inputDevices = reactive<AudioInputDevice[]>([]);
  const outputDevices = reactive<AudioOutputDevice[]>([]);
  const selectedInputDeviceId = ref(typeof localStorage !== "undefined" ? localStorage.getItem("webspeak:input-device") ?? "" : "");
  const selectedOutputDeviceId = ref(typeof localStorage !== "undefined" ? localStorage.getItem("webspeak:output-device") ?? "" : "");
  const outputDeviceSupported = ref(false);
  const audioPermission = ref<AudioPermission>("unknown");
  const microphoneProcessing = reactive<MicrophoneProcessingSettings>({
    echoCancellation: null,
    noiseSuppression: null,
    autoGainControl: null,
    rnnoise: null,
  });
  const audioContextState = ref<AudioContextState | "unknown">("unknown");
  const micLevel = ref(0);
  const microphoneTestActive = ref(false);
  const testAudioUrl = ref("");
  let testRecorder: MediaRecorder | null = null;
  let testRecorderTimer: ReturnType<typeof setTimeout> | null = null;
  const microphoneMuted = ref(false);
  const noiseSuppressionEnabled = ref(true);
  const inputVolume = ref(1);
  const outputVolume = ref(1);
  const outputMuted = ref(false);
  const notificationVolume = ref(0.5);
  const voxThreshold = ref(0.008);
  let voxAttack = 0;
  let voxRelease = 0;
  let convBuf = new Int16Array(1024);
  let accumBuf = new Int16Array(2048);
  let accumLen = 0;

  // Playback is kept per client so frames from multiple speakers cannot
  // interleave into one decoder or one scheduling queue.
  const remoteDecoders = new Map<number, AudioDecoder>();
  const remoteDecoderGenerations = new Map<number, number>();
  let nextRemoteDecoderGeneration = 0;
  const remotePlayTimes = new Map<number, number>();
  const remotePlaybackSources = new Map<number, Set<AudioBufferSourceNode>>();
  const remoteGains = new Map<number, GainNode>();
  const remoteDecodeTimestamps = new Map<number, number>();
  const volumes = reactive<Record<number, number>>({});
  const speakingIds = reactive(new Set<number>());
  const whisperTargetIds = reactive(new Set<number>());
  const whisperActive = ref(false);
  const speakingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  // Keep the WebSocket playback buffer below the 100 ms latency target. A
  // 20 ms frame plus three queued decoder frames leaves only a short cushion
  // for jitter; stale audio is discarded instead of being played late.
  let screenShareIceServers: RTCIceServer[] = [...DEFAULT_SCREEN_SHARE_ICE_SERVERS];
  return {
    ws,
    state,
    members,
    channels,
    chatMessages,
    serverEvents,
    pokeNotifications,
    connectionSequence,
    lastConnection: lastConnection as { target: string; channel: string; nickname: string; serverPassword: string; identity?: string; rememberIdentity: boolean; accelerated: boolean; accelerationRelayId: string } | null,
    latencyProbeSequence,
    pendingLatencyProbes,
    commandSequence,
    pendingCommands,
    webrtcPeer: webrtcPeer as RTCPeerConnection | null,
    webrtcOutputElement: webrtcOutputElement as SinkAudioElement | null,
    webrtcPlaybackStream: webrtcPlaybackStream as MediaStream | null,
    webrtcPlaybackRetryCleanup: webrtcPlaybackRetryCleanup as (() => void) | null,
    webrtcNegotiationPromise: webrtcNegotiationPromise as Promise<void> | null,
    webrtcFallbackStarted,
    webrtcActive,
    identityMaterial,
    storedVolumesByUid,
    microphoneStartPromise: microphoneStartPromise as Promise<void> | null,
    audioCtx: audioCtx as SinkAudioContext | null,
    micStream: micStream as MediaStream | null,
    scriptNode: scriptNode as ScriptProcessorNode | null,
    workletNode: workletNode as AudioWorkletNode | null,
    workletContext: workletContext as AudioContext | null,
    workletModulePromise: workletModulePromise as Promise<void> | null,
    rnnoiseNode: rnnoiseNode as RnnoiseWorkletNode | null,
    rnnoiseWorkletModulePromise: rnnoiseWorkletModulePromise as Promise<void> | null,
    rnnoiseWasmPromise: rnnoiseWasmPromise as Promise<ArrayBuffer> | null,
    micSource: micSource as MediaStreamAudioSourceNode | null,
    micGain: micGain as GainNode | null,
    silentGain: silentGain as GainNode | null,
    processedMicDestination: processedMicDestination as MediaStreamAudioDestinationNode | null,
    accompanimentActive,
    accompanimentSupported,
    accompanimentErrorCode,
    accompanimentStream: accompanimentStream as MediaStream | null,
    screenShareStreams,
    screenShareActive,
    screenShareStarting,
    screenShareActiveStreamId,
    screenShareViewing,
    screenShareViewingStreamId,
    screenShareRemoteStream,
    screenShareError,
    screenShareErrorCode,
    screenShareRemoteVolume,
    screenShareLocalStream: screenShareLocalStream as MediaStream | null,
    screenShareOutputSettings: screenShareOutputSettings as ScreenShareOutputSettings | null,
    screenSharePeers,
    screenSharePeerRoles,
    screenShareWebRtcStats,
    screenShareStatsPrevious,
    screenShareStatsTimer: screenShareStatsTimer as ReturnType<typeof setInterval> | null,
    screenShareStatsCollecting,
    screenSharePendingIce,
    screenSharePeerStreams,
    screenSharePeerTimers,
    screenShareRequestSequence,
    screenSharePendingStartId,
    screenShareStartCancelled,
    screenShareStartGeneration,
    webrtcMixDestination: webrtcMixDestination as MediaStreamAudioDestinationNode | null,
    webrtcMixMicSource: webrtcMixMicSource as MediaStreamAudioSourceNode | null,
    webrtcMixMicGain: webrtcMixMicGain as GainNode | null,
    webrtcMixAccompanimentSource: webrtcMixAccompanimentSource as MediaStreamAudioSourceNode | null,
    webrtcMicMonitorSource: webrtcMicMonitorSource as MediaStreamAudioSourceNode | null,
    webrtcMicMonitorAnalyser: webrtcMicMonitorAnalyser as AnalyserNode | null,
    webrtcMicMonitorGain: webrtcMicMonitorGain as GainNode | null,
    webrtcMicMonitorTimer: webrtcMicMonitorTimer as ReturnType<typeof setInterval> | null,
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    outputDeviceSupported,
    audioPermission,
    microphoneProcessing,
    audioContextState,
    micLevel,
    microphoneTestActive,
    testAudioUrl,
    testRecorder: testRecorder as MediaRecorder | null,
    testRecorderTimer: testRecorderTimer as ReturnType<typeof setTimeout> | null,
    microphoneMuted,
    noiseSuppressionEnabled,
    inputVolume,
    outputVolume,
    outputMuted,
    notificationVolume,
    voxThreshold,
    voxAttack,
    voxRelease,
    convBuf,
    accumBuf,
    accumLen,
    remoteDecoders,
    remoteDecoderGenerations,
    nextRemoteDecoderGeneration,
    remotePlayTimes,
    remotePlaybackSources,
    remoteGains,
    remoteDecodeTimestamps,
    volumes,
    speakingIds,
    whisperTargetIds,
    whisperActive,
    speakingTimers,
    screenShareIceServers,
    audioPreferencesReady: null as unknown as Promise<void>,
  };
}