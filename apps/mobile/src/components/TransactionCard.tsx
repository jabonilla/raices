import type { JSX } from "react";
import { StyleSheet, Text, View } from "react-native";

import { tokens } from "../theme/tokens";
import { StatusBadge, type TransactionStatus } from "./StatusBadge";

export type TransactionCategory =
  "housing" | "food" | "utilities" | "business" | "emergency" | "unrecognized";

/** The six category icons (design system 3.2). Never custom icons. */
const CATEGORY_ICON: Record<TransactionCategory, string> = {
  housing: "🏠",
  food: "🛒",
  utilities: "⚡",
  business: "💼",
  emergency: "🚨",
  unrecognized: "❓",
};

export type TransactionTier = "recurring" | "planned-investment" | "emergency" | "unrecognized";

export interface TransactionCardProps {
  readonly category: TransactionCategory;
  readonly categoryLabel: string;
  readonly status: TransactionStatus;
  /** Pre-formatted amount string, e.g. "$1,200.00". This component never
   * formats money (issue #12) — the caller owns formatting. */
  readonly amountText: string;
  readonly purpose: string;
  readonly timestamp: string;
  readonly tier?: TransactionTier;
  /** Planned-investment tier only, e.g. "Etapa 2 de 4". */
  readonly stageText?: string;
  readonly onPress?: () => void;
}

/**
 * Transaction card — the fundamental unit of the product (design system
 * 3.2). Who, what amount, what purpose, what status, at a glance.
 *
 * Tiers: recurring (Tierra Pale left border), planned-investment (gold left
 * border + stage), emergency (2px brick left border), unrecognized (flagged
 * left border, inset background).
 */
export function TransactionCard({
  category,
  categoryLabel,
  status,
  amountText,
  purpose,
  timestamp,
  tier = "recurring",
  stageText,
}: TransactionCardProps): JSX.Element {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${categoryLabel}, ${amountText}, ${purpose}`}
      style={[styles.card, tierStyles[tier]]}
    >
      <View style={styles.topRow}>
        <View style={styles.category}>
          <Text accessibilityLabel={`Categoría: ${categoryLabel}`} style={styles.icon}>
            {CATEGORY_ICON[category]}
          </Text>
          <Text style={styles.categoryLabel}>{categoryLabel}</Text>
        </View>
        <StatusBadge status={status} />
      </View>
      <Text style={styles.purpose}>{purpose}</Text>
      {tier === "planned-investment" && stageText !== undefined ? (
        <Text style={styles.stage}>{stageText}</Text>
      ) : null}
      <View style={styles.bottomRow}>
        <Text style={styles.amount}>{amountText}</Text>
        <Text style={styles.timestamp}>{timestamp}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.color.surface1,
    borderWidth: 1,
    borderColor: tokens.color.arena,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.s4,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: tokens.spacing.s3,
  },
  category: {
    flexDirection: "row",
    alignItems: "center",
  },
  icon: {
    // Category icons are specified at 20px — the type scale's 20px step.
    fontSize: tokens.type.heading2.size,
    marginRight: tokens.spacing.s2,
  },
  categoryLabel: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  purpose: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
    marginBottom: tokens.spacing.s3,
  },
  stage: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.pending,
    marginBottom: tokens.spacing.s2,
  },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  amount: {
    fontSize: tokens.type.amount.size,
    fontWeight: tokens.type.amount.weight,
    lineHeight: tokens.type.amount.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.roca,
    // Tabular numerals keep amounts aligned at any text scale.
    fontVariant: ["tabular-nums"],
  },
  timestamp: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMuted,
  },
});

const tierStyles = {
  recurring: {
    borderLeftWidth: 4,
    borderLeftColor: tokens.color.tierraPale,
  },
  "planned-investment": {
    borderLeftWidth: 4,
    borderLeftColor: tokens.color.oro,
  },
  emergency: {
    borderLeftWidth: 2,
    borderLeftColor: tokens.color.emergency,
  },
  unrecognized: {
    borderLeftWidth: 4,
    borderLeftColor: tokens.color.flagged,
    backgroundColor: tokens.color.surface2,
  },
};
