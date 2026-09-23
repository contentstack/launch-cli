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
