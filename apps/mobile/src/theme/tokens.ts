// Placeholder design tokens. Real tokens arrive later (K2.3).
export const tokens = {
  color: {
    background: "#FFFFFF",
    text: "#111111",
    primary: "#0E8A16",
    muted: "#6B7280",
  },
  type: {
    size: {
      sm: 14,
      md: 16,
      lg: 20,
      xl: 28,
    },
    weight: {
      regular: "400",
      medium: "500",
      bold: "700",
    },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
} as const;

export type Tokens = typeof tokens;
