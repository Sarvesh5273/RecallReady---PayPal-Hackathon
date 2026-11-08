export class BusinessError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export function notFound(): never {
  throw new BusinessError("NOT_FOUND", "This record is not available.", 404);
}
