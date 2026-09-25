import { AdminServiceStats } from "./stats.js";

export { AdminInputError } from "./admin-input-error.js";
export type { AdminSettingsInput, ConnectionPolicy, ManagedInviteInput, ManagedInviteView, RelayNodeInput } from "./types.js";

export class AdminService extends AdminServiceStats {}
