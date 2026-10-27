// Error strip/card with an optional action. `inline` is the slim one-line variant.
import { AlertCircle } from "lucide-react";

export interface ErrorInfo {
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}

const ACTION =
  "shrink-0 rounded-md border border-line bg-hull px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-mist/50";

export function ErrorBanner({ title, message, action, inline = false }: ErrorInfo & { inline?: boolean }) {
  if (inline) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm">
        <AlertCircle className="h-4 w-4 shrink-0 text-threat" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-mist">
          <span className="font-semibold text-ink">{title}.</span> {message}
        </p>
        {action && (
          <button type="button" onClick={action.onClick} className={ACTION}>
            {action.label}
          </button>
        )}
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-lg border border-threat/30 bg-threat/[0.06] p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-px h-5 w-5 shrink-0 text-threat" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-0.5 break-words text-sm text-mist">{message}</p>
          {action && (
            <button type="button" onClick={action.onClick} className={`mt-3 ${ACTION}`}>
              {action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
