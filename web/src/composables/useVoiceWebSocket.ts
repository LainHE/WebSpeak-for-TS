import { createVoiceContext } from "./voice/context.js";
import { setupAudioEngine } from "./voice/audio-engine.js";
import { setupWebSocket } from "./voice/websocket.js";
import { setupScreenShare } from "./voice/screen-share.js";
export type { ChannelInfo, ChannelMember, ChatMessage, LatencyProbeResult, ScreenShareOutputSettings, ScreenShareStream, ServerEvent, VoiceState } from "./voice/types.js";
export { normalizeMicrophoneFailure } from "./voice/errors.js";

export function useVoiceWebSocket() {
  const vc = createVoiceContext();
  const audioApi = setupAudioEngine(vc);
  const wsApi = setupWebSocket(vc);
  const ssApi = setupScreenShare(vc);
  return {
    ...vc,
    ...audioApi,
    ...wsApi,
    ...ssApi,
  };
}
