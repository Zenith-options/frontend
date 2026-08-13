export function Logo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <polygon points="10,2 18,18 2,18" stroke="var(--brand)" strokeWidth="1.5" fill="var(--brand-dim)" strokeLinejoin="round" />
      <polygon points="10,7 14.5,16 5.5,16" fill="var(--brand)" opacity="0.5" />
    </svg>
  );
}
