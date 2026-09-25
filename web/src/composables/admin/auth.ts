import { computed } from "vue";
import type { ApiError } from "./api.js";


export function setupAdminAuth(vc: any): void {
  const passwordStrength = computed(() => Math.min(100, Math.max(8, vc.newPassword.value.length * 5 + (/[\s\W]/.test(vc.newPassword.value) ? 15 : 0))));
  async function loadAdminView() { vc.loading.value = true; try { const session = await vc.getJson("/api/admin/session"); if (!session.authenticated) { vc.screen.value = "login"; if (vc.route.path !== "/admin/login") await vc.router.replace("/admin/login"); } else if (session.mustChangePassword) { vc.csrfToken.value = String(session.csrfToken || ""); vc.screen.value = "change-password"; if (vc.route.path !== "/admin/change-password") await vc.router.replace("/admin/change-password"); } else { vc.csrfToken.value = String(session.csrfToken || ""); vc.screen.value = "admin"; if (vc.route.path === "/admin/login" || vc.route.path === "/admin/change-password") await vc.router.replace("/admin"); await Promise.all([vc.loadOverview(), vc.loadServerSettings()]); if (vc.route.path === "/admin/operations") await vc.loadOperations(); } } catch { vc.errorMessage.value = vc.tr('requestFailed'); } finally { vc.loading.value = false; } }
  async function login() { vc.submitting.value = true; vc.errorMessage.value = ""; try { const result = await vc.sendJson("/api/admin/login", "POST", { username: vc.loginUsername.value, password: vc.loginPassword.value }, false); vc.csrfToken.value = String(result.csrfToken || ""); vc.loginPassword.value = ""; if (result.mustChangePassword) { vc.screen.value = "change-password"; await vc.router.replace("/admin/change-password"); } else { vc.screen.value = "admin"; await vc.router.replace("/admin"); await Promise.all([vc.loadOverview(), vc.loadServerSettings()]); } } catch (error) { vc.errorMessage.value = vc.errorText((error as ApiError).code); } finally { vc.submitting.value = false; } }
  async function changePassword() { vc.errorMessage.value = ""; if (vc.newPassword.value.length < 12) { vc.errorMessage.value = vc.tr('setupPasswordShort'); return; } if (vc.newPassword.value !== vc.confirmNewPassword.value) { vc.errorMessage.value = vc.tr('setupPasswordsMismatch'); return; } vc.submitting.value = true; try { await vc.sendJson("/api/admin/change-password", "POST", { newPassword: vc.newPassword.value }); vc.newPassword.value = ""; vc.confirmNewPassword.value = ""; vc.screen.value = "admin"; await vc.router.replace("/admin"); await Promise.all([vc.loadOverview(), vc.loadServerSettings()]); } catch (error) { vc.errorMessage.value = vc.errorText((error as ApiError).code); } finally { vc.submitting.value = false; } }
  async function logout() { try { await vc.sendJson("/api/admin/logout", "POST", {}); } finally { vc.csrfToken.value = ""; vc.screen.value = "login"; await vc.router.replace("/admin/login"); } }
  vc.passwordStrength = passwordStrength;
  vc.loadAdminView = loadAdminView;
  vc.login = login;
  vc.changePassword = changePassword;
  vc.logout = logout;
}
