import type { ScreenShareCaptureStats, ScreenShareOutputSettings, ScreenSharePeerStats, ScreenShareSignal, ScreenShareStream, ScreenShareViewer } from "./types.js";
import { SCREEN_SHARE_NEGOTIATION_TIMEOUT_MS } from "./ice-servers.js";

export function setupScreenShare(vc: any) {

  function sendScreenShareMessage(message: Record<string, unknown>): void {
    if (vc.ws.value?.readyState === WebSocket.OPEN) vc.ws.value.send(JSON.stringify(message));
  }

  type ScreenShareStatsRecord = Record<string, unknown>;

  function screenShareStatsRecord(value: unknown): ScreenShareStatsRecord {
    return value && typeof value === "object" ? value as ScreenShareStatsRecord : {};
  }

  function screenShareStatsNumber(stats: ScreenShareStatsRecord | undefined, key: string): number | null {
    const value = stats?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function screenShareStatsString(stats: ScreenShareStatsRecord | undefined, key: string): string | null {
    const value = stats?.[key];
    return typeof value === "string" && value ? value : null;
  }

  function screenShareVideoStatsKind(stats: ScreenShareStatsRecord): string {
    return screenShareStatsString(stats, "kind") ?? screenShareStatsString(stats, "mediaType") ?? "";
  }

  function screenShareStatsCapture(): ScreenShareCaptureStats | null {
    const track = vc.screenShareLocalStream?.getVideoTracks()[0];
    if (!track) return null;
    const settings = track.getSettings();
    return {
      width: typeof settings.width === "number" ? settings.width : null,
      height: typeof settings.height === "number" ? settings.height : null,
      frameRate: typeof settings.frameRate === "number" ? settings.frameRate : null,
    };
  }

  async function collectScreenSharePeerStats(peerId: string, peer: RTCPeerConnection, role: "owner" | "viewer"): Promise<ScreenSharePeerStats | null> {
    try {
      const report = await peer.getStats();
      const records = new Map<string, ScreenShareStatsRecord>();
      let mediaStats: ScreenShareStatsRecord | undefined;
      let remoteInboundStats: ScreenShareStatsRecord | undefined;
      let trackStats: ScreenShareStatsRecord | undefined;
      let candidatePairStats: ScreenShareStatsRecord | undefined;
      report.forEach((raw) => {
        const stats = screenShareStatsRecord(raw);
        const id = screenShareStatsString(stats, "id");
        if (id) records.set(id, stats);
        const type = screenShareStatsString(stats, "type");
        const kind = screenShareVideoStatsKind(stats);
        if (type === "outbound-rtp" && kind === "video" && role === "owner") mediaStats = stats;
        if (type === "inbound-rtp" && kind === "video" && role === "viewer") mediaStats = stats;
        if (type === "remote-inbound-rtp" && kind === "video" && role === "owner") remoteInboundStats = stats;
        if (type === "track" && kind === "video") trackStats = stats;
        if (type === "candidate-pair" && (stats.selected === true || stats.nominated === true || screenShareStatsString(stats, "state") === "succeeded")) candidatePairStats = stats;
      });

      const codecId = screenShareStatsString(mediaStats, "codecId");
      const codecStats = codecId ? records.get(codecId) : undefined;
      const localCandidateId = screenShareStatsString(candidatePairStats, "localCandidateId");
      const localCandidate = localCandidateId ? records.get(localCandidateId) : undefined;
      const remoteCandidateId = screenShareStatsString(candidatePairStats, "remoteCandidateId");
      const remoteCandidate = remoteCandidateId ? records.get(remoteCandidateId) : undefined;
      const remoteStats = role === "owner" ? remoteInboundStats : undefined;
      const frames = screenShareStatsNumber(mediaStats, role === "owner" ? "framesEncoded" : "framesDecoded")
        ?? screenShareStatsNumber(mediaStats, role === "owner" ? "framesSent" : "framesReceived");
      const bytes = screenShareStatsNumber(mediaStats, role === "owner" ? "bytesSent" : "bytesReceived");
      const now = performance.now();
      const previous = vc.screenShareStatsPrevious.get(peerId);
      const elapsedMs = previous ? now - previous.sampledAt : 0;
      const derivedFrameRate = previous && elapsedMs >= 250 && frames !== null && previous.frames !== null
        ? Math.max(0, ((frames - previous.frames) * 1_000) / elapsedMs)
        : null;
      const derivedBitrateKbps = previous && elapsedMs >= 250 && bytes !== null && previous.bytes !== null
        ? Math.max(0, ((bytes - previous.bytes) * 8) / elapsedMs)
        : null;
      vc.screenShareStatsPrevious.set(peerId, { sampledAt: now, bytes, frames });

      const packetsLost = screenShareStatsNumber(remoteStats ?? mediaStats, "packetsLost");
      const packetsTransferred = screenShareStatsNumber(mediaStats, role === "owner" ? "packetsSent" : "packetsReceived");
      const packetsTotal = packetsTransferred === null || packetsLost === null ? null : packetsTransferred + packetsLost;
      const lossPercent = packetsTotal && packetsTotal > 0 && packetsLost !== null ? (packetsLost / packetsTotal) * 100 : null;
      const currentRoundTripTime = screenShareStatsNumber(remoteStats, "roundTripTime") ?? screenShareStatsNumber(candidatePairStats, "currentRoundTripTime");
      const jitter = screenShareStatsNumber(remoteStats ?? mediaStats, "jitter");
      const directFrameRate = screenShareStatsNumber(mediaStats, "framesPerSecond") ?? screenShareStatsNumber(trackStats, "framesPerSecond");
      const directBitrateKbps = screenShareStatsNumber(mediaStats, "bitrate") !== null ? (screenShareStatsNumber(mediaStats, "bitrate") as number) / 1_000 : null;
      return {
        peerId,
        role,
        direction: role === "owner" ? "outbound" : "inbound",
        connectionState: peer.connectionState,
        iceConnectionState: peer.iceConnectionState,
        codec: screenShareStatsString(codecStats, "mimeType"),
        candidateType: screenShareStatsString(localCandidate, "candidateType") ?? screenShareStatsString(remoteCandidate, "candidateType"),
        width: screenShareStatsNumber(mediaStats, "frameWidth") ?? screenShareStatsNumber(trackStats, "frameWidth"),
        height: screenShareStatsNumber(mediaStats, "frameHeight") ?? screenShareStatsNumber(trackStats, "frameHeight"),
        frameRate: directFrameRate !== null && directFrameRate > 0 ? directFrameRate : derivedFrameRate,
        bitrateKbps: directBitrateKbps ?? derivedBitrateKbps,
        packetsLost,
        packetsTotal,
        lossPercent,
        framesDropped: screenShareStatsNumber(mediaStats, "framesDropped") ?? screenShareStatsNumber(trackStats, "framesDropped"),
        jitterMs: jitter === null ? null : jitter * 1_000,
        roundTripTimeMs: currentRoundTripTime === null ? null : currentRoundTripTime * 1_000,
        availableOutgoingBitrateKbps: screenShareStatsNumber(candidatePairStats, "availableOutgoingBitrate") === null
          ? null
          : (screenShareStatsNumber(candidatePairStats, "availableOutgoingBitrate") as number) / 1_000,
        qualityLimitationReason: screenShareStatsString(mediaStats, "qualityLimitationReason"),
      };
    } catch {
      return null;
    }
  }

  async function collectScreenShareWebRtcStats(): Promise<void> {
    if (vc.screenShareStatsCollecting || !vc.screenSharePeers.size) return;
    vc.screenShareStatsCollecting = true;
    try {
      const peers = await Promise.all([...vc.screenSharePeers.entries()].map(async ([peerId, peer]) => {
        const role = vc.screenSharePeerRoles.get(peerId) ?? "viewer";
        return collectScreenSharePeerStats(peerId, peer, role);
      }));
      vc.screenShareWebRtcStats.capture = screenShareStatsCapture();
      vc.screenShareWebRtcStats.peers = peers.filter((stats): stats is ScreenSharePeerStats => stats !== null);
      vc.screenShareWebRtcStats.updatedAt = Date.now();
    } finally {
      vc.screenShareStatsCollecting = false;
    }
  }

  function startScreenShareStatsPolling(): void {
    if (vc.screenShareStatsTimer) return;
    void collectScreenShareWebRtcStats();
    vc.screenShareStatsTimer = setInterval(() => { void collectScreenShareWebRtcStats(); }, 1_000);
  }

  function stopScreenShareStatsPolling(): void {
    if (vc.screenShareStatsTimer) {
      clearInterval(vc.screenShareStatsTimer);
      vc.screenShareStatsTimer = null;
    }
    vc.screenShareStatsPrevious.clear();
    vc.screenShareWebRtcStats.updatedAt = null;
    vc.screenShareWebRtcStats.capture = null;
    vc.screenShareWebRtcStats.peers = [];
  }

  function clearScreenSharePeerTimer(peerId: string): void {
    const timer = vc.screenSharePeerTimers.get(peerId);
    if (!timer) return;
    clearTimeout(timer);
    vc.screenSharePeerTimers.delete(peerId);
  }

  function armScreenSharePeerTimer(peerId: string): void {
    clearScreenSharePeerTimer(peerId);
    vc.screenSharePeerTimers.set(peerId, setTimeout(() => {
      vc.screenSharePeerTimers.delete(peerId);
      if (!vc.screenSharePeers.has(peerId)) return;
      failScreenSharePeer(peerId, "屏幕共享直连协商超时，请确认双方网络允许浏览器直连");
    }, SCREEN_SHARE_NEGOTIATION_TIMEOUT_MS));
  }

  function closeScreenSharePeer(peerId: string): void {
    clearScreenSharePeerTimer(peerId);
    const peer = vc.screenSharePeers.get(peerId);
    vc.screenSharePeers.delete(peerId);
    vc.screenSharePeerRoles.delete(peerId);
    vc.screenShareStatsPrevious.delete(peerId);
    vc.screenSharePendingIce.delete(peerId);
    vc.screenSharePeerStreams.delete(peerId);
    try { peer?.close(); } catch { /* closing an already closed peer is harmless */ }
    if (!vc.screenSharePeers.size) stopScreenShareStatsPolling();
  }

  function closeAllScreenSharePeers(): void {
    for (const peerId of [...vc.screenSharePeers.keys()]) closeScreenSharePeer(peerId);
  }

  function setScreenShareP2PError(message = "直连 P2P 失败，当前网络无法建立浏览器之间的直接连接") {
    vc.screenShareErrorCode.value = "";
    vc.screenShareError.value = message;
  }

  function failScreenSharePeer(peerId: string, message?: string): void {
    const viewingStream = vc.screenShareStreams.find((stream: ScreenShareStream) => stream.streamId === vc.screenShareViewingStreamId.value && stream.ownerPeerId === peerId);
    if (viewingStream) sendScreenShareMessage({ type: "screenShareLeave", streamId: viewingStream.streamId });
    closeScreenSharePeer(peerId);
    if (viewingStream) {
      vc.screenShareViewing.value = false;
      vc.screenShareViewingStreamId.value = "";
      vc.screenShareRemoteStream.value = null;
    }
    setScreenShareP2PError(message);
  }

  function createScreenSharePeer(streamId: string, peerId: string, role: "owner" | "viewer"): RTCPeerConnection {
    const existing = vc.screenSharePeers.get(peerId);
    if (existing) return existing;
    // STUN discovers server-reflexive candidates; it does not carry media.
    // TURN is accepted only when explicitly configured by the deployment, and
    // would use that external TURN service rather than the WebSpeak gateway.
    const peer = new RTCPeerConnection({ iceServers: vc.screenShareIceServers });
    vc.screenSharePeers.set(peerId, peer);
    vc.screenSharePeerRoles.set(peerId, role);
    startScreenShareStatsPolling();
    if (role === "owner") {
      for (const track of vc.screenShareLocalStream?.getTracks() ?? []) {
        const sender = peer.addTrack(track, vc.screenShareLocalStream!);
        if (track.kind === "video") void configureScreenShareVideoSender(sender, track);
      }
    } else {
      peer.addTransceiver("video", { direction: "recvonly" });
      const stream = vc.screenShareStreams.find((candidate: ScreenShareStream) => candidate.streamId === streamId);
      if (stream?.audio) peer.addTransceiver("audio", { direction: "recvonly" });
    }
    preferScreenShareCodecs(peer);
    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate;
      sendScreenShareMessage({
        type: "screenShareSignal",
        streamId,
        targetPeerId: peerId,
        signal: {
          kind: "iceCandidate",
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        },
      });
    };
    peer.ontrack = (event) => {
      if (role !== "viewer") return;
      clearScreenSharePeerTimer(peerId);
      const remote = event.streams[0] ?? vc.screenSharePeerStreams.get(peerId) ?? new MediaStream();
      if (!event.streams[0]) remote.addTrack(event.track);
      vc.screenSharePeerStreams.set(peerId, remote);
      vc.screenShareRemoteStream.value = remote;
      vc.screenShareViewing.value = true;
    };
    peer.onconnectionstatechange = () => {
      // `completed` belongs to RTCIceConnectionState, not the aggregate
      // RTCPeerConnection.connectionState. Treating it as a connection vc.state
      // both trips the type checker and can hide the actual failed/closed
      // transitions we need to handle here.
      if (peer.connectionState === "connected") {
        clearScreenSharePeerTimer(peerId);
      } else if (peer.connectionState === "failed") {
        failScreenSharePeer(peerId);
      }
      if (peer.connectionState === "closed" && vc.screenSharePeers.get(peerId) === peer) closeScreenSharePeer(peerId);
    };
    return peer;
  }

  async function configureScreenShareVideoSender(sender: RTCRtpSender, track: MediaStreamTrack): Promise<void> {
    if (!sender.setParameters || track.kind !== "video") return;
    try {
      const settings = track.getSettings();
      const requested = vc.screenShareOutputSettings;
      const sourceWidth = typeof settings.width === "number" && settings.width > 0 ? settings.width : null;
      const sourceHeight = typeof settings.height === "number" && settings.height > 0 ? settings.height : null;
      const targetWidth = requested?.maxWidth ?? sourceWidth;
      const targetHeight = requested?.maxHeight ?? sourceHeight;
      const scaleResolutionDownBy = sourceWidth && sourceHeight && targetWidth && targetHeight
        ? Math.max(1, sourceWidth / targetWidth, sourceHeight / targetHeight)
        : 1;
      const sourceFrameRate = typeof settings.frameRate === "number" && settings.frameRate > 0 ? settings.frameRate : null;
      const targetFrameRate = requested?.maxFrameRate
        ? Math.max(1, Math.min(requested.maxFrameRate, sourceFrameRate ?? requested.maxFrameRate))
        : sourceFrameRate;
      const parameters = sender.getParameters();
      const encodings = parameters.encodings?.length ? parameters.encodings : [{}];
      const firstEncoding = { ...encodings[0] };
      if (scaleResolutionDownBy > 1.01) firstEncoding.scaleResolutionDownBy = scaleResolutionDownBy;
      if (targetFrameRate) firstEncoding.maxFramerate = targetFrameRate;
      parameters.encodings = [firstEncoding, ...encodings.slice(1)];
      // Prefer keeping motion smooth and let the encoder reduce detail/resolution
      // before it throws away large numbers of frames under pressure.
      parameters.degradationPreference = "maintain-framerate";
      await sender.setParameters(parameters);
    } catch {
      // Older browsers may reject one of the optional sender parameters. The
      // track remains usable and the diagnostics panel still exposes the real
      // negotiated frame rate and dimensions.
    }
  }

  function preferScreenShareCodecs(peer: RTCPeerConnection): void {
    const transceiver = peer.getTransceivers().find((candidate) => candidate.sender.track?.kind === "video" || candidate.receiver.track?.kind === "video");
    const capabilities = typeof RTCRtpReceiver !== "undefined" ? RTCRtpReceiver.getCapabilities?.("video") : null;
    if (!transceiver?.setCodecPreferences || !capabilities?.codecs?.length) return;
    const vp8 = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() === "video/vp8");
    if (!vp8.length) return;
    const remaining = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() !== "video/vp8");
    try { transceiver.setCodecPreferences([...vp8, ...remaining]); } catch { /* older browsers may reject codec preference changes */ }
  }

  async function flushScreenShareCandidates(peerId: string, peer: RTCPeerConnection): Promise<void> {
    const pending = vc.screenSharePendingIce.get(peerId) ?? [];
    vc.screenSharePendingIce.delete(peerId);
    for (const candidate of pending) {
      try { await peer.addIceCandidate(candidate); } catch { /* an obsolete candidate can be ignored */ }
    }
  }

  async function startScreenShareViewer(stream: ScreenShareStream): Promise<void> {
    closeAllScreenSharePeers();
    vc.screenShareRemoteStream.value = null;
    vc.screenShareViewing.value = true;
    vc.screenShareViewingStreamId.value = stream.streamId;
    vc.screenShareErrorCode.value = "";
    vc.screenShareError.value = "";
    const peer = createScreenSharePeer(stream.streamId, stream.ownerPeerId, "viewer");
    if (stream.source === "teamspeak") {
      armScreenSharePeerTimer(stream.ownerPeerId);
      return;
    }
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      armScreenSharePeerTimer(stream.ownerPeerId);
      sendScreenShareMessage({
        type: "screenShareSignal",
        streamId: stream.streamId,
        targetPeerId: stream.ownerPeerId,
        signal: { kind: "offer", sdp: peer.localDescription?.sdp ?? offer.sdp ?? "" },
      });
    } catch {
      failScreenSharePeer(stream.ownerPeerId, "无法创建屏幕共享直连请求，请重试");
    }
  }

  async function startNativeScreenShareViewer(streamId: string, peerId: string): Promise<void> {
    const stream = vc.screenShareStreams.find((candidate: ScreenShareStream) => candidate.streamId === streamId);
    if (!stream || stream.source !== "browser" || vc.screenShareActiveStreamId.value !== streamId || stream.ownerPeerId !== screenShareLocalPeerId()) return;
    closeScreenSharePeer(peerId);
    const peer = createScreenSharePeer(streamId, peerId, "owner");
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      armScreenSharePeerTimer(peerId);
      sendScreenShareMessage({
        type: "screenShareSignal",
        streamId,
        targetPeerId: peerId,
        signal: { kind: "offer", sdp: peer.localDescription?.sdp ?? offer.sdp ?? "" },
      });
    } catch {
      failScreenSharePeer(peerId, "无法为 TeamSpeak 观看端创建屏幕共享直连");
    }
  }

  async function handleScreenShareSignal(streamId: string, fromPeerId: string, signal: ScreenShareSignal): Promise<void> {
    const stream = vc.screenShareStreams.find((candidate: ScreenShareStream) => candidate.streamId === streamId);
    if (!stream) return;
    if (signal.kind === "close") {
      closeScreenSharePeer(fromPeerId);
      if (vc.screenShareViewingStreamId.value === streamId) {
        vc.screenShareViewing.value = false;
        vc.screenShareViewingStreamId.value = "";
        vc.screenShareRemoteStream.value = null;
      }
      return;
    }
    if (signal.kind === "iceCandidate") {
      if (!signal.candidate) return;
      const peer = vc.screenSharePeers.get(fromPeerId);
      const candidate: RTCIceCandidateInit = {
        candidate: signal.candidate,
        ...(signal.sdpMid !== undefined ? { sdpMid: signal.sdpMid } : {}),
        ...(signal.sdpMLineIndex !== undefined ? { sdpMLineIndex: signal.sdpMLineIndex } : {}),
      };
      if (!peer?.remoteDescription) {
        vc.screenSharePendingIce.set(fromPeerId, [...(vc.screenSharePendingIce.get(fromPeerId) ?? []), candidate]);
        return;
      }
      try { await peer.addIceCandidate(candidate); } catch { /* stale ICE is not fatal */ }
      return;
    }

    if (stream.source === "teamspeak" && vc.screenShareViewingStreamId.value === streamId && fromPeerId === stream.ownerPeerId && signal.kind === "offer") {
      const peer = vc.screenSharePeers.get(fromPeerId) ?? createScreenSharePeer(streamId, fromPeerId, "viewer");
      if (!signal.sdp) return;
      armScreenSharePeerTimer(fromPeerId);
      try {
        await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        await flushScreenShareCandidates(fromPeerId, peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendScreenShareMessage({ type: "screenShareSignal", streamId, targetPeerId: fromPeerId, signal: { kind: "answer", sdp: answer.sdp ?? "" } });
      } catch {
        failScreenSharePeer(fromPeerId, "无法回复 TeamSpeak 屏幕共享的直连请求");
      }
      return;
    }

    if (stream.source === "browser" && vc.screenShareActiveStreamId.value === streamId && stream.ownerPeerId === screenShareLocalPeerId() && fromPeerId.startsWith("ts-viewer-") && signal.kind === "answer") {
      const peer = vc.screenSharePeers.get(fromPeerId);
      if (!peer || !signal.sdp) return;
      try {
        await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        await flushScreenShareCandidates(fromPeerId, peer);
      } catch {
        failScreenSharePeer(fromPeerId, "TeamSpeak 观看端无法完成屏幕共享直连协商");
      }
      return;
    }

    if (stream.source === "browser" && stream.ownerPeerId === fromPeerId && signal.kind === "answer") {
      const peer = vc.screenSharePeers.get(fromPeerId);
      if (!peer || !signal.sdp) return;
      try {
        await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        await flushScreenShareCandidates(fromPeerId, peer);
      } catch {
        failScreenSharePeer(fromPeerId, "观看端无法完成屏幕共享直连协商");
      }
      return;
    }

    if (vc.screenShareActiveStreamId.value === streamId && stream.ownerPeerId === screenShareLocalPeerId()) {
      const peer = vc.screenSharePeers.get(fromPeerId) ?? createScreenSharePeer(streamId, fromPeerId, "owner");
      if (signal.kind !== "offer" || !signal.sdp) return;
      armScreenSharePeerTimer(fromPeerId);
      try {
        await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        await flushScreenShareCandidates(fromPeerId, peer);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendScreenShareMessage({ type: "screenShareSignal", streamId, targetPeerId: fromPeerId, signal: { kind: "answer", sdp: answer.sdp ?? "" } });
      } catch {
        setScreenShareP2PError("共享端无法完成观看者的直连协商");
      }
    }
  }

  // The owner peer id is generated by the gateway and is returned in the
  // screenShareStarted event; the active stream's owner id is therefore the
  // only stable local-owner marker available to the browser.
  function screenShareLocalPeerId(): string {
    const active = vc.screenShareStreams.find((stream: ScreenShareStream) => stream.streamId === vc.screenShareActiveStreamId.value);
    return active?.ownerPeerId ?? "";
  }

  async function startScreenShare(audio = true, settings?: ScreenShareOutputSettings): Promise<void> {
    if (vc.ws.value?.readyState !== WebSocket.OPEN || vc.screenShareActive.value || vc.screenShareStarting.value) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      vc.screenShareError.value = "当前浏览器不支持屏幕共享";
      return;
    }
    vc.screenShareErrorCode.value = "";
    vc.screenShareError.value = "";
    const startGeneration = ++vc.screenShareStartGeneration;
    vc.screenShareStarting.value = true;
    vc.screenShareStartCancelled = false;
    vc.screenShareOutputSettings = settings ?? null;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        // Capture the selected surface at its native browser-provided size.
        // Output resolution/FPS are applied later on each RTCRtpSender so the
        // user's desktop or application window is never resized or sampled at
        // the output limit.
        video: true,
        audio,
        // These are preferences: when the selected surface is a window, ask
        // for that window's audio; when it is a monitor, allow system audio.
        // The browser/OS may still return no audio or ignore the preference.
        systemAudio: "include",
        windowAudio: "window",
        selfBrowserSurface: "exclude",
      } as unknown as DisplayMediaStreamOptions);
      if (startGeneration !== vc.screenShareStartGeneration || !vc.screenShareStarting.value || vc.screenShareStartCancelled) {
        stream.getTracks().forEach((track) => track.stop());
        vc.screenShareOutputSettings = null;
        return;
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) throw new Error("NO_VIDEO_TRACK");
      const displaySurface = videoTrack.getSettings().displaySurface;
      if ("contentHint" in videoTrack) videoTrack.contentHint = displaySurface === "browser" ? "detail" : "motion";
      vc.screenShareLocalStream = stream;
      vc.screenShareRequestSequence = (vc.screenShareRequestSequence + 1) % 1_000_000;
      vc.screenSharePendingStartId = `screen-start-${vc.screenShareRequestSequence}`;
      for (const track of stream.getTracks()) track.addEventListener("ended", () => { void stopScreenShare(); }, { once: true });
      sendScreenShareMessage({ type: "screenShareStart", requestId: vc.screenSharePendingStartId, audio: stream.getAudioTracks().length > 0, name: "我的屏幕" });
    } catch (error: unknown) {
      if (startGeneration !== vc.screenShareStartGeneration) return;
      vc.screenShareLocalStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      vc.screenShareLocalStream = null;
      vc.screenShareOutputSettings = null;
      vc.screenShareStarting.value = false;
      vc.screenSharePendingStartId = "";
      vc.screenShareStartCancelled = false;
      if (error instanceof DOMException && error.name === "NotAllowedError") vc.screenShareError.value = "你取消了屏幕共享或浏览器未授予权限";
      else vc.screenShareError.value = "无法开始屏幕共享，请检查浏览器权限";
    }
  }

  function stopScreenShare(): void {
    vc.screenShareStartGeneration += 1;
    if (vc.screenShareStarting.value) vc.screenShareStartCancelled = true;
    if (vc.screenShareActive.value && vc.screenShareActiveStreamId.value) sendScreenShareMessage({ type: "screenShareStop", streamId: vc.screenShareActiveStreamId.value });
    closeAllScreenSharePeers();
    vc.screenShareLocalStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    vc.screenShareLocalStream = null;
    vc.screenShareOutputSettings = null;
    vc.screenShareStarting.value = false;
    vc.screenSharePendingStartId = "";
    vc.screenShareStartCancelled = false;
    vc.screenShareActive.value = false;
    vc.screenShareActiveStreamId.value = "";
  }

  function joinScreenShare(streamId: string): void {
    vc.screenShareErrorCode.value = "";
    vc.screenShareError.value = "";
    if (vc.screenShareViewingStreamId.value && vc.screenShareViewingStreamId.value !== streamId) leaveScreenShare();
    vc.screenShareRequestSequence = (vc.screenShareRequestSequence + 1) % 1_000_000;
    sendScreenShareMessage({ type: "screenShareJoin", streamId, requestId: `screen-join-${vc.screenShareRequestSequence}` });
  }

  function leaveScreenShare(): void {
    if (vc.screenShareViewingStreamId.value) sendScreenShareMessage({ type: "screenShareLeave", streamId: vc.screenShareViewingStreamId.value });
    closeAllScreenSharePeers();
    vc.screenShareViewing.value = false;
    vc.screenShareViewingStreamId.value = "";
    vc.screenShareRemoteStream.value = null;
  }

  function stopScreenShareTransport(sendStop: boolean): void {
    vc.screenShareStartGeneration += 1;
    if (sendStop && vc.screenShareActive.value && vc.screenShareActiveStreamId.value) sendScreenShareMessage({ type: "screenShareStop", streamId: vc.screenShareActiveStreamId.value });
    if (vc.screenShareStarting.value) vc.screenShareStartCancelled = true;
    closeAllScreenSharePeers();
    vc.screenShareLocalStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    vc.screenShareLocalStream = null;
    vc.screenShareOutputSettings = null;
    vc.screenShareStarting.value = false;
    vc.screenSharePendingStartId = "";
    vc.screenShareStartCancelled = false;
    vc.screenShareActive.value = false;
    vc.screenShareActiveStreamId.value = "";
    vc.screenShareViewing.value = false;
    vc.screenShareViewingStreamId.value = "";
    vc.screenShareRemoteStream.value = null;
    vc.screenShareStreams.length = 0;
  }

  function upsertScreenShareStream(raw: unknown): ScreenShareStream | null {
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Partial<ScreenShareStream>;
    if (typeof value.streamId !== "string" || typeof value.ownerPeerId !== "string") return null;
    const stream: ScreenShareStream = {
      streamId: value.streamId,
      source: value.source === "teamspeak" ? "teamspeak" : "browser",
      ownerPeerId: value.ownerPeerId,
      ...(typeof value.ownerClientId === "number" ? { ownerClientId: value.ownerClientId } : {}),
      ownerNickname: typeof value.ownerNickname === "string" ? value.ownerNickname : "TeamSpeak 用户",
      name: typeof value.name === "string" ? value.name : "屏幕共享",
      audio: value.audio === true,
      createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
      viewerCount: typeof value.viewerCount === "number" ? value.viewerCount : 0,
      viewers: normalizeScreenShareViewers(value.viewers),
    };
    const index = vc.screenShareStreams.findIndex((candidate: ScreenShareStream) => candidate.streamId === stream.streamId);
    if (index >= 0) vc.screenShareStreams.splice(index, 1, stream);
    else vc.screenShareStreams.push(stream);
    return stream;
  }

  function normalizeScreenShareViewers(raw: unknown): ScreenShareViewer[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((viewer): viewer is ScreenShareViewer => Boolean(viewer) && typeof viewer === "object" && typeof (viewer as ScreenShareViewer).peerId === "string" && typeof (viewer as ScreenShareViewer).nickname === "string")
      .slice(0, 64)
      .map((viewer) => ({
        peerId: viewer.peerId.slice(0, 128),
        nickname: viewer.nickname.slice(0, 120),
        ...(typeof viewer.avatar === "string" && viewer.avatar.length <= 128 * 1024 ? { avatar: viewer.avatar } : {}),
      }));
  }
  return {
    startScreenShare,
    stopScreenShare,
    joinScreenShare,
    leaveScreenShare,
  };
}