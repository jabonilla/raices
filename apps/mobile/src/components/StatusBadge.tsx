import type { JSX } from "react";
import { StyleSheet, Text, View } from "react-native";

import { tokens } from "../theme/tokens";

export type TransactionStatus =
  "approved" | "pending" | "flagged" | "emergency" | "declined" | "failed";

/**
 * Status vocabulary (design system 3.2). Spanish is primary and intentional.
 * Never alarm language: flagged is warm brown, declined is neutral gray.
 */
const STATUS_COPY: Record<TransactionStatus, string> = {
  approved: "✓ Enviado",
  pending: "Esperando",
  flagged: "Para revisar",
  emergency: "Urgente",
  declined: "En pausa",
  failed: "No llegó",
};

const STATUS_COLORS: Record<TransactionStatus, { fg: string; bg: string }> = {
  approved: { fg: tokens.color.approved, bg: tokens.color.approvedBg },
  pending: { fg: tokens.color.pending, bg: tokens.color.pendingBg },
  flagged: { fg: tokens.color.flagged, bg: tokens.color.flaggedBg },
  emergency: { fg: tokens.color.emergency, bg: tokens.color.emergencyBg },
  declined: { fg: tokens.color.declined, bg: tokens.color.declinedBg },
  failed: { fg: tokens.color.declined, bg: tokens.color.declinedBg },
};

export interface StatusBadgeProps {
  readonly status: TransactionStatus;
}

/**
 * Pill status badge for the top-right of transaction cards (design system
 * 3.2). Failed renders neutral gray — the explanation lives next to it,
 * not in the badge.
 */
export function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  const colors = STATUS_COLORS[status];
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Estado: ${STATUS_COPY[status]}`}
      style={[styles.badge, { backgroundColor: colors.bg }]}
    >
      <Text style={[styles.text, { color: colors.fg }]}>{STATUS_COPY[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.s3,
    paddingVertical: tokens.spacing.s1,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
  },
});
