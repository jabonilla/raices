import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { Button } from "../components/Button";
import { ScreenState, type ScreenContentState } from "../components/ScreenState";
import { useScreenData } from "../data/ScreenDataContext";
import { tokens } from "../theme/tokens";

/**
 * 02 · Aprobación — Figma "Raíces — MVP v0" (Tierra theme, 2026-09-30).
 * Bottom sheet: the highest-frequency critical interaction must complete in
 * under 60 seconds, no scrolling for the core decision. "Ahorita no" is a
 * text link, never a button.
 *
 * Recipient row carries the avatar initial; the plan match renders as a
 * green assurance box, not plain text.
 *
 * `screenState` renders the loading / empty / error / offline shells (K2.21).
 * The empty state ("nothing waiting") carries no action — one path forward
 * only, and here there is nothing to do (cf. DS §13.4 notifications row).
 * TODO(copy): approval.states.* are invented/adapted — the copy sheet and the
 * DS specify no empty or error copy for Aprobación. Listed in the PR for
 * Claude (copy owner).
 */

// Copy sheet specifies 🛒 as the Comida category icon (like TransactionCard's
// CATEGORY_ICON — icons are presentational, not localizable copy).
const CATEGORY_ICON = "🛒";

export function ApprovalScreen({
  screenState = "content",
}: {
  readonly screenState?: ScreenContentState;
}): JSX.Element {
  const { t } = useTranslation();
  const screenData = useScreenData();
  if (screenState === "loading" || screenState === "offline") {
    return <ScreenState kind={screenState} />;
  }
  if (screenState === "empty") {
    return (
      <ScreenState
        kind="empty"
        title={t("approval.states.emptyTitle")}
        body={t("approval.states.emptyBody")}
      />
    );
  }
  if (screenState === "error") {
    return (
      <ScreenState
        kind="error"
        title={t("approval.states.errorTitle")}
        body={t("states.errorBody")}
        primaryLabel={t("states.retry")}
        onPrimaryPress={() => {}}
        secondaryLabel={t("states.askAi")}
        onSecondaryPress={() => {}}
      />
    );
  }
  const data = screenData.getApprovalData();
  const amount = data.amountText;
  // Avatar initial is presentational, derived from the record name.
  const initial = data.recipientName.charAt(0).toUpperCase();
  return (
    <View style={styles.sheet}>
      <View style={styles.handle} />

      <View style={styles.recipientRow}>
        <View style={styles.avatar}>
          <Text aria-hidden style={styles.avatarInitial}>
            {initial}
          </Text>
        </View>
        <View>
          <Text style={styles.recipient}>{data.recipientName}</Text>
          <Text style={styles.relationship}>{data.relationship}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.categoryRow}>
        <Text aria-hidden style={styles.categoryIcon}>
          {CATEGORY_ICON}
        </Text>
        <Text style={styles.categoryLabel}>{data.categoryLabel}</Text>
      </View>
      <Text style={styles.purpose}>{data.purpose}</Text>
      <Text style={styles.amount}>{amount}</Text>

      <View style={styles.divider} />

      <View style={styles.planBox}>
        {/*
          planMatchText arrives with its own "✓" from the provider (and the
          test asserts that exact string), so no separate icon here.
        */}
        <View style={styles.planText}>
          <Text style={styles.planMatch}>{data.planMatchText}</Text>
          <Text style={styles.planDetail}>
            {t("approval.planMatchDetail", {
              available: data.planAvailableText,
              category: data.categoryLabel,
            })}
          </Text>
        </View>
      </View>

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
    marginBottom: tokens.spacing.s5,
  },
  recipientRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.approvedBg,
    alignItems: "center",
    justifyContent: "center",
    marginRight: tokens.spacing.s3,
  },
  avatarInitial: {
    fontSize: tokens.type.heading2.size,
    fontWeight: tokens.type.heading2.weight,
    lineHeight: tokens.type.heading2.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.approved,
  },
  recipient: {
    fontSize: tokens.type.heading2.size,
    fontWeight: tokens.type.heading2.weight,
    lineHeight: tokens.type.heading2.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
  },
  relationship: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMuted,
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
    fontSize: tokens.type.bodyLarge.size,
    fontWeight: tokens.type.bodyLarge.weight,
    lineHeight: tokens.type.bodyLarge.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
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
    marginTop: tokens.spacing.s3,
  },
  planBox: {
    backgroundColor: tokens.color.approvedBg,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.s4,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: tokens.spacing.s4,
  },
  planText: {
    flex: 1,
  },
  planMatch: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.approved,
  },
  planDetail: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.approved,
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
