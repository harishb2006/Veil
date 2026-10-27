// <Spinner className="h-4 w-4" />: inherits the current text colour.
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${className}`}
    />
  );
}
