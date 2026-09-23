import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { Card } from "../components/Card";
import { tokens } from "../theme/tokens";

/**
 * 03 · Mi Meta — static shell. Progress bars: tierra fill on arena track;
 * completed categories get a gold check; over-budget turns flagged.
 * Future stages render at 50% opacity.
 */
export function GoalScreen(): JSX.Element {
  const { t } = useTranslation();
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("goal.title")}</Text>
      <Text style={styles.subtitle}>{t("goal.subtitle")}</Text>

      <Card style={styles.summary}>
        <Text style={styles.savedLabel}>{t("goal.savedSoFar")}</Text>
        <Text style={styles.savedAmount}>{t("goal.savedAmount")}</Text>
        <View style={styles.progressTrack}>
          <View style={styles.progressFill} />
        </View>
        <Text style={styles.remaining}>
          {t("goal.remaining", {
            remaining: t("goal.remainingAmount"),
            total: t("goal.totalAmount"),
          })}
        </Text>
      </Card>

      <Stage
        done
        name={t("goal.stage1")}
        detail={t("goal.stage1Amount")}
        meta={t("goal.stage1Date")}
        badge={t("goal.stage1Badge")}
      />
      <Stage
        name={`2 ${t("goal.stage2")}`}
        detail={t("goal.ofStage", {
          done: t("goal.stage2Done"),
          total: t("goal.stage2Total"),
        })}
        meta={t("goal.stage2Note")}
        badge={t("goal.stage2Badge")}
      />
      <Stage
        upcoming
        name={`3 ${t("goal.stage3")}`}
        detail={t("goal.stage3Amount")}
        meta={t("goal.stage3Note")}
      />
      <Stage upcoming name={`4 ${t("goal.stage4")}`} detail={t("goal.stage4Amount")} />
    </ScrollView>
  );
}

function Stage({
  name,
  detail,
  meta,
  badge,
  done = false,
  upcoming = false,
}: {
  readonly name: string;
  readonly detail: string;
  readonly meta?: string;
  readonly badge?: string;
  readonly done?: boolean;
  readonly upcoming?: boolean;
}): JSX.Element {
  return (
    <View style={[styles.stage, upcoming && styles.stageUpcoming]}>
      <View style={styles.stageTop}>
        <Text style={styles.stageName}>
          {done ? "✓ " : ""}
          {name}
        </Text>
        {badge !== undefined ? (
          <Text style={[styles.badge, done && styles.badgeDone]}>{badge}</Text>
        ) : null}
      </View>
      <Text style={styles.stageDetail}>{detail}</Text>
      {meta !== undefined ? <Text style={styles.stageMeta}>{meta}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: tokens.color.surface0,
  },
  content: {
    padding: tokens.spacing.s4,
    paddingBottom: tokens.spacing.s10,
  },
  title: {
    fontSize: tokens.type.heading1.size,
    fontWeight: tokens.type.heading1.weight,
    lineHeight: tokens.type.heading1.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
  },
  subtitle: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.spacing.s1,
    marginBottom: tokens.spacing.s4,
  },
  summary: {
    marginBottom: tokens.spacing.s4,
  },
  savedLabel: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  savedAmount: {
    fontSize: tokens.type.amountLarge.size,
    fontWeight: tokens.type.amountLarge.weight,
    lineHeight: tokens.type.amountLarge.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.roca,
    fontVariant: ["tabular-nums"],
    marginVertical: tokens.spacing.s2,
  },
  progressTrack: {
    height: 8,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.arena,
    overflow: "hidden",
  },
  progressFill: {
    width: "56%",
    height: "100%",
    backgroundColor: tokens.color.tierra,
    borderRadius: tokens.radius.full,
  },
  remaining: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
    marginTop: tokens.spacing.s3,
  },
  stage: {
    backgroundColor: tokens.color.surface1,
    borderWidth: 1,
    borderColor: tokens.color.arena,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.s4,
    marginBottom: tokens.spacing.s3,
  },
  stageUpcoming: {
    opacity: 0.5,
  },
  stageTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stageName: {
    fontSize: tokens.type.heading3.size,
    fontWeight: tokens.type.heading3.weight,
    lineHeight: tokens.type.heading3.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
    flex: 1,
  },
  badge: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.pending,
    backgroundColor: tokens.color.pendingBg,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.s3,
    paddingVertical: tokens.spacing.s1,
    overflow: "hidden",
  },
  badgeDone: {
    color: tokens.color.approved,
    backgroundColor: tokens.color.approvedBg,
  },
  stageDetail: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
    fontVariant: ["tabular-nums"],
    marginTop: tokens.spacing.s2,
  },
  stageMeta: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMuted,
    marginTop: tokens.spacing.s1,
  },
});
