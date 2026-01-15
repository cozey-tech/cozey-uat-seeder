export class StagingGuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StagingGuardrailError";
    Object.setPrototypeOf(this, StagingGuardrailError.prototype);
  }
}
