import type { AttemptState } from "./types";
export function refundState(status: string): AttemptState {
  return (
    (
      {
        COMPLETED: "COMPLETED",
        PENDING: "PROVIDER_PENDING",
        FAILED: "FAILED_FINAL",
        CANCELLED: "CANCELLED_FINAL",
      } as Record<string, AttemptState>
    )[status] ?? "OUTCOME_UNKNOWN"
  );
}
export function preserveTerminal(
  current: AttemptState,
  next: AttemptState,
): AttemptState {
  return ["COMPLETED", "FAILED_FINAL", "CANCELLED_FINAL"].includes(current)
    ? current
    : next;
}
