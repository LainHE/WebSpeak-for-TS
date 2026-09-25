import { audioNoticeMessage, closeErrorCode, closeReason, connectionFailureMessage, joinTicketReason, normalizedClientErrorCode, protocolErrorMessage, safeClientErrorCode } from "./errors.js";
import { normalizeScreenShareIceServers } from "./ice-servers.js";
import { AUDIO_FRAME_BYTES, AUDIO_FRAME_SAMPLES, MAX_AUDIO_BUFFERED_BYTES, MAX_REMOTE_DECODE_QUEUE_FRAMES, MAX_REMOTE_PLAY_AHEAD_SECONDS } from "./constants.js";
import type { ChannelMember, LatencyProbeResult, ScreenShareSignal, ScreenShareStream, ServerEvent } from "./types.js";

export function setupWebSocket(vc: any) {

  function connect(target: string, channel: string, nickname: string, serverPassword = "", identity = "", rememberIdentity = false, inviteToken = "", accelerated = false, accelerationRelayId = ""): void {
    disconnect(true);
    vc.lastConnection = { target, channel, nickname, serverPassword, ...(identity ? { identity } : {}), rememberIdentity, accelerated, accelerationRelayId };
    vc.identityMaterial.value = identity;
    const sequence = ++vc.connectionSequence;
    vc.state.error = "";
    vc.state.errorCode = "";
    // Audio diagnostics belong to the previous session, never to the new one.
    vc.clearMicrophoneError();
    vc.clearAudioNotice();
    vc.state.connecting = true;
    vc.state.reconnecting = false;
    vc.state.reconnectAttempt = 0;
    vc.state.reconnectFailed = false;
    void vc.audioPreferencesReady.then(() => {
      if (sequence !== vc.connectionSequence) return;
      void openTicketedConnection(sequence, target, channel, nickname, serverPassword, inviteToken, accelerated);
    });
  }

  async function openTicketedConnection(sequence: number, target: string, channel: string, nickname: string, serverPassword: string, inviteToken: string, accelerated: boolean): Promise<void> {
    try {
      const response = await fetch("/api/join-ticket", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ target, nickname, channel, serverPassword, ...(inviteToken ? { invite: inviteToken } : {}), ...(accelerated ? { accelerated: true, ...(vc.lastConnection?.accelerationRelayId ? { accelerationRelayId: vc.lastConnection.accelerationRelayId } : {}) } : {}), ...(vc.lastConnection?.rememberIdentity && vc.lastConnection.identity ? { identity: vc.lastConnection.identity } : {}), ...(vc.lastConnection?.rememberIdentity ? { rememberIdentity: true } : {}) }),
      });
      const result = await response.json().catch(() => ({})) as { ticket?: unknown; code?: unknown; detail?: unknown };
      if (!response.ok || typeof result.ticket !== "string") {
        const failureCode = normalizedClientErrorCode(result.code);
        const failure = new Error(joinTicketReason(failureCode, result.detail));
        Object.assign(failure, { code: failureCode });
        throw failure;
      }
      if (sequence !== vc.connectionSequence) return;
      openVoiceSocket(sequence, result.ticket);
    } catch (error: unknown) {
      if (sequence !== vc.connectionSequence) return;
      vc.state.connecting = false;
      const errorRecord = error && typeof error === "object" ? error as { code?: unknown } : {};
      vc.state.errorCode = normalizedClientErrorCode(errorRecord.code, "REQUEST_FAILED");
      vc.state.error = error instanceof Error ? error.message : connectionFailureMessage(vc.state.errorCode);
    }
  }

  function openVoiceSocket(sequence: number, ticket: string): void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/ws/voice?ticket=${encodeURIComponent(ticket)}`);
    socket.binaryType = "arraybuffer";
    vc.ws.value = socket;
    socket.onopen = () => {
      if (sequence !== vc.connectionSequence) {
        socket.close(1000);
        return;
      }
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          handleMessage(JSON.parse(event.data));
        } catch {
          // Ignore malformed control frames.
        }
      } else {
        handleAudioFrame(new Uint8Array(event.data));
      }
    };
    socket.onclose = (event) => {
      if (sequence !== vc.connectionSequence) return;
      clearLatencyProbes();
      rejectPendingCommands(new Error("语音连接已关闭"));
      vc.state.connected = false;
      vc.state.connecting = false;
      vc.state.reconnecting = false;
      // Prefer the close code over the generic WebSocket error event. The
      // gateway uses a dedicated code when a remembered identity is already
      // active in another browser page.
      if (event.code !== 1000 && !vc.state.reconnectFailed && !vc.state.errorCode) {
        vc.state.errorCode = closeErrorCode(event.code, event.reason);
        vc.state.error = closeReason(event.code, event.reason);
      }
      vc.stopWebRtcTransport();
      vc.stopMicrophone();
      vc.clearMicrophoneError();
      vc.clearAudioNotice();
      vc.whisperTargetIds.clear();
      vc.whisperActive.value = false;
    };
    socket.onerror = () => {
      // The following close event contains the actionable close code. Do not
      // overwrite it with a generic browser WebSocket error first.
    };
  }

  function disconnect(preserveConnection = false): void {
    vc.connectionSequence++;
    clearLatencyProbes();
    rejectPendingCommands(new Error("语音连接已关闭"));
    const keepRememberedIdentity = vc.lastConnection?.rememberIdentity === true;
    if (!preserveConnection) vc.lastConnection = null;
    vc.stopMicrophone();
    vc.clearMicrophoneError();
    vc.clearAudioNotice();
    vc.stopScreenShareTransport(!preserveConnection);
    const socket = vc.ws.value;
    vc.ws.value = null;
    vc.stopWebRtcTransport();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000);
    vc.state.connected = false;
    vc.state.connecting = false;
    vc.state.reconnecting = false;
    vc.state.reconnectAttempt = 0;
    vc.state.reconnectFailed = false;
    vc.state.tsClientId = 0;
    vc.state.errorCode = "";
    vc.state.channelSwitchedChannelId = "";
    if (!keepRememberedIdentity) vc.identityMaterial.value = "";
    vc.members.length = 0;
    vc.channels.length = 0;
    vc.chatMessages.length = 0;
    for (const clientId of new Set([...vc.remoteDecoders.keys(), ...vc.remotePlaybackSources.keys()])) vc.clearRemotePlayback(clientId);
    vc.remoteDecoderGenerations.clear();
    vc.remotePlayTimes.clear();
    vc.remoteDecodeTimestamps.clear();
    for (const gain of vc.remoteGains.values()) gain.disconnect();
    vc.remoteGains.clear();
    vc.clearSpeakingState();
    vc.whisperTargetIds.clear();
    vc.whisperActive.value = false;
    for (const key of Object.keys(vc.volumes)) delete vc.volumes[Number(key)];
  }

  function clearLatencyProbes(): void {
    for (const [sequence, pending] of vc.pendingLatencyProbes) {
      clearTimeout(pending.timer);
      vc.pendingLatencyProbes.delete(sequence);
      pending.resolve(null);
    }
  }

  function rejectPendingCommands(error: Error): void {
    for (const [requestId, pending] of vc.pendingCommands) {
      clearTimeout(pending.timer);
      vc.pendingCommands.delete(requestId);
      pending.reject(error);
    }
  }

  function handleMessage(msg: any): void {
    switch (msg.type) {
      case "connected":
        const wasReconnecting = vc.state.reconnecting;
        vc.state.connected = true;
        vc.state.connecting = false;
        vc.state.reconnecting = false;
        vc.state.reconnectAttempt = 0;
        vc.state.reconnectFailed = false;
        vc.state.error = "";
        vc.state.errorCode = "";
        vc.state.channelSwitchedChannelId = "";
        vc.state.tsClientId = Number(msg.tsClientId) || 0;
        // The mute preference is local to the browser, while TeamSpeak shows
        // the gateway's own client_input_muted flag to other clients. Send it
        // as soon as the session is ready so a muted reconnect is visible to
        // native TeamSpeak users even before WebRTC negotiation completes.
        sendCmd("setMicrophoneMuted", { muted: vc.microphoneMuted.value });
        vc.screenShareIceServers = normalizeScreenShareIceServers(msg.screenShareIceServers);
        applyWhisperState(msg.whisperTargetIds, msg.whisperActive);
        if (Array.isArray(msg.members)) {
          vc.members.length = 0;
          for (const member of msg.members) {
            vc.members.push({ ...member, isSelf: Number(member.id) === vc.state.tsClientId });
          }
          vc.syncKnownMemberVolumes();
        }
        vc.serverEvents.length = 0;
        if (Array.isArray(msg.serverEventLog)) vc.serverEvents.push(...msg.serverEventLog);
        if (typeof msg.identity === "string" && msg.identity.length <= 8192) {
          vc.identityMaterial.value = msg.identity;
          if (vc.lastConnection) vc.lastConnection.identity = msg.identity;
        }
        if (wasReconnecting) {
          const start = msg.webrtcAvailable === true && typeof RTCPeerConnection !== "undefined"
            ? (vc.ws.value ? vc.startWebRtcTransport(vc.connectionSequence, vc.ws.value) : Promise.resolve())
            : vc.ensureMicrophone();
          // A failed microphone must not look like a failed connection: record it
          // as an audio diagnostic so the room stays visible with a clear reason.
          start.catch((error: unknown) => { vc.setMicrophoneError(error); });
        } else if (msg.webrtcAvailable === true && typeof RTCPeerConnection !== "undefined" && vc.ws.value) {
          void vc.startWebRtcTransport(vc.connectionSequence, vc.ws.value).catch((error: unknown) => { vc.setMicrophoneError(error); });
        } else {
          void vc.ensureMicrophone().catch((error: unknown) => { vc.setMicrophoneError(error); });
        }
        vc.sendScreenShareMessage({ type: "screenShareList" });
        break;
      case "screenShareList":
        vc.screenShareStreams.length = 0;
        if (Array.isArray(msg.streams)) for (const raw of msg.streams) vc.upsertScreenShareStream(raw);
        break;
      case "screenShareStarted": {
        const stream = vc.upsertScreenShareStream(msg.stream);
        if (!stream) break;
        if (msg.owner === true) {
          const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
          const isCurrentStart = Boolean(vc.screenSharePendingStartId) && requestId === vc.screenSharePendingStartId && !vc.screenShareStartCancelled;
          vc.screenSharePendingStartId = "";
          vc.screenShareStarting.value = false;
          if (!isCurrentStart) {
            vc.sendScreenShareMessage({ type: "screenShareStop", streamId: stream.streamId });
            vc.screenShareLocalStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
            vc.screenShareLocalStream = null;
            vc.screenShareOutputSettings = null;
            const staleIndex = vc.screenShareStreams.findIndex((candidate: ScreenShareStream) => candidate.streamId === stream.streamId);
            if (staleIndex >= 0) vc.screenShareStreams.splice(staleIndex, 1);
            break;
          }
          vc.screenShareActive.value = true;
          vc.screenShareActiveStreamId.value = stream.streamId;
        }
        break;
      }
      case "screenShareViewerCount": {
        const stream = vc.screenShareStreams.find((candidate: ScreenShareStream) => candidate.streamId === String(msg.streamId || ""));
        if (stream) {
          if (typeof msg.viewerCount === "number") stream.viewerCount = Math.max(0, Math.floor(msg.viewerCount));
          if (Array.isArray(msg.viewers)) stream.viewers = vc.normalizeScreenShareViewers(msg.viewers);
        }
        break;
      }
      case "screenShareStopped": {
        const streamId = String(msg.streamId || "");
        const index = vc.screenShareStreams.findIndex((candidate: ScreenShareStream) => candidate.streamId === streamId);
        if (index >= 0) vc.screenShareStreams.splice(index, 1);
        if (vc.screenShareActiveStreamId.value === streamId) {
          vc.closeAllScreenSharePeers();
          vc.screenShareStarting.value = false;
          vc.screenSharePendingStartId = "";
          vc.screenShareStartCancelled = false;
          vc.screenShareActive.value = false;
          vc.screenShareActiveStreamId.value = "";
          vc.screenShareLocalStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
          vc.screenShareLocalStream = null;
          vc.screenShareOutputSettings = null;
        }
        if (vc.screenShareViewingStreamId.value === streamId) {
          vc.closeAllScreenSharePeers();
          vc.screenShareViewing.value = false;
          vc.screenShareViewingStreamId.value = "";
          vc.screenShareRemoteStream.value = null;
        }
        break;
      }
      case "screenShareJoined": {
        const stream = vc.upsertScreenShareStream(msg.stream);
        if (!stream) break;
        void vc.startScreenShareViewer(stream);
        break;
      }
      case "screenShareNativeViewerJoined":
        if (typeof msg.streamId === "string" && typeof msg.viewerPeerId === "string") {
          void vc.startNativeScreenShareViewer(msg.streamId, msg.viewerPeerId);
        }
        break;
      case "screenShareSignal":
        if (typeof msg.streamId === "string" && typeof msg.fromPeerId === "string" && msg.signal) {
          void vc.handleScreenShareSignal(msg.streamId, msg.fromPeerId, msg.signal as ScreenShareSignal);
        }
        break;
      case "screenShareViewerLeft":
        if (typeof msg.viewerPeerId === "string") vc.closeScreenSharePeer(msg.viewerPeerId);
        break;
      case "screenShareLeft":
        if (vc.screenShareViewingStreamId.value === String(msg.streamId || "")) vc.leaveScreenShare();
        break;
      case "screenShareError":
        vc.screenShareErrorCode.value = typeof msg.code === "string" ? msg.code : "";
        vc.screenShareError.value = String(msg.message || "屏幕共享操作失败");
        if (vc.screenShareStarting.value) {
          vc.screenShareStarting.value = false;
          vc.screenSharePendingStartId = "";
          vc.screenShareStartCancelled = false;
          vc.screenShareLocalStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
          vc.screenShareLocalStream = null;
          vc.screenShareOutputSettings = null;
        }
        if (vc.screenShareViewing.value) {
          if (vc.screenShareViewingStreamId.value) vc.sendScreenShareMessage({ type: "screenShareLeave", streamId: vc.screenShareViewingStreamId.value });
          vc.closeAllScreenSharePeers();
          vc.screenShareViewing.value = false;
          vc.screenShareViewingStreamId.value = "";
          vc.screenShareRemoteStream.value = null;
        }
        break;
      case "memberEnter":
        if (!vc.members.some((member: ChannelMember) => member.id === msg.id)) {
          vc.members.push({ id: msg.id, nickname: msg.nickname, uid: typeof msg.uid === "string" ? msg.uid : undefined, avatar: typeof msg.avatar === "string" ? msg.avatar : undefined, isSelf: Boolean(msg.isSelf) });
          vc.syncKnownMemberVolumes();
        }
        break;
      case "memberLeave": {
        const clientId = Number(msg.id);
        vc.clearSpeaking(clientId);
        vc.clearRemotePlayback(clientId);
        const index = vc.members.findIndex((member: ChannelMember) => member.id === clientId);
        if (index >= 0) vc.members.splice(index, 1);
        break;
      }
      case "channelList":
        vc.channels.length = 0;
        if (Array.isArray(msg.channels)) {
          for (const channel of msg.channels) vc.channels.push(channel);
        }
        vc.syncKnownMemberVolumes();
        break;
      case "memberAvatar": {
        const clientId = Number(msg.id);
        const uid = typeof msg.uid === "string" ? msg.uid : "";
        const avatar = typeof msg.avatar === "string" ? msg.avatar : "";
        const member = vc.members.find((candidate: ChannelMember) => candidate.id === clientId && (!uid || candidate.uid === uid));
        if (member) member.avatar = avatar || undefined;
        for (const channel of vc.channels) {
          const channelMember = channel.members?.find((candidate: ChannelMember) => candidate.id === clientId && (!uid || candidate.uid === uid));
          if (channelMember) channelMember.avatar = avatar || undefined;
        }
        break;
      }
      case "chatMessage":
        if (Number(msg.invokerId) === vc.state.tsClientId) break;
        const incomingScope = msg.scope === "private" || msg.scope === "server" || msg.scope === "channel" ? msg.scope : "system";
        const rawTargetId = typeof msg.targetId === "string" || typeof msg.targetId === "number" ? String(msg.targetId) : undefined;
        // Older gateways and TeamSpeak channel notifications may use 0 as
        // the broadcast sentinel. It must not be compared with a channel id.
        const incomingTargetId = rawTargetId && rawTargetId !== "0" ? rawTargetId : undefined;
        vc.chatMessages.push({
          id: `remote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          scope: incomingScope,
          ...(incomingTargetId ? { targetId: incomingTargetId } : {}),
          ...(incomingScope === "private" ? { conversationId: String(Number(msg.invokerId) || 0) } : {}),
          senderId: Number(msg.invokerId) || undefined,
          senderUid: typeof msg.senderUid === "string" ? msg.senderUid : undefined,
          invokerName: String(msg.invokerName || "Unknown"),
          message: String(msg.message || ""),
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
        });
        break;
      case "serverEvent":
        if (msg.event && typeof msg.event.id === "string") vc.serverEvents.push(msg.event as ServerEvent);
        break;
      case "pokeReceived":
        vc.pokeNotifications.push({
          id: `poke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          invokerId: Number(msg.invokerId) || 0,
          invokerUid: typeof msg.invokerUid === "string" ? msg.invokerUid : "",
          invokerName: String(msg.invokerName || "Unknown"),
          message: String(msg.message || ""),
          timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
        });
        break;
      case "channelSwitched":
        vc.state.channelSwitchedChannelId = typeof msg.channelId === "string" || typeof msg.channelId === "number" ? String(msg.channelId) : "";
        vc.state.error = "";
        vc.state.errorCode = "";
        break;
      case "latencyPong": {
        const sequence = typeof msg.sequence === "string" ? msg.sequence : "";
        const pending = vc.pendingLatencyProbes.get(sequence);
        if (!pending) break;
        vc.pendingLatencyProbes.delete(sequence);
        clearTimeout(pending.timer);
        pending.resolve({
          browserRttMs: Math.max(0, Math.round(performance.now() - pending.startedAt)),
          teamSpeakLatencyMs: typeof msg.teamSpeakLatencyMs === "number" ? msg.teamSpeakLatencyMs : null,
          teamSpeakReachable: msg.teamSpeakReachable === true,
          ...(typeof msg.teamSpeakErrorCode === "string" ? { teamSpeakErrorCode: msg.teamSpeakErrorCode } : {}),
        });
        break;
      }
      case "disconnected":
        vc.state.connected = false;
        vc.state.connecting = false;
        vc.state.reconnecting = Boolean(msg.recoverable !== false);
        vc.state.reconnectFailed = false;
        if (!vc.state.reconnecting) vc.state.error = "TeamSpeak 连接已断开";
        vc.stopWebRtcTransport();
        vc.stopScreenShareTransport(false);
        vc.stopMicrophone();
        vc.whisperTargetIds.clear();
        vc.whisperActive.value = false;
        break;
      case "reconnecting":
        vc.state.connected = false;
        vc.state.connecting = false;
        vc.state.reconnecting = true;
        vc.state.reconnectFailed = false;
        vc.state.reconnectAttempt = Number(msg.attempt) || vc.state.reconnectAttempt + 1;
        vc.stopWebRtcTransport();
        vc.stopScreenShareTransport(false);
        vc.stopMicrophone();
        vc.whisperTargetIds.clear();
        vc.whisperActive.value = false;
        break;
      case "reconnected":
        vc.state.reconnecting = false;
        vc.state.reconnectFailed = false;
        break;
      case "reconnectFailed":
        vc.state.connected = false;
        vc.state.connecting = false;
        vc.state.reconnecting = false;
        vc.state.reconnectFailed = true;
        vc.state.errorCode = normalizedClientErrorCode(msg.code);
        vc.state.error = connectionFailureMessage(vc.state.errorCode, msg.detail);
        vc.stopScreenShareTransport(false);
        vc.whisperTargetIds.clear();
        vc.whisperActive.value = false;
        break;
      case "connectionFailed":
        vc.state.connected = false;
        vc.state.connecting = false;
        vc.state.reconnecting = false;
        // This is the first connection attempt, not a failed reconnect. Keep
        // the user on the welcome form instead of showing an empty voice room.
        vc.state.reconnectFailed = false;
        vc.state.errorCode = normalizedClientErrorCode(msg.code);
        vc.state.error = connectionFailureMessage(vc.state.errorCode, msg.detail);
        vc.stopScreenShareTransport(false);
        vc.whisperTargetIds.clear();
        vc.whisperActive.value = false;
        break;
      case "whisperTargets":
        applyWhisperState(msg.targetIds, msg.active);
        break;
      case "webrtcAnswer":
        void vc.applyWebRtcAnswer(msg.payload?.sdp);
        break;
      case "webrtcError":
        if (vc.ws.value) void vc.fallbackFromWebRtc(vc.connectionSequence, vc.ws.value, safeClientErrorCode(msg.code) || "WEBRTC_NEGOTIATION_FAILED");
        break;
      case "audioError": {
        // The gateway could not encode our microphone audio (for example its Opus
        // encoder is unavailable): say it instead of dropping frames silently.
        const audioCode = safeClientErrorCode(msg.code) || "AUDIO_ERROR";
        vc.setAudioNotice(audioCode, audioNoticeMessage(audioCode, msg.detail));
        break;
      }
      case "voiceActivity":
        if (Array.isArray(msg.clientIds)) {
          for (const clientId of msg.clientIds) {
            if (typeof clientId === "number" && Number.isInteger(clientId) && clientId > 0) vc.markSpeaking(clientId);
          }
        }
        break;
      case "commandCompleted": {
        const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
        const pending = requestId ? vc.pendingCommands.get(requestId) : undefined;
        if (pending) {
          clearTimeout(pending.timer);
          vc.pendingCommands.delete(requestId);
          pending.resolve();
        }
        break;
      }
      case "error":
        vc.state.errorCode = normalizedClientErrorCode(msg.error?.code, "OPERATION_FAILED");
        vc.state.error = protocolErrorMessage(vc.state.errorCode, String(msg.error?.message || msg.message || "操作失败"));
        {
          const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
          const pending = requestId ? vc.pendingCommands.get(requestId) : undefined;
          if (pending) {
            clearTimeout(pending.timer);
            vc.pendingCommands.delete(requestId);
            const error = new Error(vc.state.error);
            Object.assign(error, { code: vc.state.errorCode });
            pending.reject(error);
          }
        }
        break;
    }
  }

  function handleAudioFrame(data: Uint8Array): void {
    // WebRTC carries the realtime downlink after negotiation. Ignore any
    // in-flight fallback WebSocket packets so a transport switch cannot
    // produce duplicate or delayed playback.
    if (vc.webrtcActive.value) return;
    if (data.length < 4) return;
    const clientId = (data[1] << 8) | data[2];
    if (clientId === vc.state.tsClientId) return;
    vc.markSpeaking(clientId);
    vc.playAudioFrame(clientId, data.slice(3));
  }

  function sendCmd(type: string, payload: Record<string, unknown> = {}, requestId = ""): void {
    if (vc.ws.value?.readyState === WebSocket.OPEN) vc.ws.value.send(JSON.stringify({ type, payload, ...(requestId ? { requestId } : {}) }));
  }

  function sendCommandAndWait(type: string, payload: Record<string, unknown>, timeoutMs = 8_000): Promise<void> {
    if (vc.ws.value?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("语音连接尚未就绪"));
    const requestId = `command-${Date.now().toString(36)}-${(vc.commandSequence++).toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        vc.pendingCommands.delete(requestId);
        reject(new Error("操作超时，请稍后重试"));
      }, timeoutMs);
      vc.pendingCommands.set(requestId, { resolve, reject, timer });
      sendCmd(type, payload, requestId);
    });
  }

  function switchChannel(channelId: string, password = ""): void {
    vc.state.error = "";
    vc.state.errorCode = "";
    vc.state.channelSwitchedChannelId = "";
    sendCmd("switchChannel", { channelId, ...(password ? { password } : {}) });
  }

  function moveClient(clientId: number, channelId: string, password = ""): Promise<void> {
    return sendCommandAndWait("moveClient", { clientId, channelId, ...(password ? { password } : {}) });
  }

  function measureLatency(timeoutMs = 2_200): Promise<LatencyProbeResult | null> {
    const socket = vc.ws.value;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.resolve(null);
    const sequence = `latency-${Date.now().toString(36)}-${(vc.latencyProbeSequence++).toString(36)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        vc.pendingLatencyProbes.delete(sequence);
        resolve(null);
      }, timeoutMs);
      vc.pendingLatencyProbes.set(sequence, { startedAt: performance.now(), resolve, timer });
      sendCmd("latencyProbe", { sequence });
    });
  }

  function sendTextMessage(message: string, targetId = ""): void {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 500) return;
    sendCmd("sendTextMessage", { message: trimmed });
    vc.chatMessages.push({
      id: `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      scope: "channel",
      ...(targetId ? { targetId } : {}),
      senderId: vc.state.tsClientId,
      invokerName: "你",
      message: trimmed,
      timestamp: Date.now(),
      isSelf: true,
    });
  }

  function sendServerMessage(message: string): void {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 500) return;
    sendCmd("sendServerMessage", { message: trimmed });
    vc.chatMessages.push({ id: `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, scope: "server", senderId: vc.state.tsClientId, invokerName: "你", message: trimmed, timestamp: Date.now(), isSelf: true });
  }

  function sendPrivateMessage(clientId: number, message: string, targetId = ""): void {
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 500) return;
    sendCmd("sendPrivateMessage", { clientId, message: trimmed });
    vc.chatMessages.push({ id: `self-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, scope: "private", targetId, conversationId: String(clientId), senderId: vc.state.tsClientId, invokerName: "你", message: trimmed, timestamp: Date.now(), isSelf: true });
  }

  function sendPoke(clientId: number, message = ""): void {
    sendCmd("poke", { clientId, message: message.trim().slice(0, 200) });
  }

  function setAway(away: boolean, message = ""): void {
    sendCmd("setAway", { away, message: message.trim().slice(0, 200) });
  }

  function setWhisperTargets(clientIds: number[]): void {
    const targets = [...new Set(clientIds)].filter((clientId) => Number.isInteger(clientId) && clientId > 0 && clientId <= 65535 && clientId !== vc.state.tsClientId).slice(0, 8);
    vc.whisperTargetIds.clear();
    for (const clientId of targets) vc.whisperTargetIds.add(clientId);
    if (!targets.length) vc.whisperActive.value = false;
    sendCmd("setWhisperTargets", { targetIds: targets });
  }

  function setWhisperActive(active: boolean): void {
    if (active && !vc.whisperTargetIds.size) return;
    vc.whisperActive.value = active;
    sendCmd("setWhisperActive", { active });
  }

  function applyWhisperState(targetIds: unknown, active: unknown): void {
    vc.whisperTargetIds.clear();
    if (Array.isArray(targetIds)) {
      for (const clientId of targetIds) {
        if (typeof clientId === "number" && Number.isInteger(clientId) && clientId > 0 && clientId <= 65535 && clientId !== vc.state.tsClientId) vc.whisperTargetIds.add(clientId);
      }
    }
    vc.whisperActive.value = active === true && vc.whisperTargetIds.size > 0;
  }

  function reconnectNow(): void {
    if (!vc.lastConnection || vc.state.connecting) return;
    connect(vc.lastConnection.target, vc.lastConnection.channel, vc.lastConnection.nickname, vc.lastConnection.serverPassword, vc.lastConnection.rememberIdentity ? vc.identityMaterial.value || vc.lastConnection.identity : "", vc.lastConnection.rememberIdentity, "", vc.lastConnection.accelerated, vc.lastConnection.accelerationRelayId);
  }

  function clearError(): void {
    vc.state.error = "";
    vc.state.errorCode = "";
  }
  return {
    connect,
    reconnectNow,
    disconnect,
    switchChannel,
    moveClient,
    sendTextMessage,
    sendServerMessage,
    sendPrivateMessage,
    sendPoke,
    setAway,
    setWhisperTargets,
    setWhisperActive,
    clearError,
    measureLatency,
  };
}