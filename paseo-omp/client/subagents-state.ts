import type { OmpSubagentStrip } from "../shared/subagents";

export type OmpSubagentRow = OmpSubagentStrip["subagents"][number];

/**
 * One row of a subagent strip at a time owns the stop confirmation, the steering draft, or the
 * pending request. The state keeps that row as last listed, so its draft stays visible after the
 * subagent leaves the strip.
 */
export type SubagentStripState =
  | { kind: "idle" }
  | { kind: "confirming-stop"; subagent: OmpSubagentRow }
  | { kind: "steering"; subagent: OmpSubagentRow; draft: string }
  | { kind: "stopping"; subagent: OmpSubagentRow }
  | { kind: "sending"; subagent: OmpSubagentRow; draft: string };

export type SubagentStripAction =
  | { type: "request-stop"; subagent: OmpSubagentRow }
  | { type: "start-steer"; subagent: OmpSubagentRow }
  | { type: "edit-draft"; draft: string }
  | { type: "dismiss" }
  | { type: "submit" }
  | { type: "settled" }
  | { type: "failed" };

type PendingState = Extract<SubagentStripState, { kind: "stopping" | "sending" }>;

export const INITIAL_SUBAGENT_STRIP_STATE: SubagentStripState = { kind: "idle" };

export function isSendableDraft(draft: string): boolean {
  return draft.trim().length > 0;
}

export function isSubagentRequestPending(state: SubagentStripState): state is PendingState {
  return state.kind === "stopping" || state.kind === "sending";
}

/** The subagent a row's controls belong to while it owns the strip, or `null`. */
export function activeSubagent(state: SubagentStripState): OmpSubagentRow | null {
  return state.kind === "idle" ? null : state.subagent;
}

/**
 * The request a submit starts from this state, or `null` when it starts none. A submit while a
 * request is pending starts nothing, so a repeated press cannot send a second steering message.
 */
export function requestedSubmission(state: SubagentStripState): PendingState | null {
  if (isSubagentRequestPending(state)) return null;
  const next = subagentStripReducer(state, { type: "submit" });
  return isSubagentRequestPending(next) ? next : null;
}

export function subagentStripReducer(
  state: SubagentStripState,
  action: SubagentStripAction,
): SubagentStripState {
  if (isSubagentRequestPending(state)) return settle(state, action);
  switch (action.type) {
    case "request-stop":
      return { kind: "confirming-stop", subagent: action.subagent };
    case "start-steer":
      return { kind: "steering", subagent: action.subagent, draft: "" };
    case "edit-draft":
      return state.kind === "steering" ? { ...state, draft: action.draft } : state;
    case "dismiss":
      return INITIAL_SUBAGENT_STRIP_STATE;
    case "submit":
      if (state.kind === "confirming-stop") return { kind: "stopping", subagent: state.subagent };
      if (state.kind === "steering" && isSendableDraft(state.draft)) {
        return { kind: "sending", subagent: state.subagent, draft: state.draft };
      }
      return state;
    default:
      return state;
  }
}

/** A failed send reopens its draft for another try; every other outcome closes the row. */
function settle(state: PendingState, action: SubagentStripAction): SubagentStripState {
  if (action.type === "settled") return INITIAL_SUBAGENT_STRIP_STATE;
  if (action.type !== "failed") return state;
  return state.kind === "sending"
    ? { kind: "steering", subagent: state.subagent, draft: state.draft }
    : INITIAL_SUBAGENT_STRIP_STATE;
}

export function stopOutcomeMessage(cancelled: boolean): string {
  return cancelled ? "Subagent stopped" : "The subagent had already finished";
}

/** The host's RPC error keeps the handler's text in `userMessage`, without transport details. */
export function subagentRequestError(cause: unknown): string {
  if (cause instanceof Error) {
    const userMessage: unknown = Reflect.get(cause, "userMessage");
    return typeof userMessage === "string" && userMessage ? userMessage : cause.message;
  }
  return "The OMP subagent request failed";
}

/** Compact elapsed time, such as `42s`, `3m`, or `1h 5m`. */
export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}
