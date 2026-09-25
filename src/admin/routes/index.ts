import { Router, type NextFunction, type Request, type Response } from "express";
import type { AdminRouterOptions } from "./types.js";
import { registerAuthRoutes } from "./auth.js";
import { registerInviteRoutes } from "./invites.js";
import { registerOverviewRoutes } from "./overview.js";
import { registerServerRoutes } from "./server.js";
import { registerSessionRoutes } from "./sessions.js";
import { sendAdminError } from "./middleware.js";

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router();
  registerAuthRoutes(router, options);
  registerOverviewRoutes(router, options);
  registerSessionRoutes(router, options);
  registerInviteRoutes(router, options);
  registerServerRoutes(router, options);
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    sendAdminError(response, error);
  });
  return router;
}

export { readConnectionHistory } from "./logs.js";
export type { AdminConnectionRecord, AdminLogEntry, AdminOverview, AdminRouterOptions, StructuredLogEntry } from "./types.js";
