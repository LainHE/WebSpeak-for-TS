import { onUnmounted, ref } from "vue";

export function useToasts() {

const toast = ref("");
const chatListEl = ref<HTMLElement | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function scrollChatToEnd() {
  const list = chatListEl.value;
  if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
}

function showToast(message: string) {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 2800);
}


  onUnmounted(() => {
    if (toastTimer) clearTimeout(toastTimer);
  });

  return { toast, chatListEl, scrollChatToEnd, showToast };
}
