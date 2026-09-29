import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { Button } from "../components/Button";
import { tokens } from "../theme/tokens";

/**
 * 02 · Aprobación — bottom sheet shell. The highest-frequency critical
 * interaction: must complete in under 60 seconds, no scrolling for the core
 * decision. "Ahorita no" is a text link, never a button.
 */

// Copy sheet specifies 🛒 as the Comida category icon (like TransactionCard's
// CATEGORY_ICON — icons are presentational, not localizable copy).
const CATEGORY_ICON = "🛒";

export function ApprovalScreen(): JSX.Element {
  const { t } = useTranslation();
  const amount = t("approval.amount");
  return (
    <View style={styles.sheet}>
      <View style={styles.handle} />
      <Text style={styles.recipient}>{t("approval.recipientName")}</Text>
      <Text style={styles.relationship}>{t("approval.relationship")}</Text>

      <View style={styles.divider} />

      <View style={styles.categoryRow}>
        <Text style={styles.categoryIcon}>{CATEGORY_ICON}</Text>
        <Text style={styles.categoryLabel}>{t("approval.category")}</Text>
      </View>
      <Text style={styles.purpose}>{t("approval.purpose")}</Text>
      <Text style={styles.amount}>{amount}</Text>

      <View style={styles.divider} />

      <Text style={styles.planMatch}>{t("approval.planMatch")}</Text>
      <Text style={styles.planDetail}>
        {t("approval.planMatchDetail", {
          available: "$105",
          category: t("approval.category"),
        })}
      </Text>

      <View style={styles.divider} />

      <Button
        variant="primary"
        label={t("approval.approve", { amount })}
        onPress={() => {}}
        style={styles.approve}
      />
      {/*
        Copy sheet: "Ahorita no" is a text link, never a button. Rendered as a
        Pressable with link styling and accessibilityRole="link".
      */}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t("approval.decline")}
        onPress={() => {}}
        style={styles.declineLink}
      >
        <Text style={styles.declineText}>{t("approval.decline")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: tokens.color.surface1,
    borderTopLeftRadius: tokens.radius.xl,
    borderTopRightRadius: tokens.radius.xl,
    padding: tokens.spacing.s6,
    paddingBottom: tokens.spacing.s10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.borderStrong,
    alignSelf: "center",
    marginBottom: tokens.spacing.s4,
  },
  recipient: {
    fontSize: tokens.type.heading1.size,
    fontWeight: tokens.type.heading1.weight,
    lineHeight: tokens.type.heading1.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
    textAlign: "center",
  },
  relationship: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    textAlign: "center",
    marginTop: tokens.spacing.s1,
  },
  divider: {
    height: 1,
    backgroundColor: tokens.color.arena,
    marginVertical: tokens.spacing.s4,
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  categoryIcon: {
    fontSize: tokens.type.heading2.size,
    marginRight: tokens.spacing.s2,
  },
  categoryLabel: {
    fontSize: tokens.type.bodyLarge.size,
    fontWeight: tokens.type.bodyLarge.weight,
    lineHeight: tokens.type.bodyLarge.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  purpose: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    textAlign: "center",
    fontStyle: "italic",
    marginTop: tokens.spacing.s2,
  },
  amount: {
    fontSize: tokens.type.amountLarge.size,
    fontWeight: tokens.type.amountLarge.weight,
    lineHeight: tokens.type.amountLarge.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.roca,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    marginTop: tokens.spacing.s3,
  },
  planMatch: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.approved,
    textAlign: "center",
  },
  planDetail: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    textAlign: "center",
    marginTop: tokens.spacing.s1,
  },
  approve: {
    width: "100%",
    marginBottom: tokens.spacing.s2,
  },
  declineLink: {
    alignSelf: "center",
    paddingVertical: tokens.spacing.s3,
    minHeight: tokens.touchTarget.min,
    justifyContent: "center",
  },
  declineText: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    textDecorationLine: "underline",
  },
});
