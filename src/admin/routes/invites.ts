import type { Router } from "express";
import { AdminInputError } from "../admin-service.js";
import type { AdminRouterOptions } from "./types.js";
import { requireCsrf, requireSameOrigin, sendAdminError } from "./middleware.js";
import { asRecord, readOptionalNumber, readOptionalString } from "./request-utils.js";

export function registerInviteRoutes(router: Router, options: AdminRouterOptions): void {

  router.get("/invites", (_request, response) => {
    response.json({ invites: options.service.listManagedInvites() });
  });

  router.post("/invites", requireSameOrigin, requireCsrf(options.sessions), (request, response) => {
    try {
      const body = asRecord(request.body);
      const created = options.service.createManagedInvite({
        channel: readOptionalString(body, "channel", 100),
        expiresInHours: readOptionalNumber(body, "expiresInHours", 1),
        maxUses: readOptionalNumber(body, "maxUses", 0),
      });
      response.status(201).json({ ok: true, ...created });
    } catch (error: unknown) {
      sendAdminError(response, error);
    }
  });

  router.post("/invites/:id/revoke", requireSameOrigin, requireCsrf(options.sessions), (request, response) => {
    try {
      const id = typeof request.params.id === "string" ? request.params.id : "";
      if (!id) throw new AdminInputError("INVALID_INVITE_ID", "Invite id is invalid");
      if (!options.service.revokeManagedInvite(id)) {
        response.status(404).json({ ok: false, code: "INVITE_NOT_FOUND" });
        return;
      }
      response.json({ ok: true });
    } catch (error: unknown) {
      sendAdminError(response, error);
    }
  });
}
