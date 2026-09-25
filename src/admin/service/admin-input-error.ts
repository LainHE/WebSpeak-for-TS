// AdminInputError shared by all admin service modules.
export class AdminInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AdminInputError";
  }
}
