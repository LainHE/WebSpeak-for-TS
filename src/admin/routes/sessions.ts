import type { Router } from "express";
import type { AdminRouterOptions } from "./types.js";
import { requireCsrf, requireSameOrigin } from "./middleware.js";

export function registerSessionRoutes(router: Router, options: AdminRouterOptions): void {

  router.get("/sessions", (_request, response) => {
    response.json({ sessions: options.getSessionSummaries?.() ?? [] });
  });

  router.post("/sessions/:id/terminate", requireSameOrigin, requireCsrf(options.sessions), async (request, response) => {
    const id = typeof request.params.id === "string" ? request.params.id : "";
    if (!options.terminateSession || !id || !(await options.terminateSession(id))) {
      response.status(404).json({ ok: false, code: "SESSION_NOT_FOUND" });
      return;
    }
    options.service.database.addAudit("ADMIN_SESSION_TERMINATED", { id });
    response.json({ ok: true });
  });
}
