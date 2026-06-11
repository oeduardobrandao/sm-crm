export function seatsAvailable(
  args: { limit: number | null; members: number; pendingInvites: number },
): boolean {
  if (args.limit === null) return true; // unlimited
  return args.members + args.pendingInvites < args.limit;
}
