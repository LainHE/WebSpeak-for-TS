import { computed } from "vue";


export function setupAdminOverview(vc: any): void {
  async function loadOverview() { Object.assign(vc.overview, await vc.getJson("/api/admin/vc.overview")); }
  const targetStatusText = computed(() => vc.overview.teamSpeak.status === "reachable" ? vc.tr('reachable') : vc.overview.teamSpeak.status === "unreachable" ? vc.tr('unreachable') : vc.tr('notTested'));
  async function dismissLegacyNotice() { await vc.sendJson("/api/admin/legacy-import/dismiss", "POST", {}); vc.overview.legacyConfigImported = false; }
  vc.loadOverview = loadOverview;
  vc.targetStatusText = targetStatusText;
  vc.dismissLegacyNotice = dismissLegacyNotice;
}
