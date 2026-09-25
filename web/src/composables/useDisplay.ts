import { computed } from "vue";
import type { Ref } from "vue";
import type { ChatMessage, ChannelMember } from "./useVoiceWebSocket.js";
import type { Language } from "../modules/translations.js";

type VoiceApi = ReturnType<typeof import("./useVoiceWebSocket.js").useVoiceWebSocket>;

export function useDisplay(options: {
  members: VoiceApi["members"];
  speakingIds: VoiceApi["speakingIds"];
  nickname: Ref<string>;
  t: (key: string, variables?: Record<string, string | number>) => string;
  language: Ref<Language>;
}) {
  const { members, speakingIds, nickname, t, language } = options;

function avatarInitial(name: string) {
  return (name.trim()[0] || "?").toUpperCase();
}

const avatarColors = ["#9edbd4", "#b9d4c5", "#e8c6a8", "#c5c7e8", "#edd2d4", "#c8d9e9", "#e4d3b8"];
function avatarStyle(name: string, isSelf = false, avatar = "") {
  const fallback = isSelf ? "linear-gradient(135deg, #006a64, #2e9f96)" : "";
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = name.charCodeAt(index) + ((hash << 5) - hash);
  return {
    background: fallback || avatarColors[Math.abs(hash) % avatarColors.length],
    ...(avatar ? { backgroundImage: `url("${avatar}")`, backgroundPosition: "center", backgroundSize: "cover" } : {}),
  };
}

function messageAvatar(message: ChatMessage): string {
  const member = members.find((candidate) =>
    (typeof message.senderId === "number" && candidate.id === message.senderId) ||
    (Boolean(message.senderUid) && candidate.uid === message.senderUid),
  );
  return member?.avatar ?? "";
}

function isSpeaking(member: ChannelMember) {
  return speakingIds.has(member.id);
}

function memberDisplayName(member: ChannelMember): string {
  return member.isSelf ? `${member.nickname}${t("selfSuffix")}` : member.nickname;
}

function formatTime(timestamp: number) {
  const locale = language.value === "zh" ? "zh-CN" : language.value === "de" ? "de-DE" : language.value === "ru" ? "ru-RU" : language.value === "ja" ? "ja-JP" : "en-US";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function rangeStyle(value: number, max: number) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return { background: `linear-gradient(to right, #006a64 0%, #006a64 ${percent}%, #e7eceb ${percent}%, #e7eceb 100%)` };
}


  return { avatarInitial, avatarColors, avatarStyle, messageAvatar, isSpeaking, memberDisplayName, formatTime, rangeStyle };
}
