// VUERIQ brand mark: a "V" whose arms converge on a focal point — the detail you came to see.
// The same geometry is used for the application icon (src-tauri/icons/vueriq.svg).

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" className={className} aria-hidden>
      <defs>
        <linearGradient id="vq-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1e25" />
          <stop offset="1" stopColor="#0b0c0f" />
        </linearGradient>
        <linearGradient id="vq-v" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b9c8ff" />
          <stop offset="1" stopColor="#5b7fff" />
        </linearGradient>
        <radialGradient id="vq-dot" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c9d5ff" />
        </radialGradient>
      </defs>
      <rect x="32" y="32" width="960" height="960" rx="224" fill="url(#vq-bg)" />
      <rect x="33.5" y="33.5" width="957" height="957" rx="222.5" fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="3" />
      <path d="M262 300 L512 770 L762 300" fill="none" stroke="url(#vq-v)" strokeWidth="112" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="512" cy="392" r="62" fill="url(#vq-dot)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className} style={{ fontFamily: "var(--font-display)", letterSpacing: "0.18em", fontWeight: 600 }}>
      VUERIQ
    </span>
  );
}
