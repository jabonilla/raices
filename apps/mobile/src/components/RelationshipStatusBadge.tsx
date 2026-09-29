import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import "../i18n";
import { tokens } from "../theme/tokens";
import type { RelationshipStatus } from "../data/types";

/**
 * Relationship status badge (K2.27). Design system 3.2 vocabulary, extended
 * for the P2.2 relationship lifecycle:
 * - invited: gold, waiting on the recipient (like transaction pending)
 * - active: green, money can move
 * - paused: neutral gray, nothing alarming
 * - terminated: neutral gray, final — the explanation lives next to it
 *
 * Copy lives in the locale files (`relationships.status.*`).
 */
const STATUS_KEYS: Record<RelationshipStatus, string> = {
  invited: "relationships.status.invited",
  active: "relationships.status.active",
  paused: "relationships.status.paused",
  terminated: "relationships.status.terminated",
};

const STATUS_COLORS: Record<RelationshipStatus, { fg: string; bg: string }> = {
  invited: { fg: tokens.color.pending, bg: tokens.color.pendingBg },
  active: { fg: tokens.color.approved, bg: tokens.color.approvedBg },
  paused: { fg: tokens.color.declined, bg: tokens.color.declinedBg },
  terminated: { fg: tokens.color.declined, bg: tokens.color.declinedBg },
};

export interface RelationshipStatusBadgeProps {
  readonly status: RelationshipStatus;
}

/**
 * Pill badge for relationship rows and the detail screen. Expired
 * invitations are NOT a badge state: an expired invite renders as its own
 * visibly-expired row with a resend action (K2.27), never a dead-looking
 * badge.
 */
export function RelationshipStatusBadge({ status }: RelationshipStatusBadgeProps): JSX.Element {
  const { t } = useTranslation();
  const colors = STATUS_COLORS[status];
  const label = t(STATUS_KEYS[status]);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={t("relationships.statusLabel", { status: label })}
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
