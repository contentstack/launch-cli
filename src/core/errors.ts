export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled. Nothing was changed.');
    this.name = 'CancelledError';
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super('This session carries no Contentstack authorisation type. Run csdx auth:login to continue.');
    this.name = 'UnauthenticatedError';
  }
}
