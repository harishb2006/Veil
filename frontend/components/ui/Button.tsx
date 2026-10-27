// <Button variant="primary|secondary|ghost" size="sm|md|lg" href="/lab">Label</Button>
// primary = solid ink, secondary = white with hairline border, ghost = text link style.
// With `href` it renders a Next <Link> (or a plain <a> for http/mailto); otherwise a <button type="button">.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-[#33333a]",
  secondary: "border border-line bg-hull text-ink hover:border-mist/50 hover:bg-panel",
  ghost: "text-mist hover:text-ink underline-offset-4 hover:underline",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-sm",
  md: "h-9 gap-2 rounded-md px-4 text-sm",
  lg: "h-11 gap-2 rounded-lg px-5 text-[15px]",
};

interface Common {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className = ""): string {
  return `inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${className}`;
}

export function Button(
  props: Common & ({ href: string } & Omit<ComponentProps<"a">, keyof Common | "href"> | ({ href?: undefined } & Omit<ComponentProps<"button">, keyof Common>)),
) {
  const { variant, size, className, children, href, ...rest } = props;
  const cls = buttonClasses(variant, size, className);
  if (href !== undefined) {
    const anchorProps = rest as Omit<ComponentProps<"a">, "href">;
    return /^(https?:|mailto:)/.test(href) ? (
      <a href={href} className={cls} target="_blank" rel="noreferrer" {...anchorProps}>
        {children}
      </a>
    ) : (
      <Link href={href} className={cls} {...anchorProps}>
        {children}
      </Link>
    );
  }
  const buttonProps = rest as ComponentProps<"button">;
  return (
    <button type="button" className={cls} {...buttonProps}>
      {children}
    </button>
  );
}
