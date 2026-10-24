export class ProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export function httpStatus(code: string): number {
  switch (code) {
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'expired':
      return 410;
    case 'too_large':
      return 413;
    case 'rate_limited':
      return 429;
    default:
      return 400;
  }
}
