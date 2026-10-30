import { describe, expect, test } from "vitest";
import {
  activeSubagent,
  formatElapsed,
  INITIAL_SUBAGENT_STRIP_STATE,
  isSendableDraft,
  isSubagentRequestPending,
  type OmpSubagentRow,
  requestedSubmission,
  type SubagentStripAction,
  type SubagentStripState,
  stopOutcomeMessage,
  subagentRequestError,
  subagentStripReducer,
} from "../client/subagents-state";
import {
  cancelOmpSubagent,
  isLiveOmpSubagentStatus,
  MAX_OMP_SUBAGENT_STRIP_ENTRIES,
  OMP_SUBAGENT_STEER_MAX_LENGTH,
  OmpSubagentStatusSchema,
  ompSubagentStripSchema,
  steerOmpSubagent,
} from "../shared/subagents";

const CHILD: OmpSubagentRow = {
  id: "opaque-handle-1",
  agent: "reviewer",
  description: "Review the parser changes",
  runningSince: 1_000,
};
const OTHER: OmpSubagentRow = { ...CHILD, id: "opaque-handle-2", agent: "explore" };

function run(...actions: SubagentStripAction[]): SubagentStripState {
  return actions.reduce(subagentStripReducer, INITIAL_SUBAGENT_STRIP_STATE);
}

describe("OMP subagent strip state", () => {
  test("stop needs a confirmation and closes the row on either outcome", () => {
    const confirming = run({ type: "request-stop", subagent: CHILD });
    expect(confirming).toEqual({ kind: "confirming-stop", subagent: CHILD });
    expect(activeSubagent(confirming)).toBe(CHILD);
    expect(subagentStripReducer(confirming, { type: "dismiss" })).toBe(
      INITIAL_SUBAGENT_STRIP_STATE,
    );
    const stopping = subagentStripReducer(confirming, { type: "submit" });
    expect(stopping).toEqual({ kind: "stopping", subagent: CHILD });
    expect(isSubagentRequestPending(stopping)).toBe(true);
    expect(subagentStripReducer(stopping, { type: "settled" })).toBe(INITIAL_SUBAGENT_STRIP_STATE);
    expect(subagentStripReducer(stopping, { type: "failed" })).toBe(INITIAL_SUBAGENT_STRIP_STATE);
    expect(stopOutcomeMessage(true)).toBe("Subagent stopped");
    expect(stopOutcomeMessage(false)).toBe("The subagent had already finished");
  });

  test("keeps the steering draft after a failed send", () => {
    const steering = run({ type: "start-steer", subagent: CHILD });
    expect(steering).toEqual({ kind: "steering", subagent: CHILD, draft: "" });
    expect(subagentStripReducer(steering, { type: "submit" })).toBe(steering);
    const sending = run(
      { type: "start-steer", subagent: CHILD },
      { type: "edit-draft", draft: "Focus on the parser" },
      { type: "submit" },
    );
    expect(sending).toEqual({ kind: "sending", subagent: CHILD, draft: "Focus on the parser" });
    expect(subagentStripReducer(sending, { type: "settled" })).toBe(INITIAL_SUBAGENT_STRIP_STATE);
    expect(subagentStripReducer(sending, { type: "failed" })).toEqual({
      kind: "steering",
      subagent: CHILD,
      draft: "Focus on the parser",
    });
  });

  test("starts at most one request per submission", () => {
    const confirming = run({ type: "request-stop", subagent: CHILD });
    expect(requestedSubmission(confirming)).toEqual({ kind: "stopping", subagent: CHILD });
    const blank = run({ type: "start-steer", subagent: CHILD }, { type: "edit-draft", draft: " " });
    expect(requestedSubmission(blank)).toBeNull();
    const drafted = subagentStripReducer(blank, { type: "edit-draft", draft: "focus" });
    const sending = requestedSubmission(drafted);
    expect(sending).toEqual({ kind: "sending", subagent: CHILD, draft: "focus" });
    if (!sending) throw new Error("Expected a steering request");
    expect(requestedSubmission(sending)).toBeNull();
    expect(requestedSubmission(subagentStripReducer(confirming, { type: "submit" }))).toBeNull();
    expect(requestedSubmission(INITIAL_SUBAGENT_STRIP_STATE)).toBeNull();
  });

  test("ignores new requests and unrelated outcomes while a request is pending", () => {
    const sending = run(
      { type: "start-steer", subagent: CHILD },
      { type: "edit-draft", draft: "focus" },
      { type: "submit" },
    );
    for (const action of [
      { type: "request-stop", subagent: OTHER },
      { type: "start-steer", subagent: OTHER },
      { type: "edit-draft", draft: "changed" },
      { type: "dismiss" },
      { type: "submit" },
    ] satisfies SubagentStripAction[]) {
      expect(subagentStripReducer(sending, action)).toBe(sending);
    }
    expect(subagentStripReducer(INITIAL_SUBAGENT_STRIP_STATE, { type: "settled" })).toBe(
      INITIAL_SUBAGENT_STRIP_STATE,
    );
    expect(
      subagentStripReducer(INITIAL_SUBAGENT_STRIP_STATE, { type: "edit-draft", draft: "x" }),
    ).toBe(INITIAL_SUBAGENT_STRIP_STATE);
    expect(activeSubagent(INITIAL_SUBAGENT_STRIP_STATE)).toBeNull();
  });

  test("shows the handler's message without transport details", () => {
    const rpcError = Object.assign(
      new Error(
        "Request failed: This subagent is no longer running requestType=plugin.rpc.invoke.request code=handler_error",
      ),
      { userMessage: "Request failed: This subagent is no longer running" },
    );
    expect(subagentRequestError(rpcError)).toBe(
      "Request failed: This subagent is no longer running",
    );
    expect(subagentRequestError(new Error("offline"))).toBe("offline");
    expect(subagentRequestError("boom")).toBe("The OMP subagent request failed");
  });

  test("formats compact elapsed times", () => {
    expect(formatElapsed(-5)).toBe("0s");
    expect(formatElapsed(42_900)).toBe("42s");
    expect(formatElapsed(3 * 60_000 + 59_000)).toBe("3m");
    expect(formatElapsed(2 * 3_600_000)).toBe("2h");
    expect(formatElapsed(3_600_000 + 5 * 60_000)).toBe("1h 5m");
  });

  test("bounds steering text, identifiers, and strips at the contract", () => {
    expect(isSendableDraft("  ok  ")).toBe(true);
    expect(isSendableDraft(" \n ")).toBe(false);
    expect(
      steerOmpSubagent.input.parse({ agentId: "a", subagentId: "c", message: "  focus  " }),
    ).toEqual({ agentId: "a", subagentId: "c", message: "focus" });
    expect(
      steerOmpSubagent.input.safeParse({ agentId: "a", subagentId: "c", message: " \n " }).success,
    ).toBe(false);
    expect(
      steerOmpSubagent.input.safeParse({
        agentId: "a",
        subagentId: "c",
        message: "x".repeat(OMP_SUBAGENT_STEER_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      cancelOmpSubagent.input.safeParse({ agentId: "a", subagentId: "x".repeat(257) }).success,
    ).toBe(false);
    expect(ompSubagentStripSchema.safeParse({ subagents: [CHILD, OTHER] }).success).toBe(true);
    expect(
      ompSubagentStripSchema.safeParse({
        subagents: Array.from({ length: MAX_OMP_SUBAGENT_STRIP_ENTRIES + 1 }, () => CHILD),
      }).success,
    ).toBe(false);
    expect(
      OmpSubagentStatusSchema.options.filter((status) => isLiveOmpSubagentStatus(status)),
    ).toEqual(["pending", "running"]);
  });
});
