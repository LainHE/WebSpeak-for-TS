import { computed, onUnmounted, ref } from "vue";
import type { LatencyProbeResult } from "./useVoiceWebSocket.js";

type VoiceApi = ReturnType<typeof import("./useVoiceWebSocket.js").useVoiceWebSocket>;

export function usePerformance(options: {
  voiceState: VoiceApi["state"];
  measureLatency: VoiceApi["measureLatency"];
}) {
  const { voiceState, measureLatency } = options;

const performancePanelOpen = ref(false);
const performanceRunning = ref(false);
const performanceSamples = ref<LatencyProbeResult[]>([]);
const performanceProbeResults = ref<Array<LatencyProbeResult | null>>([]);
const performanceAttempts = ref(0);
const PERFORMANCE_INTERVAL_MS = 3_000;
const PERFORMANCE_WINDOW_SIZE = 20;
let performanceTimer: number | null = null;
let performanceMonitorGeneration = 0;
const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const performanceStats = computed(() => {
  const samples = performanceSamples.value;
  const attempts = performanceAttempts.value;
  const gatewaySamples = samples.map((sample) => sample.browserRttMs);
  const teamSpeakSamples = samples.filter((sample) => sample.teamSpeakReachable && sample.teamSpeakLatencyMs != null).map((sample) => sample.teamSpeakLatencyMs as number);
  return {
    gatewayLatencyMs: median(gatewaySamples),
    gatewayLossPercent: attempts > 0 ? Math.round(((attempts - samples.length) / attempts) * 100) : null,
    teamSpeakLatencyMs: median(teamSpeakSamples),
    teamSpeakLossPercent: attempts > 0 ? Math.round(((attempts - teamSpeakSamples.length) / attempts) * 100) : null,
    ready: attempts > 0,
  };
});

function togglePerformancePanel() {
  performancePanelOpen.value = !performancePanelOpen.value;
  if (performancePanelOpen.value) startPerformanceMonitoring();
  else stopPerformanceMonitoring();
}

function resetPerformanceSamples(): void {
  performanceProbeResults.value = [];
  performanceSamples.value = [];
  performanceAttempts.value = 0;
}

function startPerformanceMonitoring(): void {
  if (performanceTimer || !voiceState.connected) return;
  resetPerformanceSamples();
  const generation = ++performanceMonitorGeneration;
  void runPerformanceProbe(generation);
  performanceTimer = window.setInterval(() => {
    void runPerformanceProbe(generation);
  }, PERFORMANCE_INTERVAL_MS);
}

function stopPerformanceMonitoring(): void {
  if (performanceTimer) {
    clearInterval(performanceTimer);
    performanceTimer = null;
  }
  performanceMonitorGeneration += 1;
  performanceRunning.value = false;
}

function refreshPerformanceProbe(): void {
  void runPerformanceProbe();
}

async function runPerformanceProbe(generation = performanceMonitorGeneration): Promise<void> {
  if (performanceRunning.value || !voiceState.connected || !performancePanelOpen.value) return;
  performanceRunning.value = true;
  try {
    const sample = await measureLatency();
    if (generation !== performanceMonitorGeneration || !performancePanelOpen.value) return;
    performanceProbeResults.value.push(sample);
    if (performanceProbeResults.value.length > PERFORMANCE_WINDOW_SIZE) performanceProbeResults.value.shift();
    performanceAttempts.value = performanceProbeResults.value.length;
    performanceSamples.value = performanceProbeResults.value.filter((result): result is LatencyProbeResult => result !== null);
  } finally {
    if (generation === performanceMonitorGeneration) performanceRunning.value = false;
  }
}

  onUnmounted(() => {
    stopPerformanceMonitoring();
  });

  return { performancePanelOpen, performanceRunning, performanceSamples, performanceProbeResults, performanceAttempts, performanceStats, togglePerformancePanel, resetPerformanceSamples, startPerformanceMonitoring, stopPerformanceMonitoring, refreshPerformanceProbe, runPerformanceProbe };
}
