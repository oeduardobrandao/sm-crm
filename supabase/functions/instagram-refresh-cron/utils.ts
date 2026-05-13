export function shouldRevokeOnError(errorCode: number | undefined): boolean {
  return errorCode === 190 || errorCode === 10;
}
