import { randomUUID } from "node:crypto";
import type { TSRawNotification } from "../ts-client.js";
import type { Logger as LoggerType } from "../../logger.js";
import { formatTeamSpeakTarget, teamSpeakTargetKey } from "../../domain/teamspeak-target.js";
import type { ScreenShareClientMessage, ScreenSharePeerSignal, ScreenShareStreamDescription, ScreenShareViewerDescription } from "../screen-share.js";
import { buildTeamSpeakCommand } from "./teamspeak-command.js";
import { screenStreamKey, parseNumber, nativeViewerPeerId, parseNativeViewerPeerId, parseStreamSignalPayload, toBrowserScreenSignal } from "./screen-share.js";
import type { WebClientEntry, ScreenStreamRecord } from "./types.js";

/**
 * Owns every screen-share coordination concern of the voice gateway:
 * browser-published streams, native TeamSpeak streams, viewer rosters and
 * signaling. Pure structural split from VoiceBridge: it receives the shared
 * entry/stream maps and the logger, and keeps the exact same behavior.
 */
export class ScreenShareCoordinator {
  private readonly entries: Map<string, WebClientEntry>;
  private readonly screenStreams: Map<string, ScreenStreamRecord>;
  private readonly screenStreamDiscoveryTargets: Set<string>;
  private readonly logger: LoggerType;

  constructor(
    entries: Map<string, WebClientEntry>,
    screenStreams: Map<string, ScreenStreamRecord>,
    screenStreamDiscoveryTargets: Set<string>,
    logger: LoggerType,
  ) {
    this.entries = entries;
    this.screenStreams = screenStreams;
    this.screenStreamDiscoveryTargets = screenStreamDiscoveryTargets;
    this.logger = logger;
  }

  handleScreenShareMessage(
    entry: WebClientEntry,
    message: ScreenShareClientMessage,
    sendJson: (message: Record<string, unknown>) => void,
  ): void {
    if (message.type === "screenShareList") {
      sendJson({ type: "screenShareList", streams: this.listScreenStreamsFor(entry) });
      return;
    }

    if (message.type === "screenShareStart") {
      if ([...this.screenStreams.values()].some((stream) => stream.source === "browser" && stream.ownerEntryId === entry.id)) {
        sendJson({ type: "screenShareError", requestId: message.requestId, code: "SCREEN_SHARE_ALREADY_ACTIVE", message: "你已经在共享屏幕" });
        return;
      }
      const stream: ScreenStreamRecord = {
        streamId: `screen-${randomUUID()}`,
        source: "browser",
        ownerPeerId: entry.screenPeerId,
        ownerClientId: entry.tsClient.getClientId() || undefined,
        ownerNickname: entry.nickname,
        name: message.name?.trim() || `${entry.nickname} 的屏幕`,
        audio: message.audio === true,
        createdAt: Date.now(),
        viewerCount: 0,
        viewers: [],
        targetKey: teamSpeakTargetKey(entry.target),
        channelId: entry.tsClient.getChannelId(),
        ownerEntryId: entry.id,
        viewerEntryIds: new Set(),
        teamSpeakPublisherEntryId: entry.id,
        nativeViewerClids: new Set(),
      };
      this.screenStreams.set(screenStreamKey(stream.targetKey, stream.streamId), stream);
      sendJson({ type: "screenShareStarted", requestId: message.requestId, stream: this.describeScreenStream(stream), owner: true });
      this.broadcastScreenMessage(stream, {
        type: "screenShareStarted",
        stream: this.describeScreenStream(stream),
        owner: false,
      }, entry.id);
      void this.publishBrowserScreenStream(entry, stream);
      return;
    }

    const stream = this.screenStreams.get(screenStreamKey(teamSpeakTargetKey(entry.target), message.streamId));
    if (!stream) {
      sendJson({ type: "screenShareError", requestId: "requestId" in message ? message.requestId : undefined, code: "SCREEN_SHARE_NOT_FOUND", message: "屏幕共享已结束或不存在" });
      return;
    }
    if (stream.targetKey !== teamSpeakTargetKey(entry.target) || stream.channelId !== entry.tsClient.getChannelId()) {
      sendJson({ type: "screenShareError", requestId: "requestId" in message ? message.requestId : undefined, code: "SCREEN_SHARE_TARGET_MISMATCH", message: "屏幕共享不属于当前服务器或频道" });
      return;
    }

    if (message.type === "screenShareStop") {
      if (stream.ownerEntryId !== entry.id) {
        sendJson({ type: "screenShareError", requestId: message.requestId, code: "SCREEN_SHARE_NOT_OWNER", message: "只有共享者可以结束共享" });
        return;
      }
      this.stopScreenStream(stream, "owner-stopped");
      if (message.requestId) sendJson({ type: "screenShareCompleted", requestId: message.requestId });
      return;
    }

    if (message.type === "screenShareJoin") {
      if (stream.ownerEntryId === entry.id) {
        sendJson({ type: "screenShareError", requestId: message.requestId, code: "SCREEN_SHARE_OWNER_CANNOT_JOIN", message: "共享者不能作为观看者加入自己的共享" });
        return;
      }
      const alreadyJoined = stream.viewerEntryIds.has(entry.id);
      if (!alreadyJoined) stream.viewerEntryIds.add(entry.id);
      stream.viewerCount = this.screenShareViewerCount(stream);
      sendJson({
        type: "screenShareJoined",
        requestId: message.requestId,
        stream: this.describeScreenStream(stream),
        ownerPeerId: stream.ownerPeerId,
        mode: stream.source,
      });
      if (stream.source === "browser" && !alreadyJoined) {
        this.sendToEntry(stream.ownerEntryId, {
          type: "screenShareViewerJoined",
          streamId: stream.streamId,
          viewerPeerId: entry.screenPeerId,
          viewerNickname: entry.nickname,
        });
      } else if (stream.source === "teamspeak" && !alreadyJoined) {
        void this.joinNativeScreenStream(entry, stream, sendJson, message.requestId);
      }
      if (!alreadyJoined) {
        this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
      }
      return;
    }

    if (message.type === "screenShareLeave") {
      this.leaveScreenStream(entry, stream);
      if (message.requestId) sendJson({ type: "screenShareCompleted", requestId: message.requestId });
      return;
    }

    if (message.type === "screenShareSignal") {
      this.relayScreenShareSignal(entry, stream, message.targetPeerId, message.signal, sendJson);
    }
  }

  private listScreenStreamsFor(entry: WebClientEntry): ScreenShareStreamDescription[] {
    const targetKey = teamSpeakTargetKey(entry.target);
    return [...this.screenStreams.values()]
      .filter((stream) => stream.targetKey === targetKey && stream.channelId === entry.tsClient.getChannelId())
      .map((stream) => this.describeScreenStream(stream));
  }

  /**
   * A gateway session can connect after a native TeamSpeak stream has already
   * started. TS6 does not replay that stream in the normal welcome snapshot;
   * requeststreaminfo is the official client-protocol query for this case.
   * Query each visible client once per TeamSpeak target, then let the normal
   * raw notification path announce the discovered stream to web viewers.
   */
  async discoverExistingTeamSpeakStreams(entry: WebClientEntry): Promise<void> {
    const targetKey = teamSpeakTargetKey(entry.target);
    if (this.screenStreamDiscoveryTargets.has(targetKey)) return;
    this.screenStreamDiscoveryTargets.add(targetKey);
    const clientIds = [...entry.members.keys()].filter((clientId) => Number.isInteger(clientId) && clientId > 0);
    for (const clientId of clientIds) {
      if (!entry.tsClient.isConnected()) return;
      try {
        await entry.tsClient.sendProtocolCommand(`requeststreaminfo clid=${clientId}`);
      } catch (error: unknown) {
        this.logger.debug({
          target: formatTeamSpeakTarget(entry.target),
          clientId,
          err: error instanceof Error ? error.message : String(error),
        }, "Could not query existing TeamSpeak screen stream");
      }
    }
  }

  private describeScreenStream(stream: ScreenStreamRecord): ScreenShareStreamDescription {
    return {
      streamId: stream.streamId,
      source: stream.source,
      ownerPeerId: stream.ownerPeerId,
      ...(typeof stream.ownerClientId === "number" ? { ownerClientId: stream.ownerClientId } : {}),
      ownerNickname: stream.ownerNickname,
      name: stream.name,
      audio: stream.audio,
      createdAt: stream.createdAt,
      viewerCount: stream.viewerCount,
      viewers: this.describeScreenViewers(stream),
    };
  }

  private describeScreenViewers(stream: ScreenStreamRecord): ScreenShareViewerDescription[] {
    return [...stream.viewerEntryIds]
      .map((entryId) => this.entries.get(entryId))
      .filter((entry): entry is WebClientEntry => Boolean(entry))
      .slice(0, 64)
      .map((entry) => {
        const avatar = entry.members.get(entry.tsClient.getClientId())?.avatar;
        return {
          peerId: entry.screenPeerId,
          nickname: entry.nickname,
          ...(avatar && avatar.length <= 128 * 1024 ? { avatar } : {}),
        };
      });
  }

  private screenShareViewerCountMessage(stream: ScreenStreamRecord): Record<string, unknown> {
    return {
      type: "screenShareViewerCount",
      streamId: stream.streamId,
      viewerCount: stream.viewerCount,
      viewers: this.describeScreenViewers(stream),
    };
  }

  private screenShareViewerCount(stream: ScreenStreamRecord): number {
    return stream.viewerEntryIds.size + stream.nativeViewerClids.size;
  }

  private broadcastScreenMessage(stream: ScreenStreamRecord, message: Record<string, unknown>, excludeEntryId?: string): void {
    for (const candidate of this.entries.values()) {
      if (candidate.id === excludeEntryId || candidate.target && teamSpeakTargetKey(candidate.target) !== stream.targetKey) continue;
      // A stream is scoped to the source channel. Do not leak its card or
      // viewer roster to users who are connected to another channel on the
      // same TeamSpeak target.
      if (candidate.id !== stream.ownerEntryId) {
        try {
          if (candidate.tsClient.getChannelId() !== stream.channelId) continue;
        } catch {
          continue;
        }
      }
      this.sendToEntry(candidate.id, message);
    }
  }

  private sendToEntry(entryId: string, message: Record<string, unknown>): void {
    const candidate = this.entries.get(entryId);
    if (candidate?.ws.readyState === WebSocket.OPEN) candidate.ws.send(JSON.stringify(message));
  }

  private stopScreenStream(stream: ScreenStreamRecord, reason: string): void {
    if (stream.source === "browser" && stream.teamSpeakStreamId && stream.teamSpeakPublisherEntryId) {
      const publisher = this.entries.get(stream.teamSpeakPublisherEntryId);
      if (publisher) {
        void publisher.tsClient.sendProtocolCommand(buildTeamSpeakCommand("stopstream", {
          id: stream.teamSpeakStreamId,
          reason: "1",
        })).catch(() => undefined);
      }
    }
    if (!this.screenStreams.delete(screenStreamKey(stream.targetKey, stream.streamId))) return;
    const message = { type: "screenShareStopped", streamId: stream.streamId, reason };
    this.broadcastScreenMessage(stream, message);
    stream.viewerEntryIds.clear();
    stream.nativeViewerClids.clear();
    stream.viewerCount = 0;
  }

  private leaveScreenStream(entry: WebClientEntry, stream: ScreenStreamRecord): void {
    if (!stream.viewerEntryIds.delete(entry.id)) return;
    stream.viewerCount = this.screenShareViewerCount(stream);
    if (stream.source === "browser") this.sendToEntry(stream.ownerEntryId, { type: "screenShareViewerLeft", streamId: stream.streamId, viewerPeerId: entry.screenPeerId });
    else {
      void entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("removeclientfromstream", {
        id: stream.streamId,
        clid: String(entry.tsClient.getClientId()),
      })).catch(() => undefined);
    }
    this.sendToEntry(entry.id, { type: "screenShareLeft", streamId: stream.streamId });
    this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
  }

  private relayScreenShareSignal(
    entry: WebClientEntry,
    stream: ScreenStreamRecord,
    targetPeerId: string,
    signal: ScreenSharePeerSignal,
    sendJson: (message: Record<string, unknown>) => void,
  ): void {
    if (stream.source === "teamspeak") {
      if (!stream.viewerEntryIds.has(entry.id) || targetPeerId !== stream.ownerPeerId) {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FORBIDDEN", message: "无权发送该屏幕共享信令" });
        return;
      }
      const sourceClientId = stream.sourceClientId;
      if (!sourceClientId) {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SOURCE_UNAVAILABLE", message: "共享来源暂不可用" });
        return;
      }
      if (signal.kind === "close") {
        this.leaveScreenStream(entry, stream);
        return;
      }
      if (signal.kind === "offer") {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_INVALID_SIGNAL", message: "观看端不能向 TeamSpeak 来源发送 offer" });
        return;
      }
      const payload = signal.kind === "iceCandidate"
        ? { cmd: "iceCandidate", args: { sdp: signal.candidate, ...(signal.sdpMid !== undefined ? { mid: signal.sdpMid } : {}), ...(signal.sdpMLineIndex !== undefined ? { mLine: signal.sdpMLineIndex } : {}) } }
        : { cmd: "answer", args: { answer: signal.sdp } };
      void entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("streamsignaling", {
        id: stream.streamId,
        clid: String(sourceClientId),
        json: JSON.stringify(payload),
      })).catch((error: unknown) => {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FAILED", message: error instanceof Error ? error.message : "屏幕共享信令发送失败" });
      });
      return;
    }

    if (stream.source === "browser" && entry.id === stream.ownerEntryId && targetPeerId.startsWith("ts-viewer-")) {
      const viewerClid = parseNativeViewerPeerId(targetPeerId);
      const publisher = stream.teamSpeakPublisherEntryId ? this.entries.get(stream.teamSpeakPublisherEntryId) : undefined;
      if (!viewerClid || !publisher || !stream.teamSpeakStreamId || !stream.nativeViewerClids.has(viewerClid)) {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_PEER_NOT_FOUND", message: "TeamSpeak 观看者已离开" });
        return;
      }
      if (signal.kind === "close") {
        void publisher.tsClient.sendProtocolCommand(buildTeamSpeakCommand("removeclientfromstream", {
          id: stream.teamSpeakStreamId,
          clid: String(viewerClid),
        })).catch(() => undefined);
        stream.nativeViewerClids.delete(viewerClid);
        stream.viewerCount = this.screenShareViewerCount(stream);
        this.sendToEntry(entry.id, { type: "screenShareViewerLeft", streamId: stream.streamId, viewerPeerId: targetPeerId });
        this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
        return;
      }
      if (signal.kind === "answer") {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_INVALID_SIGNAL", message: "TeamSpeak 观看端不能先发送 answer" });
        return;
      }
      let command: string;
      if (signal.kind === "offer") {
        command = buildTeamSpeakCommand("respondjoinstreamrequest", {
          id: stream.teamSpeakStreamId,
          clid: String(viewerClid),
          msg: "",
          offer: signal.sdp,
          decision: "1",
        });
      } else if (signal.kind === "iceCandidate") {
        command = buildTeamSpeakCommand("streamsignaling", {
          id: stream.teamSpeakStreamId,
          clid: String(viewerClid),
          json: JSON.stringify({ cmd: "iceCandidate", args: { sdp: signal.candidate, ...(signal.sdpMid !== undefined ? { mid: signal.sdpMid } : {}), ...(signal.sdpMLineIndex !== undefined ? { mLine: signal.sdpMLineIndex } : {}) } }),
        });
      } else {
        return;
      }
      void publisher.tsClient.sendProtocolCommand(command).catch((error: unknown) => {
        sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FAILED", message: error instanceof Error ? error.message : "屏幕共享信令发送失败" });
      });
      return;
    }

    const owner = this.entries.get(stream.ownerEntryId);
    const isOwner = entry.id === stream.ownerEntryId;
    const isViewer = stream.viewerEntryIds.has(entry.id);
    if (!owner || (!isOwner && !isViewer)) {
      sendJson({ type: "screenShareError", code: "SCREEN_SHARE_SIGNAL_FORBIDDEN", message: "无权发送该屏幕共享信令" });
      return;
    }
    // Keep the browser P2P graph bipartite: the owner may signal only an
    // active viewer, and a viewer may signal only the owner. Without this
    // check one viewer could inject SDP/ICE into another viewer's peer.
    const targetEntry = isOwner
      ? [...stream.viewerEntryIds]
        .map((id) => this.entries.get(id))
        .find((candidate) => candidate?.screenPeerId === targetPeerId)
      : targetPeerId === owner.screenPeerId ? owner : undefined;
    if (!targetEntry || targetEntry.id === entry.id) {
      sendJson({ type: "screenShareError", code: "SCREEN_SHARE_PEER_NOT_FOUND", message: "观看者已离开" });
      return;
    }
    this.sendToEntry(targetEntry.id, { type: "screenShareSignal", streamId: stream.streamId, fromPeerId: entry.screenPeerId, signal });
  }

  private async publishBrowserScreenStream(entry: WebClientEntry, stream: ScreenStreamRecord): Promise<void> {
    try {
      await entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("setupstream", {
        name: stream.name,
        type: "3",
        bitrate: "4608",
        accessibility: "1",
        mode: "1",
        viewer_limit: "0",
        audio: stream.audio ? "1" : "0",
      }));
    } catch (error: unknown) {
      this.logger.warn({
        target: formatTeamSpeakTarget(entry.target),
        streamId: stream.streamId,
        err: error instanceof Error ? error.message : String(error),
      }, "Could not publish browser screen share to TeamSpeak");
    }
  }

  private async joinNativeScreenStream(
    entry: WebClientEntry,
    stream: ScreenStreamRecord,
    sendJson: (message: Record<string, unknown>) => void,
    requestId?: string,
  ): Promise<void> {
    const sourceClientId = stream.sourceClientId;
    if (!entry.tsClient.getClientId() || !sourceClientId) {
      sendJson({ type: "screenShareError", requestId, code: "SCREEN_SHARE_SOURCE_UNAVAILABLE", message: "共享来源暂不可用" });
      return;
    }
    try {
      await entry.tsClient.sendProtocolCommand(buildTeamSpeakCommand("joinstreamrequest", {
        id: stream.streamId,
        // TS6 uses the source client id on joinstreamrequest. The requesting
        // gateway session is identified later by the response/signaling
        // notification delivered to this TS connection.
        clid: String(sourceClientId),
        msg: "",
        is_remove: "0",
        muted: "0",
        volume: "0",
        hidden: "0",
      }));
    } catch (error: unknown) {
      this.leaveScreenStream(entry, stream);
      sendJson({ type: "screenShareError", requestId, code: "SCREEN_SHARE_JOIN_FAILED", message: error instanceof Error ? error.message : "无法加入屏幕共享" });
    }
  }

  removeScreenSharePeer(entryId: string): void {
    for (const stream of [...this.screenStreams.values()]) {
      if (stream.ownerEntryId === entryId) {
        this.stopScreenStream(stream, "owner-disconnected");
        continue;
      }
      const entry = this.entries.get(entryId);
      if (entry && stream.viewerEntryIds.has(entryId)) this.leaveScreenStream(entry, stream);
    }
  }

  reconcileScreenShareAfterClientMove(entry: WebClientEntry, movedClientId: number, targetChannelId: bigint): void {
    const targetKey = teamSpeakTargetKey(entry.target);
    for (const stream of [...this.screenStreams.values()]) {
      if (stream.targetKey !== targetKey) continue;
      // A browser share belongs to the gateway user's current channel. Stop
      // it when that user moves so existing viewers cannot keep a cross-
      // channel peer alive.
      if (stream.source === "browser" && stream.ownerEntryId === entry.id && stream.channelId !== targetChannelId) {
        this.stopScreenStream(stream, "owner-moved-channel");
        continue;
      }
      // Native TS6 shares are channel-scoped as well. The notification is
      // observed by every gateway session, so stop the shared record once the
      // native source changes channels.
      if (stream.source === "teamspeak" && stream.sourceClientId === movedClientId) {
        this.stopScreenStream(stream, "source-moved-channel");
        continue;
      }
      if (stream.viewerEntryIds.has(entry.id) && stream.channelId !== targetChannelId) {
        this.leaveScreenStream(entry, stream);
      }
    }
  }

  reconcileNativeScreenShareAfterClientLeave(entry: WebClientEntry, clientId: number): void {
    const targetKey = teamSpeakTargetKey(entry.target);
    for (const stream of [...this.screenStreams.values()]) {
      if (stream.targetKey === targetKey && stream.source === "teamspeak" && stream.sourceClientId === clientId) {
        this.stopScreenStream(stream, "source-left");
      }
    }
  }

  handleRawScreenNotification(entry: WebClientEntry, notification: TSRawNotification): void {
    const params = notification.params;
    if (notification.name === "notifyjoinstreamrequest") {
      const streamId = params.id || params.stream_id;
      const viewerClientId = parseNumber(params.clid);
      if (!streamId || !viewerClientId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const stream = [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
        && candidate.source === "browser"
        && candidate.teamSpeakPublisherEntryId === entry.id
        && candidate.teamSpeakStreamId === streamId);
      if (!stream) return;
      stream.nativeViewerClids.add(viewerClientId);
      stream.viewerCount = this.screenShareViewerCount(stream);
      this.sendToEntry(stream.ownerEntryId, {
        type: "screenShareNativeViewerJoined",
        streamId: stream.streamId,
        viewerPeerId: nativeViewerPeerId(viewerClientId),
        viewerClientId,
      });
      this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
      return;
    }
    if (notification.name === "notifystreamstarted" || notification.name === "notifystreaminfo") {
      const streamId = params.id || params.stream_id;
      const sourceClientId = parseNumber(params.clid);
      if (!streamId || !sourceClientId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const publisherEntry = [...this.entries.values()].find((candidate) => candidate.target
        && teamSpeakTargetKey(candidate.target) === targetKey
        && candidate.tsClient.getClientId() === sourceClientId);
      const browserStream = publisherEntry
        ? [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
          && candidate.source === "browser"
          && candidate.teamSpeakPublisherEntryId === publisherEntry.id
          && !candidate.teamSpeakStreamId)
        : undefined;
      if (browserStream) {
        browserStream.teamSpeakStreamId = streamId;
        return;
      }
      const sourceEntry = [...this.entries.values()].find((candidate) => candidate.tsClient.getClientId() === sourceClientId);
      const key = screenStreamKey(targetKey, streamId);
      const current = this.screenStreams.get(key);
      const stream: ScreenStreamRecord = current ?? {
        streamId,
        source: "teamspeak",
        ownerPeerId: `ts-${sourceClientId}`,
        ownerClientId: sourceClientId,
        ownerNickname: params.name || `TeamSpeak 用户 ${sourceClientId}`,
        name: params.name || "TeamSpeak 屏幕共享",
        audio: params.audio === "1",
        createdAt: Date.now(),
        viewerCount: 0,
        viewers: [],
        targetKey,
        channelId: sourceEntry?.tsClient.getChannelId() ?? entry.tsClient.getChannelId(),
        ownerEntryId: "",
        viewerEntryIds: new Set(),
        nativeViewerClids: new Set(),
        sourceClientId,
      };
      stream.sourceClientId = sourceClientId;
      stream.ownerNickname = params.name || stream.ownerNickname;
      stream.name = params.name || stream.name;
      stream.audio = params.audio === "1";
      this.screenStreams.set(key, stream);
      // Every gateway session attached to the same TS target sees the same
      // raw notification. Only the first one should announce a new stream to
      // browsers; otherwise each connected user receives duplicate cards.
      if (!current) {
        this.broadcastScreenMessage(stream, { type: "screenShareStarted", stream: this.describeScreenStream(stream), owner: false });
      }
      return;
    }
    if (notification.name === "notifystreamstopped") {
      const streamId = params.id || params.stream_id;
      if (!streamId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const stream = this.screenStreams.get(screenStreamKey(targetKey, streamId));
      if (stream) {
        this.stopScreenStream(stream, "source-stopped");
        return;
      }
      const browserStream = [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
        && candidate.source === "browser"
        && candidate.teamSpeakStreamId === streamId);
      if (browserStream) {
        browserStream.teamSpeakStreamId = undefined;
        browserStream.nativeViewerClids.clear();
        browserStream.viewerCount = this.screenShareViewerCount(browserStream);
        this.sendToEntry(browserStream.ownerEntryId, {
          type: "screenShareError",
          code: "SCREEN_SHARE_NATIVE_PUBLISHER_STOPPED",
          message: "TeamSpeak 客户端屏幕共享通道已停止，网页共享仍可继续",
        });
        this.broadcastScreenMessage(browserStream, this.screenShareViewerCountMessage(browserStream));
      }
      return;
    }
    if (notification.name === "notifystreamclientleft") {
      const streamId = params.id || params.stream_id;
      const viewerClientId = parseNumber(params.clid);
      if (!streamId || !viewerClientId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const stream = [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
        && candidate.source === "browser"
        && candidate.teamSpeakStreamId === streamId
        && candidate.nativeViewerClids.has(viewerClientId));
      if (!stream) return;
      stream.nativeViewerClids.delete(viewerClientId);
      stream.viewerCount = this.screenShareViewerCount(stream);
      this.sendToEntry(stream.ownerEntryId, {
        type: "screenShareViewerLeft",
        streamId: stream.streamId,
        viewerPeerId: nativeViewerPeerId(viewerClientId),
      });
      this.broadcastScreenMessage(stream, this.screenShareViewerCountMessage(stream));
      return;
    }
    if (notification.name === "notifyrespondjoinstreamrequest" || notification.name === "notifystreamsignaling") {
      const streamId = params.id || params.stream_id;
      if (!streamId) return;
      const targetKey = teamSpeakTargetKey(entry.target);
      const browserStream = notification.name === "notifystreamsignaling"
        ? [...this.screenStreams.values()].find((candidate) => candidate.targetKey === targetKey
          && candidate.source === "browser"
          && candidate.teamSpeakPublisherEntryId === entry.id
          && candidate.teamSpeakStreamId === streamId)
        : undefined;
      if (browserStream) {
        const viewerClientId = parseNumber(params.clid);
        if (!viewerClientId || !browserStream.nativeViewerClids.has(viewerClientId)) return;
        const payload = parseStreamSignalPayload(params.json || params.data || "");
        if (!payload) return;
        const signal = toBrowserScreenSignal(payload);
        if (!signal) return;
        this.sendToEntry(browserStream.ownerEntryId, {
          type: "screenShareSignal",
          streamId: browserStream.streamId,
          fromPeerId: nativeViewerPeerId(viewerClientId),
          signal,
        });
        return;
      }
      const stream = this.screenStreams.get(screenStreamKey(targetKey, streamId));
      if (!stream || stream.source !== "teamspeak" || !stream.viewerEntryIds.has(entry.id)) return;
      const payload = notification.name === "notifyrespondjoinstreamrequest"
        ? { cmd: "offer", args: { offer: params.offer || "" } }
        : parseStreamSignalPayload(params.json || params.data || "");
      if (!payload) return;
      const signal = toBrowserScreenSignal(payload);
      if (!signal) return;
      this.sendToEntry(entry.id, { type: "screenShareSignal", streamId, fromPeerId: stream.ownerPeerId, signal });
    }
  }

}