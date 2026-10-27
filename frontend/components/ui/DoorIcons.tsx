// Brand and door icons. <LogoMark/> is the Airlock mark (keep in sync with app/icon.svg).
// <OuterDoorIcon/>, <InnerDoorIcon/>, <GateIcon/>: take className and inherit currentColor.
type IconProps = { className?: string };

function Svg({ className = "h-5 w-5", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

export function LogoMark({ className = "h-6 w-6" }: IconProps) {
  // Two vertical doors with a gap between them; ink only.
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="2.5" y="3.5" width="19" height="17" rx="3" stroke="#18181b" strokeWidth="1.5" />
      <path d="M9 3.5v17M15 3.5v17" stroke="#18181b" strokeWidth="1.5" />
      <rect x="9.75" y="9.5" width="4.5" height="5" fill="#18181b" opacity="0.14" />
    </svg>
  );
}

// Outer door: a door with an eye-slit, it looks at everything arriving.
export const OuterDoorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21" />
    <path d="M3 21h18" />
    <path d="M9 10.5c1-1.4 2-2 3-2s2 .6 3 2c-1 1.4-2 2-3 2s-2-.6-3-2z" />
    <circle cx="12" cy="10.5" r=".6" fill="currentColor" />
    <circle cx="15.5" cy="16.5" r=".8" fill="currentColor" />
  </Svg>
);

// Inner door: a door with a keyhole, it protects what is inside.
export const InnerDoorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21" />
    <path d="M3 21h18" />
    <circle cx="12" cy="10" r="1.7" />
    <path d="M12 11.7V15" />
    <circle cx="15.5" cy="16.5" r=".8" fill="currentColor" />
  </Svg>
);

// The gate: a check-point ring between the doors.
export const GateIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 21V8m16 13V8" />
    <path d="M4 8c0-3 3.6-5 8-5s8 2 8 5" />
    <path d="M4 13h16" />
    <path d="m9.5 17 1.8 1.8L15 15" />
  </Svg>
);
