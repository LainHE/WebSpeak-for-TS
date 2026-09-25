import { computed, nextTick, ref, watch } from "vue";
import type { ComputedRef, Ref } from "vue";
import type { ChannelInfo, ChannelMember } from "./useVoiceWebSocket.js";

type VoiceApi = ReturnType<typeof import("./useVoiceWebSocket.js").useVoiceWebSocket>;

export interface TreeChannel extends ChannelInfo {
  depth: number;
  members: ChannelMember[];
}

export function useChannelTree(options: {
  channels: VoiceApi["channels"];
  members: VoiceApi["members"];
  chatMessages: VoiceApi["chatMessages"];
  pokeNotifications: VoiceApi["pokeNotifications"];
  whisperTargetIds: VoiceApi["whisperTargetIds"];
  voiceState: VoiceApi["state"];
  switchChannel: VoiceApi["switchChannel"];
  sendTextMessage: VoiceApi["sendTextMessage"];
  sendServerMessage: VoiceApi["sendServerMessage"];
  sendPrivateMessage: VoiceApi["sendPrivateMessage"];
  playNotification: VoiceApi["playNotification"];
  t: (key: string, variables?: Record<string, string | number>) => string;
  scrollChatToEnd: () => void;
}) {
  const { channels, members, chatMessages, pokeNotifications, whisperTargetIds, voiceState, switchChannel, sendTextMessage, sendServerMessage, sendPrivateMessage, playNotification, t, scrollChatToEnd } = options;
  const channel = ref(new URLSearchParams(location.search).get("channel") ?? "");

interface TreeChannel extends ChannelInfo {
  depth: number;
  members: ChannelMember[];
}


const memberQuery = ref("");
const messageDraft = ref("");
const selectedChannelId = ref("");
const chatTab = ref<"channel" | "server" | "private" | "events">("channel");
const privateClientId = ref(0);
const memberMenu = ref<{ member: ChannelMember; x: number; y: number } | null>(null);
const mobileSection = ref<"channels" | "chat" | "voice" | "more">("channels");
const isMobileViewport = ref(false);
const channelTree = computed<TreeChannel[]>(() => {
  const source = [...channels];
  const sourceIndex = new Map(source.map((item, index) => [item.id, index]));
  const enriched = source.map((item) => ({
    ...item,
    members: (item.members ?? []).map((member) => ({ ...member, isSelf: member.id === voiceState.tsClientId })),
  }));
  const byId = new Map(enriched.map((item) => [item.id, item]));
  const depthCache = new Map<string, number>();

  function depthOf(item: ChannelInfo, visiting = new Set<string>()): number {
    if (depthCache.has(item.id)) return depthCache.get(item.id)!;
    if (!item.parentID || item.parentID === "0" || visiting.has(item.id)) return 0;
    const parent = byId.get(item.parentID);
    const depth = parent ? depthOf(parent, new Set(visiting).add(item.id)) + 1 : 0;
    depthCache.set(item.id, depth);
    return depth;
  }

  const childrenByParent = new Map<string, TreeChannel[]>();
  for (const item of enriched) {
    const channel = { ...item, depth: depthOf(item) };
    const siblings = childrenByParent.get(channel.parentID) ?? [];
    siblings.push(channel);
    childrenByParent.set(channel.parentID, siblings);
  }

  function orderSiblings(siblings: TreeChannel[]): TreeChannel[] {
    const bySiblingId = new Map(siblings.map((item) => [item.id, item]));
    const successors = new Map<string, TreeChannel[]>();
    const roots: TreeChannel[] = [];
    const sourceOrder = (left: TreeChannel, right: TreeChannel) =>
      (sourceIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (sourceIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER);

    for (const item of siblings) {
      const predecessor = item.order && item.order !== "0" && bySiblingId.has(item.order) ? item.order : "";
      if (!predecessor) roots.push(item);
      else successors.set(predecessor, [...(successors.get(predecessor) ?? []), item]);
    }

    roots.sort(sourceOrder);
    for (const items of successors.values()) items.sort(sourceOrder);

    const ordered: TreeChannel[] = [];
    const visited = new Set<string>();
    const append = (item: TreeChannel) => {
      if (visited.has(item.id)) return;
      visited.add(item.id);
      ordered.push(item);
      for (const successor of successors.get(item.id) ?? []) append(successor);
    };
    for (const root of roots) append(root);
    for (const item of [...siblings].sort(sourceOrder)) append(item);
    return ordered;
  }

  const orderedTree: TreeChannel[] = [];
  const visit = (parentID: string) => {
    for (const channel of orderSiblings(childrenByParent.get(parentID) ?? [])) {
      orderedTree.push(channel);
      visit(channel.id);
    }
  };
  visit("0");
  for (const channel of enriched) {
    if (!orderedTree.some((item) => item.id === channel.id)) {
      const fallback = { ...channel, depth: depthOf(channel) };
      orderedTree.push(fallback);
      visit(channel.id);
    }
  }
  return orderedTree;
});

const currentChannel = computed<TreeChannel | undefined>(() => {
  const explicitlySelected = channelTree.value.find((item) => item.id === selectedChannelId.value);
  if (explicitlySelected) return explicitlySelected;
  const fromSelf = channelTree.value.find((item) => item.members.some((member) => member.id === voiceState.tsClientId));
  if (fromSelf) return fromSelf;
  return channelTree.value.find((item) => item.name === channel.value) ?? channelTree.value[0];
});
const currentChannelName = computed(() => (currentChannel.value?.name ?? channel.value) || t("voiceLobby"));
const currentChannelDescription = computed(() => currentChannel.value?.description ?? "");
const currentMembers = computed<ChannelMember[]>(() => {
  const source = currentChannel.value ? currentChannel.value.members : members;
  return source.map((member) => ({ ...member, isSelf: member.isSelf || member.id === voiceState.tsClientId }));
});
const roomMembers = computed(() => currentMembers.value.slice(0, 4));
const memberChannels = computed<TreeChannel[]>(() => {
  if (channelTree.value.length) return channelTree.value;
  return [{ id: "__current__", parentID: "0", name: currentChannelName.value, description: currentChannelDescription.value, members: currentMembers.value, depth: 0 }];
});
const filteredMemberChannels = computed(() => {
  const search = memberQuery.value.trim().toLowerCase();
  if (!search) return memberChannels.value;
  return memberChannels.value.filter((item) => item.name.toLowerCase().includes(search) || item.members.some((member) => member.nickname.toLowerCase().includes(search)));
});
const memberMoveMenuCurrentChannel = computed<TreeChannel | null>(() => {
  const member = memberMenu.value?.member;
  const currentId = currentChannel.value?.id;
  if (!member || !currentId || currentId === "__current__") return null;
  const sourceChannelId = memberChannels.value.find((channel) => channel.members.some((candidate) => candidate.id === member.id))?.id ?? "";
  return memberChannels.value.find((channel) => channel.id === currentId) ?? null;
});
const memberMoveMenuCurrentSameChannel = computed(() => {
  const member = memberMenu.value?.member;
  const currentId = memberMoveMenuCurrentChannel.value?.id;
  if (!member || !currentId) return false;
  return memberChannels.value.find((channel) => channel.members.some((candidate) => candidate.id === member.id))?.id === currentId;
});
const memberMoveMenuOtherChannels = computed<TreeChannel[]>(() => {
  const member = memberMenu.value?.member;
  if (!member) return [];
  const sourceChannelId = memberChannels.value.find((channel) => channel.members.some((candidate) => candidate.id === member.id))?.id ?? "";
  const currentChannelId = memberMoveMenuCurrentChannel.value?.id;
  return memberChannels.value.filter((channel) => channel.id !== "__current__" && channel.id !== sourceChannelId && channel.id !== currentChannelId);
});
const whisperTargets = computed(() => [...whisperTargetIds].map((id) => members.find((member) => member.id === id)).filter((member): member is ChannelMember => Boolean(member)));

const privateConversations = computed(() => {
  const conversations = new Map<string, { id: number; name: string; lastMessage: number }>();
  for (const message of chatMessages) {
    if (message.scope !== "private" || !message.conversationId) continue;
    const id = Number(message.conversationId);
    if (!id) continue;
    const member = members.find((candidate) => candidate.id === id);
    const existing = conversations.get(message.conversationId);
    conversations.set(message.conversationId, { id, name: member?.nickname ?? existing?.name ?? message.invokerName, lastMessage: Math.max(existing?.lastMessage ?? 0, message.timestamp) });
  }
  return [...conversations.values()].sort((a, b) => b.lastMessage - a.lastMessage);
});

const visibleChatMessages = computed(() => {
  if (chatTab.value === "server") return chatMessages.filter((message) => message.scope === "server");
  if (chatTab.value === "private") return chatMessages.filter((message) => message.scope === "private" && message.conversationId === String(privateClientId.value));
  if (chatTab.value !== "channel") return [];
  const channelId = currentChannel.value?.id;
  return chatMessages.filter((message) => message.scope === "channel" && (!message.targetId || message.targetId === "0" || !channelId || message.targetId === channelId));
});

const chatTabLabel = computed(() => chatTab.value === "channel" ? t("textChannel") : chatTab.value === "server" ? t("serverChat") : chatTab.value === "private" ? t("privateMessage") : t("eventLog"));
const chatTitle = computed(() => chatTab.value === "channel" ? t("channelChat", { channel: currentChannelName.value }) : chatTab.value === "server" ? t("serverChat") : chatTab.value === "events" ? t("eventLog") : privateConversations.value.find((conversation) => conversation.id === privateClientId.value)?.name ?? t("privateMessage"));
const chatPlaceholder = computed(() => chatTab.value === "private" ? t("privateMessagePlaceholder") : chatTab.value === "server" ? t("serverMessagePlaceholder") : t("sendMessagePlaceholder"));
const visiblePokes = computed(() => pokeNotifications.slice(-3));
const memberMenuStyle = computed(() => {
  if (!memberMenu.value) return {};
  // #app applies zoom:var(--ui-scale) which also scales fixed-element
  // coordinates against the viewport; divide the pointer position back to CSS
  // pixels so the context menu opens exactly where the user clicked on large
  // displays.
  const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
  return { left: `${memberMenu.value.x / scale}px`, top: `${memberMenu.value.y / scale}px` };
});
watch(channelTree, (list) => {
  if (!selectedChannelId.value && list[0]) {
    selectedChannelId.value = list.find((item) => item.name === channel.value)?.id
      ?? list.find((item) => item.members.some((member) => member.id === voiceState.tsClientId))?.id
      ?? "";
  }
}, { deep: true });
watch([() => chatMessages.length, chatTab, privateClientId], () => nextTick(scrollChatToEnd));
watch(() => chatMessages.length, (length, previousLength) => {
  const latest = chatMessages[length - 1];
  if (latest && length > previousLength && latest.scope === "private" && !latest.isSelf) playNotification("private");
});
function selectChannel(item: TreeChannel) {
  selectedChannelId.value = item.id;
  channel.value = item.name;
  chatTab.value = "channel";
  switchChannel(item.id);
}

function selectChannelById() {
  const item = channelTree.value.find((candidate) => candidate.id === selectedChannelId.value);
  if (item) selectChannel(item);
}

function channelLabel(item: TreeChannel) {
  return `${"　".repeat(item.depth)}${item.name}`;
}

function submitMessage() {
  if (!messageDraft.value.trim()) return;
  if (chatTab.value === "channel") sendTextMessage(messageDraft.value, currentChannel.value?.id ?? selectedChannelId.value);
  else if (chatTab.value === "server") sendServerMessage(messageDraft.value);
  else if (chatTab.value === "private" && privateClientId.value) sendPrivateMessage(privateClientId.value, messageDraft.value, String(privateClientId.value));
  messageDraft.value = "";
}

function openPrivateChat(clientId: number): void {
  if (!clientId || clientId === voiceState.tsClientId) return;
  privateClientId.value = clientId;
  chatTab.value = "private";
  if (isMobileViewport.value) mobileSection.value = "chat";
  memberMenu.value = null;
  nextTick(scrollChatToEnd);
}


  return { channel, selectedChannelId, memberQuery, messageDraft, chatTab, privateClientId, memberMenu, mobileSection, isMobileViewport, channelTree, currentChannel, currentChannelName, currentChannelDescription, currentMembers, roomMembers, memberChannels, filteredMemberChannels, memberMoveMenuCurrentChannel, memberMoveMenuCurrentSameChannel, memberMoveMenuOtherChannels, whisperTargets, privateConversations, visibleChatMessages, chatTabLabel, chatTitle, chatPlaceholder, visiblePokes, memberMenuStyle, selectChannel, selectChannelById, channelLabel, submitMessage, openPrivateChat };
}
