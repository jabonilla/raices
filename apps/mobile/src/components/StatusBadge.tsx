import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import "../i18n";
import { tokens } from "../theme/tokens";

export type TransactionStatus =
  "approved" | "pending" | "flagged" | "emergency" | "declined" | "failed";

/**
 * Status vocabulary (design system 3.2). Spanish is primary and intentional.
 * Never alarm language: flagged is warm brown, declined is neutral gray.
 * Copy lives in the locale files so the English fallback stays covered.
 */
const STATUS_KEYS: Record<TransactionStatus, string> = {
  approved: "statusBadge.approved",
  pending: "statusBadge.pending",
  flagged: "statusBadge.flagged",
  emergency: "statusBadge.emergency",
  declined: "statusBadge.declined",
  failed: "statusBadge.failed",
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
  const { t } = useTranslation();
  const colors = STATUS_COLORS[status];
  const label = t(STATUS_KEYS[status]);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={t("statusBadge.statusLabel", { status: label })}
      style={[styles.badge, { backgroundColor: colors.bg }]}
    >
      <Text style={[styles.text, { color: colors.fg }]}>{label}</Text>
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
