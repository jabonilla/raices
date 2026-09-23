// Design tokens — single source of truth (docs/design-system.md v1.0).
// Every color, type size, spacing value, and radius in a component must come
// from here. A test fails on any hardcoded color or font size in a component.

export const tokens = {
  color: {
    // Primary palette
    tierra: "#2D4A3E",
    tierraLight: "#3D6355",
    tierraPale: "#EAF2EE",
    oro: "#C4922A",
    oroLight: "#F5E4BF",
    roca: "#1A1A1A",
    niebla: "#F7F6F3",
    arena: "#EDEDEA",
    // Semantic states
    approved: "#2D4A3E",
    approvedBg: "#EAF2EE",
    pending: "#C4922A",
    pendingBg: "#F5E4BF",
    flagged: "#8B4513",
    flaggedBg: "#F5EDE8",
    emergency: "#B5451B",
    emergencyBg: "#FAECEA",
    declined: "#6B6B6B",
    declinedBg: "#F0F0EE",
    // Neutrals
    textPrimary: "#1A1A1A",
    textSecondary: "#4A4A4A",
    textMuted: "#888885",
    textInverse: "#FFFFFF",
    surface0: "#F7F6F3",
    surface1: "#FFFFFF",
    surface2: "#F2F1EE",
    border: "#E8E7E3",
    borderStrong: "#D4D3CF",
  },
  font: {
    display: "'Plus Jakarta Sans', system-ui, sans-serif",
    body: "'Inter', system-ui, sans-serif",
  },
  type: {
    display: { size: 32, weight: "600", lineHeight: 38 },
    heading1: { size: 24, weight: "600", lineHeight: 31 },
    heading2: { size: 20, weight: "600", lineHeight: 27 },
    heading3: { size: 17, weight: "500", lineHeight: 24 },
    bodyLarge: { size: 16, weight: "400", lineHeight: 26 },
    body: { size: 15, weight: "400", lineHeight: 24 },
    bodySmall: { size: 13, weight: "400", lineHeight: 20 },
    label: { size: 12, weight: "500", lineHeight: 17 },
    // Money amounts: tabular numerals, dedicated scale. Components receive
    // amounts as pre-formatted strings — never format money here (issue #12).
    amount: { size: 28, weight: "600", lineHeight: 31 },
    amountLarge: { size: 40, weight: "600", lineHeight: 40 },
  },
  spacing: {
    s1: 4,
    s2: 8,
    s3: 12,
    s4: 16,
    s5: 20,
    s6: 24,
    s8: 32,
    s10: 40,
    s12: 48,
    s16: 64,
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
    xl: 20,
    full: 9999,
  },
  // Minimal elevation: cards are flat with borders by default.
  shadow: {
    none: "none",
    card: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
    sheet: "0 -4px 24px rgba(0,0,0,0.08), 0 -1px 8px rgba(0,0,0,0.04)",
    modal: "0 20px 60px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)",
  },
  motion: {
    fast: 120,
    base: 200,
    slow: 320,
    celebration: 600,
  },
  // Accessibility baseline (K2.7): minimum 44x44pt touch target for every
  // interactive element (Apple HIG / WCAG 2.5.8). Text scales with the OS
  // font-size setting by default — never set allowFontScaling={false}.
  touchTarget: {
    min: 44,
  },
} as const;

export type Tokens = typeof tokens;
