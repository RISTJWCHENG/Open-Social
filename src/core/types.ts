/** Error with a stable code the UI and tests can check. */
export class OpenSocialError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OpenSocialError';
  }
}
