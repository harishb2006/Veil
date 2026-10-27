/** Derived presentation facts for a run: outcome sentence, counters, presenter note text. */

import { tokenize } from "./highlight";
import type { Mode, Run } from "./types";

export type OutcomeTone = "threat" | "outer" | "safe" | "mist";

export interface Outcome {
  tone: OutcomeTone;
  /** One plain sentence: what actually happened. */
  text: string;
}

export interface Counters {
  toolCalls: number;
  blocked: number;
  findings: number;
}

const isEvil = (to: string) => to.endsWith("evil.test");

export function attackerAddress(run: Run): string {
  return run.outbox_delta.find((o) => isEvil(o.to))?.to ?? "attacker@evil.test";
}

export function counters(run: Run): Counters {
  if (run.status === "done") {
    return { toolCalls: run.summary.tool_calls, blocked: run.summary.blocked, findings: run.summary.findings };
  }
  return {
    toolCalls: run.steps.filter((s) => s.type === "tool_call").length,
    blocked: run.steps.filter((s) => s.decision && s.decision.decision !== "allow").length,
    findings: run.steps.reduce((n, s) => n + (s.findings?.length ?? 0), 0),
  };
}

export function outcome(run: Run): Outcome {
  if (run.status === "error") {
    return { tone: "mist", text: run.error ? `Run failed: ${run.error}` : "Run failed." };
  }
  const s = run.summary;
  const attacker = attackerAddress(run);
  const shellToAttacker = run.shell_delta.some((c) => c.command.includes("evil.test"));
  if (s.leaked_canary) {
    return {
      tone: "threat",
      text: shellToAttacker && !run.outbox_delta.some((o) => isEvil(o.to))
        ? "Real API key sent to evil.test in a shell command"
        : `Real API key emailed to ${attacker}`,
    };
  }
  if (s.attacker_reached) {
    const mail = run.outbox_delta.find((o) => isEvil(o.to));
    if (mail) {
      const token = tokenize(mail.body).find((t) => t.kind === "redacted" || t.kind === "placeholder");
      return {
        tone: "outer",
        text: token
          ? `Attacker reached, but only ${token.text} left the machine`
          : `Attacker reached at ${mail.to}, but no real secret left the machine`,
      };
    }
    return { tone: "outer", text: "Attacker's shell command ran (simulated); no real secret was in it" };
  }
  const delivered = run.outbox_delta.find((o) => !isEvil(o.to));
  const sent = delivered ? ` Summary sent to ${delivered.to}.` : "";
  const quarantined = run.steps.some((st) => st.verdict === "QUARANTINED");
  const sanitized = run.steps.some((st) => st.verdict === "SANITIZED");
  if (s.blocked > 0 || quarantined || sanitized) {
    const how = quarantined
      ? " Poisoned content quarantined."
      : s.blocked > 0
        ? " Planted destination blocked."
        : " Hidden instruction removed.";
    return { tone: "safe", text: delivered ? `Attack stopped.${sent}` : `Attack stopped.${how}` };
  }
  return { tone: "safe", text: delivered ? `Task completed. Nothing to block.${sent}` : "Task completed. Nothing to block." };
}

/** Text for the numbered presenter callouts, built only from what actually happened in the run. */
export function calloutText(mode: Mode, run: Run): string {
  const attacker = run.outbox_delta.find((o) => isEvil(o.to));
  const shell = run.shell_delta.find((c) => c.command.includes("evil.test"));
  const running = run.status === "running";

  if (mode === "raw") {
    if (attacker) {
      return run.summary.leaked_canary
        ? `The agent obeys the planted order. The real key goes to ${attacker.to}.`
        : `The agent obeys the planted order and emails ${attacker.to}.`;
    }
    if (shell) return "The agent runs the attacker's shell command.";
    return running ? "No protection: the agent does whatever the content says." : "No attack landed in this run.";
  }

  if (mode === "v1") {
    if (attacker) {
      const token = tokenize(attacker.body).find((t) => t.kind === "redacted" || t.kind === "placeholder");
      return token
        ? `Still hijacked, but only ${token.text} leaves.`
        : "Still hijacked: the inner door can't stop an order that carries no private data.";
    }
    if (shell) return "Still hijacked: the shell command ran. Placeholders can't stop commands.";
    return running ? "Inner door only: the cloud sees placeholders, not real values." : "No attack landed in this run.";
  }

  const parts: string[] = [];
  const quarantined = run.steps.some((s) => s.verdict === "QUARANTINED");
  const sanitized = run.steps.some((s) => s.verdict === "SANITIZED");
  if (quarantined) parts.push("Poisoned page quarantined");
  else if (sanitized) parts.push("Hidden order removed");
  const block = run.steps.find((s) => s.decision && s.decision.decision !== "allow");
  if (block) parts.push(block.tool === "send_email" ? "planted recipient blocked" : "dangerous call blocked");
  const delivered = run.outbox_delta.find((o) => !isEvil(o.to));
  if (delivered) parts.push(`the summary still reaches ${delivered.to}`);
  if (parts.length === 0) return running ? "Scanning every result, checking every call…" : "Nothing to stop: the task ran normally.";
  const text = parts.join(". ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}
