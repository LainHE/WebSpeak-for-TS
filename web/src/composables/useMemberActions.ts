import { onMounted, onUnmounted, reactive, ref, watch } from "vue";
import type { ComputedRef, Ref } from "vue";
import type { ChannelMember } from "./useVoiceWebSocket.js";
import type { TreeChannel } from "./useChannelTree.js";

type VoiceApi = ReturnType<typeof import("./useVoiceWebSocket.js").useVoiceWebSocket>;

export function useMemberActions(options: {
  whisperTargetIds: VoiceApi["whisperTargetIds"];
  setWhisperTargets: VoiceApi["setWhisperTargets"];
  setWhisperActive: VoiceApi["setWhisperActive"];
  sendPoke: VoiceApi["sendPoke"];
  setAway: VoiceApi["setAway"];
  moveClient: VoiceApi["moveClient"];
  voiceState: VoiceApi["state"];
  pokeNotifications: VoiceApi["pokeNotifications"];
  playNotification: VoiceApi["playNotification"];
  accompanimentActive: VoiceApi["accompanimentActive"];
  stopAccompaniment: VoiceApi["stopAccompaniment"];
  memberChannels: ComputedRef<TreeChannel[]>;
  memberMenu: Ref<{ member: ChannelMember; x: number; y: number } | null>;
  isMobileViewport: Ref<boolean>;
  t: (key: string, variables?: Record<string, string | number>) => string;
  showToast: (message: string) => void;
  localizedMessage: (message: string) => string;
}) {
  const { whisperTargetIds, setWhisperTargets, setWhisperActive, sendPoke, setAway, moveClient, voiceState, pokeNotifications, playNotification, accompanimentActive, stopAccompaniment, memberChannels, memberMenu, isMobileViewport, t, showToast, localizedMessage } = options;

const away = ref(false);
const awayMessage = ref("");
const memberMoveMenuOpen = ref(false);
const draggedMember = ref<ChannelMember | null>(null);
const dragOverChannelId = ref("");
const memberPointerDrag = reactive({ member: null as ChannelMember | null, pointerId: null as number | null, startX: 0, startY: 0, active: false, targetChannelId: "" });
const whisperPttActive = ref(false);
watch(() => pokeNotifications.length, (length, previousLength) => {
  const latest = pokeNotifications[length - 1];
  if (!latest || length <= previousLength) return;
  showToast(`${latest.invokerName} ${t("pokedYou")}${latest.message ? `：${latest.message}` : ""}`);
  playNotification("poke");
  if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(t("poke"), { body: `${latest.invokerName}: ${latest.message || t("pokedYou")}` });
});
function openMemberMenu(member: ChannelMember, event: Event): void {
  if (member.isSelf) return;
  memberMoveMenuOpen.value = false;
  const point = event instanceof MouseEvent ? event : undefined;
  memberMenu.value = { member, x: Math.min((point?.clientX ?? 20), Math.max(12, window.innerWidth - 210)), y: Math.min((point?.clientY ?? 20), Math.max(12, window.innerHeight - 170)) };
}

function openMemberActions(member: ChannelMember): void {
  if (member.isSelf) return;
  memberMoveMenuOpen.value = false;
  memberMenu.value = { member, x: 0, y: 0 };
}

function toggleMemberMoveMenu(): void {
  memberMoveMenuOpen.value = true;
}

async function moveMemberDirect(member: ChannelMember, targetChannelId: string): Promise<void> {
  if (member.isSelf || !targetChannelId || targetChannelId === "__current__") return;
  const sourceChannel = memberChannels.value.find((channel) => channel.members.some((candidate) => candidate.id === member.id));
  if (sourceChannel?.id === targetChannelId) {
    memberMenu.value = null;
    memberMoveMenuOpen.value = false;
    return;
  }
  memberMenu.value = null;
  memberMoveMenuOpen.value = false;
  try {
    // Moving a visible client is a server-admin operation; channel passwords
    // must never be requested or forwarded for this action.
    await moveClient(member.id, targetChannelId);
    showToast(t("moveMemberSuccess"));
  } catch (error: unknown) {
    showToast(localizedMessage(error instanceof Error ? error.message : "操作失败"));
  }
}

function onMemberDragStart(member: ChannelMember, event: DragEvent): void {
  if (member.isSelf) {
    event.preventDefault();
    return;
  }
  draggedMember.value = member;
  dragOverChannelId.value = "";
  event.dataTransfer?.setData("text/plain", String(member.id));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onMemberDragEnd(): void {
  draggedMember.value = null;
  dragOverChannelId.value = "";
}

function onMemberPointerDown(member: ChannelMember, event: PointerEvent): void {
  if (member.isSelf || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("input,button")) return;
  event.preventDefault();
  memberPointerDrag.member = member;
  memberPointerDrag.pointerId = event.pointerId;
  memberPointerDrag.startX = event.clientX;
  memberPointerDrag.startY = event.clientY;
  memberPointerDrag.active = false;
  memberPointerDrag.targetChannelId = "";
  const currentTarget = event.currentTarget as HTMLElement | null;
  currentTarget?.setPointerCapture?.(event.pointerId);
}

function onMemberPointerMove(event: PointerEvent): void {
  if (!memberPointerDrag.member || memberPointerDrag.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - memberPointerDrag.startX, event.clientY - memberPointerDrag.startY);
  if (!memberPointerDrag.active && distance < 6) return;
  event.preventDefault();
  memberPointerDrag.active = true;
  draggedMember.value = memberPointerDrag.member;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-member-channel-id]");
  const targetChannelId = target?.dataset.memberChannelId ?? "";
  const sourceChannel = memberChannels.value.find((channel) => channel.members.some((candidate) => candidate.id === memberPointerDrag.member?.id));
  if (!sourceChannel || !targetChannelId || targetChannelId === sourceChannel.id) {
    memberPointerDrag.targetChannelId = "";
    dragOverChannelId.value = "";
    return;
  }
  memberPointerDrag.targetChannelId = targetChannelId;
  dragOverChannelId.value = targetChannelId;
}

function onMemberPointerUp(event: PointerEvent): void {
  if (!memberPointerDrag.member || memberPointerDrag.pointerId !== event.pointerId) return;
  const member = memberPointerDrag.member;
  const targetChannelId = memberPointerDrag.targetChannelId;
  const currentTarget = event.currentTarget as HTMLElement | null;
  currentTarget?.releasePointerCapture?.(event.pointerId);
  memberPointerDrag.member = null;
  memberPointerDrag.pointerId = null;
  memberPointerDrag.active = false;
  memberPointerDrag.targetChannelId = "";
  draggedMember.value = null;
  dragOverChannelId.value = "";
  if (targetChannelId) void moveMemberDirect(member, targetChannelId);
}

function onMemberPointerCancel(event: PointerEvent): void {
  if (!memberPointerDrag.member || memberPointerDrag.pointerId !== event.pointerId) return;
  const currentTarget = event.currentTarget as HTMLElement | null;
  currentTarget?.releasePointerCapture?.(event.pointerId);
  memberPointerDrag.member = null;
  memberPointerDrag.pointerId = null;
  memberPointerDrag.active = false;
  memberPointerDrag.targetChannelId = "";
  draggedMember.value = null;
  dragOverChannelId.value = "";
}

function onChannelDragOver(channelItem: TreeChannel, event: DragEvent): void {
  const member = draggedMember.value;
  if (!member || channelItem.id === "__current__") return;
  const sourceChannel = memberChannels.value.find((channel) => channel.members.some((candidate) => candidate.id === member.id));
  if (!sourceChannel || sourceChannel.id === channelItem.id) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dragOverChannelId.value = channelItem.id;
}

function onChannelDragLeave(channelItem: TreeChannel, event: DragEvent): void {
  const currentTarget = event.currentTarget;
  const relatedTarget = event.relatedTarget;
  if (currentTarget instanceof HTMLElement && relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) return;
  if (dragOverChannelId.value === channelItem.id) dragOverChannelId.value = "";
}

function onChannelDrop(channelItem: TreeChannel, event: DragEvent): void {
  event.preventDefault();
  const member = draggedMember.value;
  onMemberDragEnd();
  if (!member || channelItem.id === "__current__") return;
  void moveMemberDirect(member, channelItem.id);
}

function toggleWhisperTarget(member: ChannelMember): void {
  if (member.isSelf) return;
  const targets = new Set(whisperTargetIds);
  if (targets.has(member.id)) targets.delete(member.id);
  else if (targets.size < 8) targets.add(member.id);
  setWhisperTargets([...targets]);
  showToast(targets.has(member.id) ? t("setWhisperTarget") : t("removeWhisperTarget"));
}

function clearWhisperTargets(): void {
  stopWhisperTalk();
  setWhisperTargets([]);
}

function pokeMember(member: ChannelMember): void {
  sendPoke(member.id, window.prompt(t("pokeMessagePrompt"), "") ?? "");
  showToast(t("pokeSent"));
}

function copyMemberName(member: ChannelMember): void {
  navigator.clipboard?.writeText(member.nickname).then(() => showToast(t("copiedNickname")), () => showToast(t("copyFailedToast")));
}

function toggleAway(): void {
  away.value = !away.value;
  awayMessage.value = away.value ? (window.prompt(t("awayPrompt"), awayMessage.value) ?? "") : "";
  setAway(away.value, awayMessage.value);
}

function dismissPoke(id: string): void {
  const index = pokeNotifications.findIndex((poke) => poke.id === id);
  if (index >= 0) pokeNotifications.splice(index, 1);
}

function onWhisperPttDown(event: PointerEvent): void {
  if (!whisperTargetIds.size) return;
  const target = event.currentTarget as HTMLElement | null;
  if (target?.setPointerCapture && !target.hasPointerCapture(event.pointerId)) target.setPointerCapture(event.pointerId);
  whisperPttActive.value = true;
  setWhisperActive(true);
}

function onWhisperPttUp(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement | null;
  if (target?.releasePointerCapture && target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  stopWhisperTalk();
}

function stopWhisperTalk(): void {
  if (!whisperPttActive.value) return;
  whisperPttActive.value = false;
  setWhisperActive(false);
}

  let viewportMediaQuery: MediaQueryList | undefined;
  let viewportChangeHandler: (() => void) | undefined;

  onMounted(() => {
    viewportMediaQuery = window.matchMedia("(max-width: 740px)");
    viewportChangeHandler = () => {
      isMobileViewport.value = viewportMediaQuery?.matches ?? false;
      if (!isMobileViewport.value) memberMenu.value = null;
      else if (accompanimentActive.value) void stopAccompaniment();
    };
    viewportChangeHandler();
    viewportMediaQuery.addEventListener?.("change", viewportChangeHandler);
  });
  onUnmounted(() => {
    if (viewportMediaQuery && viewportChangeHandler) viewportMediaQuery.removeEventListener?.("change", viewportChangeHandler);
  });

  return { away, awayMessage, memberMoveMenuOpen, draggedMember, dragOverChannelId, memberPointerDrag, whisperPttActive, openMemberMenu, openMemberActions, toggleMemberMoveMenu, moveMemberDirect, onMemberDragStart, onMemberDragEnd, onMemberPointerDown, onMemberPointerMove, onMemberPointerUp, onMemberPointerCancel, onChannelDragOver, onChannelDragLeave, onChannelDrop, toggleWhisperTarget, clearWhisperTargets, pokeMember, copyMemberName, toggleAway, dismissPoke, onWhisperPttDown, onWhisperPttUp, stopWhisperTalk };
}
