import type { Router, Response } from "express";
import { AdminInputError, type AdminService, type AdminSettingsInput, type RelayNodeInput } from "../admin-service.js";
import { TeamSpeakProbeError } from "../../server/teamspeak-probe.js";
import type { AdminRouterOptions } from "./types.js";
import { requireCsrf, requireSameOrigin, sendAdminError } from "./middleware.js";
import { asRecord, readOptionalInteger, readOptionalString, readPasswordAction, readRelaySettingsAction, readString } from "./request-utils.js";

export function registerServerRoutes(router: Router, options: AdminRouterOptions): void {

  router.get("/server", (_request, response) => {
    response.json(options.service.getAdminSettings());
  });

  router.put("/server", requireSameOrigin, requireCsrf(options.sessions), (request, response) => {
    try {
      options.service.updateSettings(readSettingsInput(asRecord(request.body)));
      response.json({ ok: true, settings: options.service.getAdminSettings() });
    } catch (error: unknown) {
      sendAdminError(response, error);
    }
  });

  router.post("/server/test", requireSameOrigin, requireCsrf(options.sessions), async (request, response) => {
    const body = asRecord(request.body);
    const action = readPasswordAction(body.passwordAction);
    const password = action === "remove"
      ? ""
      : typeof body.serverPassword === "string"
        ? body.serverPassword.slice(0, 512)
        : options.service.getConnectionPolicy().serverPassword;
    await runProbe(options.service, response, readString(body, "target", 300), password, true);
  });

  router.post("/legacy-import/dismiss", requireSameOrigin, requireCsrf(options.sessions), (_request, response) => {
    options.service.dismissLegacyImportNotice();
    response.json({ ok: true });
  });
}

async function runProbe(
  service: AdminService,
  response: Response,
  target: string,
  password: string,
  persistResult: boolean,
): Promise<void> {
  try {
    response.json(await service.testConnection(target, password, persistResult));
  } catch (error: unknown) {
    if (error instanceof TeamSpeakProbeError) {
      response.status(400).json({ ok: false, code: error.code });
      return;
    }
    sendAdminError(response, error);
  }
}

function readSettingsInput(body: Record<string, unknown>): AdminSettingsInput {
  const relayNodes = Array.isArray(body.relayNodes)
    ? body.relayNodes.map((value): RelayNodeInput => {
      const node = asRecord(value);
      return {
        id: typeof node.id === "string" ? node.id.slice(0, 110) : undefined,
        name: typeof node.name === "string" ? node.name.slice(0, 80) : "",
        target: typeof node.target === "string" ? node.target.slice(0, 300) : "",
        enabled: node.enabled === true,
        token: typeof node.token === "string" ? node.token.slice(0, 512) : undefined,
        tokenAction: readPasswordAction(node.tokenAction),
      };
    })
    : undefined;
  return {
    target: readString(body, "target", 300),
    serverPassword: typeof body.serverPassword === "string" ? body.serverPassword.slice(0, 512) : undefined,
    passwordAction: readPasswordAction(body.passwordAction),
    accessMode: body.accessMode === "open" ? "open" : body.accessMode === "fixed" ? "fixed" : body.accessMode as never,
    siteName: readString(body, "siteName", 80),
    welcomeText: readOptionalString(body, "welcomeText", 500),
    welcomeTextEn: typeof body.welcomeTextEn === "string" ? body.welcomeTextEn.slice(0, 500) : undefined,
    welcomeTextDe: typeof body.welcomeTextDe === "string" ? body.welcomeTextDe.slice(0, 500) : undefined,
    welcomeTextRu: typeof body.welcomeTextRu === "string" ? body.welcomeTextRu.slice(0, 500) : undefined,
    welcomeTextJa: typeof body.welcomeTextJa === "string" ? body.welcomeTextJa.slice(0, 500) : undefined,
    webRtcEnabled: body.webRtcEnabled === true,
    webRtcUdpStart: readOptionalInteger(body, "webRtcUdpStart"),
    webRtcUdpEnd: readOptionalInteger(body, "webRtcUdpEnd"),
    relaySettingsAction: readRelaySettingsAction(body.relaySettingsAction),
    relayEnabled: body.relayEnabled === true,
    relayName: typeof body.relayName === "string" ? body.relayName.slice(0, 80) : undefined,
    relayTarget: typeof body.relayTarget === "string" ? body.relayTarget.slice(0, 300) : undefined,
    relayToken: typeof body.relayToken === "string" ? body.relayToken.slice(0, 512) : undefined,
    relayTokenAction: readPasswordAction(body.relayTokenAction),
    relayNodes,
  };
}
