import type { Router } from "express";
import type { Logger } from "../../logger.js";
import { isSecureRequest } from "../admin-session.js";
import { AdminLoginRateLimiter, waitFor } from "../login-rate-limit.js";
import type { AdminRouterOptions } from "./types.js";
import { requireAdmin, requireCsrf, requireSameOrigin, sendAdminError } from "./middleware.js";
import { asRecord, readOptionalString, readString } from "./request-utils.js";

export function registerAuthRoutes(router: Router, options: AdminRouterOptions): void {
  const limiter = new AdminLoginRateLimiter();
  const logger = options.logger.child({ component: "admin-api" });

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/status", (_request, response) => {
    response.json({ initialized: options.service.isInitialized() });
  });

  router.get("/session", (request, response) => {
    const session = options.sessions.get(request);
    response.json({
      initialized: options.service.isInitialized(),
      authenticated: Boolean(session),
      mustChangePassword: Boolean(session) && options.service.isPasswordChangeRequired(),
      ...(session ? { csrfToken: session.csrfToken, expiresAt: session.expiresAt } : {}),
    });
  });

  router.post("/login", requireSameOrigin, async (request, response) => {
    if (!options.service.isInitialized()) {
      response.status(409).json({ ok: false, code: "NOT_INITIALIZED" });
      return;
    }
    const peer = request.socket.remoteAddress ?? "unknown";
    const retryAfterMs = limiter.retryAfterMs(peer);
    if (retryAfterMs > 0) {
      response.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      response.status(429).json({ ok: false, code: "RATE_LIMITED", retryAfterMs });
      return;
    }
    const body = asRecord(request.body);
    const username = readString(body, "username", 64).trim();
    const password = readOptionalString(body, "password", 1024);
    if (!await options.service.verifyPassword(username, password)) {
      const delayMs = limiter.recordFailure(peer);
      await waitFor(delayMs);
      options.service.database.addAudit("ADMIN_LOGIN_FAILED");
      logger.warn("Administrator login failed");
      response.status(401).json({ ok: false, code: "INVALID_PASSWORD" });
      return;
    }
    limiter.recordSuccess(peer);
    options.service.database.addAudit("ADMIN_LOGIN_SUCCEEDED");
    const session = options.sessions.create(response, isSecureRequest(request));
    response.json({ ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt, mustChangePassword: options.service.isPasswordChangeRequired() });
  });

  router.post("/change-password", requireSameOrigin, requireCsrf(options.sessions), async (request, response) => {
    try {
      const body = asRecord(request.body);
      await options.service.changePassword(readString(body, "newPassword", 1024));
      response.json({ ok: true, mustChangePassword: false });
    } catch (error: unknown) {
      sendAdminError(response, error);
    }
  });

  router.post("/logout", requireSameOrigin, requireCsrf(options.sessions), (request, response) => {
    options.sessions.destroy(request, response, isSecureRequest(request));
    options.service.database.addAudit("ADMIN_LOGOUT");
    response.json({ ok: true });
  });

  router.use(requireAdmin(options.sessions, options.service));
}
