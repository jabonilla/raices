import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { Button } from "../components/Button";
import { RelationshipStatusBadge } from "../components/RelationshipStatusBadge";
import { ScreenState, type ScreenContentState } from "../components/ScreenState";
import { useScreenData } from "../data/ScreenDataContext";
import { tokens } from "../theme/tokens";
import {
  fullDaysRemaining,
  fullHoursRemaining,
  isInvitationExpired,
  shortDate,
} from "./relationshipExpiry";

/**
 * 06c · Detalle de persona — relationship detail (K2.27).
 *
 * - Status, phone, invitation date, and for invited relationships the time
 *   remaining before the 14-day expiry (P2.2). An expired invitation is
 *   visibly expired with a resend action, never a dead-looking screen.
 * - `displayName` is PII: rendered, never logged (asserted by test).
 * - No money on this screen: amounts are never part of the invite /
 *   relationship flow (issue #12).
 *
 * TODO(copy): relationships.resentOk is functional — the sheet specifies no
 * resend-confirmation wording. Listed in the PR for Claude (copy owner).
 */
export function RelationshipDetailScreen({
  relationshipId,
  screenState = "content",
  onBack,
}: {
  readonly relationshipId: string;
  readonly screenState?: ScreenContentState;
  readonly onBack?: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const screenData = useScreenData();
  const [resent, setResent] = useState(false);

  if (screenState === "loading" || screenState === "offline") {
    return <ScreenState kind={screenState} />;
  }
  if (screenState === "error") {
    return (
      <ScreenState
        kind="error"
        title={t("relationships.title")}
        body={t("states.errorBody")}
        primaryLabel={t("states.retry")}
        onPrimaryPress={() => {}}
      />
    );
  }

  const relationship = screenData
    .getRelationshipsData()
    .relationships.find((rel) => rel.id === relationshipId);

  if (relationship === undefined) {
    return (
      <ScreenState
        kind="error"
        title={t("relationships.title")}
        body={t("states.errorBody")}
        primaryLabel={t("states.retry")}
        onPrimaryPress={() => onBack?.()}
      />
    );
  }

  const expired =
    relationship.status === "invited" && isInvitationExpired(relationship.expiresAtISO);
  const days = fullDaysRemaining(relationship.expiresAtISO);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      {onBack !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("relationships.back")}
          onPress={onBack}
          style={styles.back}
        >
          <Text style={styles.backLabel}>
            {"< "}
            {t("relationships.back")}
          </Text>
        </Pressable>
      ) : null}
      <Text style={styles.name}>{relationship.displayName}</Text>
      <RelationshipStatusBadge status={relationship.status} />
      <View style={styles.rows}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t("relationships.phoneLabel")}</Text>
          <Text style={styles.rowValue}>{relationship.phoneE164}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t("relationships.statusRowLabel")}</Text>
          <Text style={styles.rowValue}>{t(`relationships.status.${relationship.status}`)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t("relationships.invitedLabel")}</Text>
          <Text style={styles.rowValue}>{shortDate(relationship.invitedAtISO)}</Text>
        </View>
      </View>
      {relationship.status === "invited" && !expired ? (
        <Text style={styles.countdown}>
          {days >= 1
            ? t("relationships.expiresInDays", { count: days })
            : t("relationships.expiresInHours", {
                count: fullHoursRemaining(relationship.expiresAtISO),
              })}
        </Text>
      ) : null}
      {expired ? (
        <View style={styles.expiredBox}>
          <Text style={styles.expiredLabel}>{t("relationships.expired")}</Text>
          {resent ? (
            <Text style={styles.resentOk}>{t("relationships.resentOk")}</Text>
          ) : (
            <Button
              variant="primary"
              label={t("relationships.resend")}
              onPress={() => {
                setResent(true);
              }}
              style={styles.resend}
            />
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: tokens.color.surface0,
  },
  content: {
    padding: tokens.spacing.s4,
  },
  back: {
    minHeight: tokens.touchTarget.min,
    justifyContent: "center",
    alignSelf: "flex-start",
    marginBottom: tokens.spacing.s2,
  },
  backLabel: {
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  name: {
    fontSize: tokens.type.heading1.size,
    fontWeight: tokens.type.heading1.weight,
    lineHeight: tokens.type.heading1.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
    marginBottom: tokens.spacing.s2,
  },
  rows: {
    marginTop: tokens.spacing.s4,
    backgroundColor: tokens.color.surface1,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: tokens.spacing.s4,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border,
  },
  rowLabel: {
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  rowValue: {
    fontSize: tokens.type.body.size,
    fontWeight: "500",
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  countdown: {
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.pending,
    marginTop: tokens.spacing.s4,
  },
  expiredBox: {
    marginTop: tokens.spacing.s4,
  },
  expiredLabel: {
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    fontFamily: tokens.font.body,
    color: tokens.color.flagged,
  },
  resentOk: {
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.approved,
    marginTop: tokens.spacing.s2,
  },
  resend: {
    marginTop: tokens.spacing.s3,
  },
});
