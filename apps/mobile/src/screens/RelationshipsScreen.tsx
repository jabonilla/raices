import type { TFunction } from "i18next";
import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { Button } from "../components/Button";
import { RelationshipStatusBadge } from "../components/RelationshipStatusBadge";
import { ScreenState, type ScreenContentState } from "../components/ScreenState";
import { useScreenData } from "../data/ScreenDataContext";
import type { RelationshipItem } from "../data/types";
import { tokens } from "../theme/tokens";
import { fullDaysRemaining, fullHoursRemaining, isInvitationExpired } from "./relationshipExpiry";

/**
 * 06b · Personas — relationship list (K2.27).
 *
 * - Every relationship this sender holds, with its P2.2 status. An invited
 *   relationship shows the time remaining before the 14-day expiry; an
 *   expired invitation is visibly expired with a resend action, never a
 *   dead-looking row.
 * - One person may appear in several relationships (the fixture has "Mamá"
 *   twice): rows are keyed by relationship id, and the UI never assumes one
 *   sender per recipient.
 * - `displayName` is PII: rendered, never logged (asserted by test).
 * - Resend is fixture-local: it marks the row resent and shows a transient
 *   confirmation. No API calls (K2.24 contract).
 *
 * TODO(copy): relationships.resentOk is functional — the sheet specifies no
 * resend-confirmation wording. Listed in the PR for Claude (copy owner).
 */
export function RelationshipsScreen({
  screenState = "content",
  onSelectRelationship,
  onInvite,
}: {
  readonly screenState?: ScreenContentState;
  readonly onSelectRelationship?: (id: string) => void;
  readonly onInvite?: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const screenData = useScreenData();
  const [resentIds, setResentIds] = useState<readonly string[]>([]);

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

  // TODO(copy): relationships.emptyBody is functional — the sheet specifies
  // no empty-list copy.
  if (screenState === "empty") {
    return (
      <ScreenState
        kind="empty"
        title={t("relationships.title")}
        body={t("relationships.emptyBody")}
        primaryLabel={t("relationships.inviteAction")}
        onPrimaryPress={() => onInvite?.()}
      />
    );
  }

  const data = screenData.getRelationshipsData();
  if (data.relationships.length === 0) {
    return (
      <ScreenState
        kind="empty"
        title={t("relationships.title")}
        body={t("relationships.emptyBody")}
        primaryLabel={t("relationships.inviteAction")}
        onPrimaryPress={() => onInvite?.()}
      />
    );
  }

  function resend(id: string): void {
    setResentIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("relationships.title")}</Text>
      </View>
      {data.relationships.map((rel) => (
        <RelationshipRow
          key={rel.id}
          relationship={rel}
          resent={resentIds.includes(rel.id)}
          onResend={() => {
            resend(rel.id);
          }}
          onSelect={() => {
            onSelectRelationship?.(rel.id);
          }}
        />
      ))}
      <Button
        variant="primary"
        label={t("relationships.inviteAction")}
        onPress={() => onInvite?.()}
        style={styles.invite}
      />
    </ScrollView>
  );
}

function RelationshipRow({
  relationship,
  resent,
  onResend,
  onSelect,
}: {
  readonly relationship: RelationshipItem;
  readonly resent: boolean;
  readonly onResend: () => void;
  readonly onSelect: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const expired =
    relationship.status === "invited" && isInvitationExpired(relationship.expiresAtISO);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${relationship.displayName}, ${t(`relationships.status.${relationship.status}`)}`}
      onPress={onSelect}
      style={styles.row}
    >
      <View style={styles.rowTop}>
        <Text style={styles.name} numberOfLines={1}>
          {relationship.displayName}
        </Text>
        <RelationshipStatusBadge status={relationship.status} />
      </View>
      <Text style={styles.phone}>{relationship.phoneE164}</Text>
      {relationship.status === "invited" && !expired ? (
        <Text style={styles.countdown}>{countdownText(relationship.expiresAtISO, t)}</Text>
      ) : null}
      {expired ? (
        <View style={styles.expiredBox}>
          <Text style={styles.expiredLabel}>{t("relationships.expired")}</Text>
          {resent ? (
            <Text style={styles.resentOk}>{t("relationships.resentOk")}</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("relationships.resend")}
              onPress={onResend}
              style={styles.resendButton}
            >
              <Text style={styles.resendLabel}>{t("relationships.resend")}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </Pressable>
  );
}

function countdownText(expiresAtISO: string, t: TFunction): string {
  const days = fullDaysRemaining(expiresAtISO);
  if (days >= 1) {
    return t("relationships.expiresInDays", { count: days });
  }
  return t("relationships.expiresInHours", { count: fullHoursRemaining(expiresAtISO) });
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: tokens.color.surface0,
  },
  content: {
    padding: tokens.spacing.s4,
  },
  header: {
    marginBottom: tokens.spacing.s4,
  },
  title: {
    fontSize: tokens.type.heading1.size,
    fontWeight: tokens.type.heading1.weight,
    lineHeight: tokens.type.heading1.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
  },
  row: {
    backgroundColor: tokens.color.surface1,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.s4,
    marginBottom: tokens.spacing.s3,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacing.s2,
  },
  name: {
    flex: 1,
    fontSize: tokens.type.heading3.size,
    fontWeight: tokens.type.heading3.weight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  phone: {
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.spacing.s1,
  },
  countdown: {
    fontSize: tokens.type.bodySmall.size,
    fontFamily: tokens.font.body,
    color: tokens.color.pending,
    marginTop: tokens.spacing.s2,
  },
  expiredBox: {
    marginTop: tokens.spacing.s2,
    paddingTop: tokens.spacing.s2,
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
  },
  expiredLabel: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: "600",
    fontFamily: tokens.font.body,
    color: tokens.color.flagged,
  },
  resentOk: {
    fontSize: tokens.type.bodySmall.size,
    fontFamily: tokens.font.body,
    color: tokens.color.approved,
    marginTop: tokens.spacing.s1,
  },
  resendButton: {
    marginTop: tokens.spacing.s2,
    minHeight: tokens.touchTarget.min,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: tokens.spacing.s4,
    borderWidth: 1,
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.surface1,
  },
  resendLabel: {
    fontSize: tokens.type.body.size,
    fontWeight: "500",
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  invite: {
    marginTop: tokens.spacing.s3,
  },
});
