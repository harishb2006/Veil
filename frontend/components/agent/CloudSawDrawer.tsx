"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MODE_META } from "@/lib/agent/modes";
import { cloudTranscript } from "@/lib/agent/transcript";
import type { Mode, Run } from "@/lib/agent/types";
import { Expandable, RichText } from "./primitives";

const ROLE_LABEL = { system: "System", user: "User", assistant: "Agent", tool: "Tool result" } as const;

/** Right-hand drawer: the task as typed vs as the cloud saw it, plus the conversation the cloud model was shown. */
export function CloudSawDrawer({ mode, run, onClose }: { mode: Mode | null; run: Run | null; onClose: () => void }) {
  const open = mode !== null && run !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const meta = mode ? MODE_META[mode] : null;
  const messages = run ? cloudTranscript(run) : [];

  return (
    <AnimatePresence>
      {open && mode && run && meta && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`What the cloud saw in ${meta.label}`}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col border-l border-line bg-hull"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">What the cloud saw</h2>
                <p className="mt-0.5 text-sm text-mist">{meta.label}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-sm text-sm text-mist underline-offset-4 hover:text-ink hover:underline"
              >
                Close (Esc)
              </button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <p className="text-sm leading-relaxed text-mist">
                {mode === "raw"
                  ? "No inner door: the cloud model received your task and every tool result exactly as written, real values included."
                  : "The cloud model only ever saw placeholders. Real values stay on this machine and are restored locally, and only where the policy allows."}
              </p>

              <section>
                <h3 className="mb-1.5 text-sm font-semibold text-ink">You typed</h3>
                <p className="rounded-md bg-panel p-3 font-mono text-[13px] leading-relaxed text-ink">
                  <RichText text={run.task} />
                </p>
              </section>
              <section>
                <h3 className="mb-1.5 text-sm font-semibold text-ink">The cloud saw</h3>
                <p className="rounded-md bg-panel p-3 font-mono text-[13px] leading-relaxed text-ink">
                  <RichText text={run.task_cloud_saw} />
                </p>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-ink">Conversation shown to the model</h3>
                <ol className="space-y-3">
                  {messages.map((m, i) => (
                    <li key={i}>
                      <p className="mb-1 text-[13px] text-mist">{ROLE_LABEL[m.role]}</p>
                      <Expandable long={m.content.length > 500} collapsedClass="max-h-40">
                        <p className="rounded-md bg-panel p-3 font-mono text-[13px] leading-relaxed text-ink">
                          <RichText text={m.content} />
                        </p>
                      </Expandable>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
