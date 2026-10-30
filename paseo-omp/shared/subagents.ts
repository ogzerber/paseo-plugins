import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const OMP_SUBAGENT_STEER_MAX_LENGTH = 16_384;
export const OMP_SUBAGENT_DESCRIPTION_MAX_LENGTH = 512;

const AgentIdSchema = z.string().min(1).max(256);
const SubagentIdSchema = z.string().min(1).max(256);

export const OmpSubagentStatusSchema = z.enum([
  "pending",
  "running",
  "started",
  "completed",
  "failed",
  "aborted",
]);
export type OmpSubagentStatus = z.infer<typeof OmpSubagentStatusSchema>;

export const cancelOmpSubagent = defineRpc({
  name: "paseo-omp.cancel-subagent",
  input: z.object({ agentId: AgentIdSchema, subagentId: SubagentIdSchema }),
  /** `false` when the subagent had already finished; cancelling is idempotent. */
  output: z.object({ cancelled: z.boolean() }),
});

export const steerOmpSubagent = defineRpc({
  name: "paseo-omp.steer-subagent",
  input: z.object({
    agentId: AgentIdSchema,
    subagentId: SubagentIdSchema,
    message: z.string().trim().min(1).max(OMP_SUBAGENT_STEER_MAX_LENGTH),
  }),
  output: z.object({ accepted: z.literal(true) }),
});

export const OMP_SUBAGENT_STRIP_KIND = "omp-subagents";
export const MAX_OMP_SUBAGENT_STRIP_ENTRIES = 64;

/** The running subagents of one `task` call, rendered below its tool card. */
export const ompSubagentStripSchema = z.object({
  subagents: z
    .array(
      z.object({
        /** Opaque handle scoped to the agent's current OMP session, never the native OMP ID. */
        id: SubagentIdSchema,
        agent: z.string().min(1).max(256),
        description: z.string().max(OMP_SUBAGENT_DESCRIPTION_MAX_LENGTH).nullable(),
        /** Epoch milliseconds when the plugin last saw the subagent start running. */
        runningSince: z.number().int().nonnegative(),
      }),
    )
    .max(MAX_OMP_SUBAGENT_STRIP_ENTRIES),
});
export type OmpSubagentStrip = z.infer<typeof ompSubagentStripSchema>;

/** OMP reaches a subagent only while its roster lists it as running or pending. */
export function isLiveOmpSubagentStatus(status: OmpSubagentStatus): boolean {
  return status === "pending" || status === "running";
}
