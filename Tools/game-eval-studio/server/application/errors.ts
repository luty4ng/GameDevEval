export type ErrorCode = 'INVALID_INPUT' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT';
// Application errors express business outcomes. HTTP status mapping belongs to the transport.
export class ApplicationError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); }
}
export const reject = (code: ErrorCode, message: string): never => { throw new ApplicationError(code, message); };
