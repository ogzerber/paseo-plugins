import {
  type PluginHostProps,
  type PluginTimelineItemProps,
  useRpc,
} from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  cancelOmpSubagent,
  OMP_SUBAGENT_STEER_MAX_LENGTH,
  type OmpSubagentStrip as OmpSubagentStripData,
  steerOmpSubagent,
} from "../shared/subagents";
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
} from "./subagents-state";

const ROW_HEIGHT = 28;

function createStyles(theme: PluginHostProps["theme"], compact: boolean) {
  return {
    root: { gap: 2, paddingVertical: 2 },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      height: ROW_HEIGHT,
      paddingLeft: compact ? 2 : 4,
    },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent },
    dotFinished: { backgroundColor: theme.colors.foregroundMuted },
    agent: { color: theme.colors.foreground, fontSize: 13, flexShrink: 0 },
    description: { color: theme.colors.foregroundMuted, fontSize: 13, flexShrink: 1, minWidth: 0 },
    elapsed: {
      color: theme.colors.foregroundMuted,
      fontSize: 12,
      fontVariant: ["tabular-nums" as const],
    },
    actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 2 },
    iconButton: {
      width: 24,
      height: 24,
      borderRadius: 6,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    textButton: {
      height: 24,
      paddingHorizontal: 8,
      borderRadius: 6,
      justifyContent: "center" as const,
    },
    hovered: { backgroundColor: theme.colors.surface2 },
    disabled: { opacity: 0.5 },
    stopLabel: { color: theme.colors.statusDanger, fontSize: 12 },
    keepLabel: { color: theme.colors.foregroundMuted, fontSize: 12 },
    tooltip: {
      position: "absolute" as const,
      bottom: 28,
      right: 0,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: theme.colors.surface2,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    tooltipText: { color: theme.colors.foreground, fontSize: 11 },
    input: {
      flexBasis: 360,
      flexShrink: 1,
      minWidth: 0,
      height: 24,
      paddingHorizontal: 8,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
      color: theme.colors.foreground,
      fontSize: 13,
    },
  };
}

type Styles = ReturnType<typeof createStyles>;

/** Re-renders once per second while `active`, for elapsed times. */
function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * Running OMP subagents of one `task` call, published by the provider below its tool card. Paseo
 * shows provider subagents read-only, so the plugin adds steer and stop here.
 */
export function OmpSubagentStrip({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<OmpSubagentStripData>) {
  const cancel = useRpc(cancelOmpSubagent);
  const steer = useRpc(steerOmpSubagent);
  const toast = useToast();
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const [state, dispatch] = useReducer(subagentStripReducer, INITIAL_SUBAGENT_STRIP_STATE);
  const listed = item.data.subagents;
  const active = activeSubagent(state);
  const unlisted = active && !listed.some((row) => row.id === active.id) ? active : null;
  const now = useSecondTick(listed.length > 0);

  async function submit(): Promise<void> {
    const request = requestedSubmission(state);
    dispatch({ type: "submit" });
    if (!request) return;
    try {
      if (request.kind === "stopping") {
        const result = await cancel({ agentId, subagentId: request.subagent.id });
        toast.show(stopOutcomeMessage(result.cancelled), {
          variant: result.cancelled ? "success" : "default",
        });
      } else {
        await steer({ agentId, subagentId: request.subagent.id, message: request.draft });
        toast.show("Message sent to the subagent", { variant: "success" });
      }
      dispatch({ type: "settled" });
    } catch (cause) {
      toast.error(subagentRequestError(cause));
      dispatch({ type: "failed" });
    }
  }

  if (listed.length === 0 && !unlisted) return null;
  return (
    <View style={styles.root}>
      {listed.map((row) => (
        <SubagentRow
          key={row.id}
          row={row}
          listed
          now={now}
          state={state}
          styles={styles}
          theme={theme}
          dispatch={dispatch}
          submit={submit}
        />
      ))}
      {unlisted ? (
        <SubagentRow
          row={unlisted}
          listed={false}
          now={now}
          state={state}
          styles={styles}
          theme={theme}
          dispatch={dispatch}
          submit={submit}
        />
      ) : null}
    </View>
  );
}

interface RowProps {
  row: OmpSubagentRow;
  /** False keeps the row that owns a draft visible after its subagent leaves the strip. */
  listed: boolean;
  now: number;
  state: SubagentStripState;
  styles: Styles;
  theme: PluginHostProps["theme"];
  dispatch: (action: SubagentStripAction) => void;
  submit(): Promise<void>;
}

function SubagentRow(props: RowProps) {
  const { row, listed, now, state, styles } = props;
  const owner = activeSubagent(state)?.id === row.id ? state : null;
  const steering = owner?.kind === "steering" || owner?.kind === "sending";
  return (
    <View style={styles.row}>
      <View style={[styles.dot, listed ? null : styles.dotFinished]} />
      <Text numberOfLines={1} style={styles.agent}>
        {row.agent}
      </Text>
      {steering ? (
        <SteerControls {...props} />
      ) : (
        <>
          <Text numberOfLines={1} style={styles.description}>
            {row.description ?? ""}
          </Text>
          {owner?.kind === "confirming-stop" || owner?.kind === "stopping" ? (
            <StopConfirmation {...props} />
          ) : (
            <>
              <Text style={styles.elapsed}>
                {listed ? formatElapsed(now - row.runningSince) : "finished"}
              </Text>
              {listed ? <RowActions {...props} /> : null}
            </>
          )}
        </>
      )}
    </View>
  );
}

function RowActions({ row, state, styles, theme, dispatch }: RowProps) {
  const pending = isSubagentRequestPending(state);
  return (
    <View style={styles.actions}>
      <IconButton
        icon="MessageSquare"
        label="Steer: send this subagent a message at its next step"
        disabled={pending}
        styles={styles}
        theme={theme}
        onPress={() => dispatch({ type: "start-steer", subagent: row })}
      />
      <IconButton
        icon="CircleStop"
        label="Stop this subagent and its nested subagents; the parent keeps running"
        disabled={pending}
        styles={styles}
        theme={theme}
        onPress={() => dispatch({ type: "request-stop", subagent: row })}
      />
    </View>
  );
}

function StopConfirmation({ state, styles, dispatch, submit }: RowProps) {
  const stopping = state.kind === "stopping";
  return (
    <View style={styles.actions}>
      <TextButton
        label={stopping ? "Stopping..." : "Stop"}
        accessibilityLabel="Confirm stopping this subagent"
        labelStyle={styles.stopLabel}
        disabled={stopping}
        styles={styles}
        onPress={() => void submit()}
      />
      <TextButton
        label="Keep"
        accessibilityLabel="Keep this subagent running"
        labelStyle={styles.keepLabel}
        disabled={stopping}
        styles={styles}
        onPress={() => dispatch({ type: "dismiss" })}
      />
    </View>
  );
}

function SteerControls({ row, state, styles, theme, dispatch, submit }: RowProps) {
  const sending = state.kind === "sending";
  const draft = state.kind === "steering" || state.kind === "sending" ? state.draft : "";
  return (
    <>
      <TextInput
        accessibilityLabel={`Message for ${row.agent}`}
        autoFocus
        editable={!sending}
        maxLength={OMP_SUBAGENT_STEER_MAX_LENGTH}
        onChangeText={(text) => dispatch({ type: "edit-draft", draft: text })}
        onKeyPress={(event) => {
          if (event.nativeEvent.key === "Escape") dispatch({ type: "dismiss" });
        }}
        onSubmitEditing={() => void submit()}
        placeholder="Message the subagent"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={styles.input}
        value={draft}
      />
      <View style={styles.actions}>
        <IconButton
          icon="SendHorizontal"
          label="Send to the subagent (Enter)"
          disabled={sending || !isSendableDraft(draft)}
          styles={styles}
          theme={theme}
          onPress={() => void submit()}
        />
        <IconButton
          icon="X"
          label="Close (Esc)"
          disabled={sending}
          styles={styles}
          theme={theme}
          onPress={() => dispatch({ type: "dismiss" })}
        />
      </View>
    </>
  );
}

function IconButton({
  icon,
  label,
  disabled,
  styles,
  theme,
  onPress,
}: {
  icon: string;
  label: string;
  disabled: boolean;
  styles: Styles;
  theme: PluginHostProps["theme"];
  onPress(): void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onPress={onPress}
        style={[
          styles.iconButton,
          hovered && !disabled ? styles.hovered : null,
          disabled ? styles.disabled : null,
        ]}
      >
        <Icon name={icon} size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
      {hovered && !disabled ? (
        <View pointerEvents="none" style={styles.tooltip}>
          <Text numberOfLines={1} style={styles.tooltipText}>
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function TextButton({
  label,
  accessibilityLabel,
  labelStyle,
  disabled,
  styles,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  labelStyle: Styles["stopLabel"];
  disabled: boolean;
  styles: Styles;
  onPress(): void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={[styles.textButton, hovered && !disabled ? styles.hovered : null]}
    >
      <Text style={labelStyle}>{label}</Text>
    </Pressable>
  );
}
