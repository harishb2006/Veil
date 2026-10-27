import type { Mode } from "./types";

export interface ModeMeta {
  id: Mode;
  label: string;
  /** One muted sentence for the column header. */
  protection: string;
  /** Narration shown in presenter mode before the run has produced anything. */
  presenterIdle: string;
  presenterStep: number;
}

export const MODE_META: Record<Mode, ModeMeta> = {
  raw: {
    id: "raw",
    label: "Raw agent",
    protection: "No protection",
    presenterIdle: "The hijack works.",
    presenterStep: 1,
  },
  full: {
    id: "full",
    label: "Full Airlock",
    protection: "Outer door + gate + inner door",
    presenterIdle: "The attack never lands.",
    presenterStep: 2,
  },
};
