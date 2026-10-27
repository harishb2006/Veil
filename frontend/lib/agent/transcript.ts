import { argToString } from "./highlight";
import type { Run, TranscriptMessage } from "./types";

/** What the cloud model was shown: the backend transcript when present, otherwise rebuilt from the steps. */
export function cloudTranscript(run: Run): TranscriptMessage[] {
  if (run.transcript && run.transcript.length > 0) return run.transcript;
  const out: TranscriptMessage[] = [{ role: "user", content: run.task_cloud_saw }];
  for (const step of run.steps) {
    if (step.type === "tool_call") {
      const args = Object.entries(step.args_cloud_saw ?? {})
        .map(([k, v]) => `${k}=${JSON.stringify(argToString(v))}`)
        .join(", ");
      out.push({ role: "assistant", content: `${step.tool}(${args})` });
    } else if (step.type === "tool_result") {
      out.push({ role: "tool", content: step.content_for_model ?? step.raw_content ?? "" });
    } else if (step.type === "final") {
      out.push({ role: "assistant", content: run.final_cloud_raw ?? step.content_for_model ?? "" });
    }
  }
  return out;
}
