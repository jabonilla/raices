import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { ScreenState, type ScreenContentState } from "../components/ScreenState";
import { useScreenData } from "../data/ScreenDataContext";
import { tokens } from "../theme/tokens";

// The back arrow is a presentational glyph, not localizable copy.
const BACK_ARROW = "←";

/**
 * 03 · Mi Meta — Figma "Raíces — MVP v0" (Tierra theme, 2026-09-30).
 *
 * Dark header with back affordance, title, and subtitle. The body leads
 * with the saved-so-far amount and a gold progress bar, then the Etapas
 * list: done stages get a tierra border and green check circle, the
 * current stage a gold border, future stages render at 50% opacity.
 *
 * The stage number lives in the circle; a leading "N " in the record name
 * is stripped for display so it isn't announced twice.
 *
 * `screenState` renders the loading / empty / error / offline shells (K2.21).
 * Empty copy is DS §13.4 verbatim.
 * TODO(copy): goal.states.errorTitle is invented; the English translations
 * are draft. Listed in the PR for Claude (copy owner).
 */
export function GoalScreen({
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
        title={t("goal.states.emptyTitle")}
        body={t("goal.states.emptyBody")}
        primaryLabel={t("goal.states.emptyAction")}
        onPrimaryPress={() => {}}
      />
    );
  }
  if (screenState === "error") {
    return (
      <ScreenState
        kind="error"
        title={t("goal.states.errorTitle")}
        body={t("states.errorBody")}
        primaryLabel={t("states.retry")}
        onPrimaryPress={() => {}}
        secondaryLabel={t("states.askAi")}
        onSecondaryPress={() => {}}
      />
    );
  }
  const data = screenData.getGoalData();
  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          onPress={() => {}}
          style={styles.backHit}
        >
          <Text aria-hidden style={styles.backArrow}>
            {BACK_ARROW}
          </Text>
        </Pressable>
        <Text style={styles.title}>{data.title}</Text>
        <Text style={styles.subtitle}>{data.subtitle}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.savedLabel}>{t("goal.savedSoFar")}</Text>
        <Text style={styles.savedAmount}>{data.savedAmountText}</Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width:
                  // Percent is a bounded 0-100 number; RN DimensionValue accepts `${number}%`.
                  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                  `${data.progressPercent}%`,
              },
            ]}
          />
        </View>
        <Text style={styles.remaining}>
          {t("goal.remaining", {
            remaining: data.remainingAmountText,
            total: data.totalAmountText,
          })}
        </Text>

        <Text style={styles.stagesTitle}>{t("goal.stages")}</Text>
        {data.stages.map((stage, index) => (
          <Stage
            key={`${stage.name}-${String(index)}`}
            number={index + 1}
            done={stage.done}
            upcoming={stage.upcoming}
            name={stage.name}
            detail={stage.detail}
            {...(stage.meta !== undefined ? { meta: stage.meta } : {})}
            {...(stage.badge !== undefined ? { badge: stage.badge } : {})}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Stage({
  number,
  name,
  detail,
  meta,
  badge,
  done = false,
  upcoming = false,
}: {
  readonly number: number;
  readonly name: string;
  readonly detail: string;
  readonly meta?: string;
  readonly badge?: string;
  readonly done?: boolean;
  readonly upcoming?: boolean;
}): JSX.Element {
  // The circle already shows the stage number — strip a leading "N " from
  // the record name so it isn't repeated (presentational only).
  const displayName = name.replace(/^\d+\s+/, "");
  return (
    <View
      style={[
        styles.stage,
        done && styles.stageDone,
        !done && !upcoming && styles.stageCurrent,
        upcoming && styles.stageUpcoming,
      ]}
    >
      <View
        style={[
          styles.stageCircle,
          done && styles.stageCircleDone,
          !done && !upcoming && styles.stageCircleCurrent,
        ]}
      >
        <Text aria-hidden style={[styles.stageNumber, done && styles.stageNumberDone]}>
          {done ? "✓" : String(number)}
        </Text>
      </View>
      <View style={styles.stageInfo}>
        <View style={styles.stageTop}>
          <Text style={styles.stageName}>{displayName}</Text>
          {badge !== undefined ? (
            <View style={[styles.badge, done ? styles.badgeDone : styles.badgeCurrent]}>
              <Text
                style={[styles.badgeText, done ? styles.badgeTextDone : styles.badgeTextCurrent]}
              >
                {badge}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.stageDetail}>{detail}</Text>
        {meta !== undefined ? <Text style={styles.stageMeta}>{meta}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: tokens.color.surface0,
  },
  header: {
    backgroundColor: tokens.color.roca,
    paddingHorizontal: tokens.spacing.s5,
    paddingTop: tokens.spacing.s12,
    paddingBottom: tokens.spacing.s5,
  },
  backHit: {
    minHeight: tokens.touchTarget.min,
    minWidth: tokens.touchTarget.min,
    justifyContent: "center",
    alignSelf: "flex-start",
    marginLeft: tokens.spacing.s1 * -1,
    marginBottom: tokens.spacing.s2,
  },
  backArrow: {
    fontSize: tokens.type.heading2.size,
    color: tokens.color.textInverse,
  },
  title: {
    fontSize: tokens.type.display.size,
    fontWeight: tokens.type.display.weight,
    lineHeight: tokens.type.display.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textInverse,
  },
  subtitle: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMuted,
    marginTop: tokens.spacing.s1,
  },
  content: {
    padding: tokens.spacing.s5,
    paddingBottom: tokens.spacing.s10,
  },
  savedLabel: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  savedAmount: {
    fontSize: 48,
    fontWeight: tokens.type.amountLarge.weight,
    lineHeight: 52,
    fontFamily: tokens.font.display,
    color: tokens.color.roca,
    fontVariant: ["tabular-nums"],
    marginVertical: tokens.spacing.s2,
  },
  progressTrack: {
    height: 6,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.arena,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: tokens.color.oro,
    borderRadius: tokens.radius.full,
  },
  remaining: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.spacing.s2,
  },
  stagesTitle: {
    fontSize: tokens.type.heading2.size,
    fontWeight: tokens.type.heading2.weight,
    lineHeight: tokens.type.heading2.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
    marginTop: tokens.spacing.s6,
    marginBottom: tokens.spacing.s3,
  },
  stage: {
    flexDirection: "row",
    backgroundColor: tokens.color.surface1,
    borderWidth: 1,
    borderColor: tokens.color.arena,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.s4,
    marginBottom: tokens.spacing.s3,
  },
  stageDone: {
    borderColor: tokens.color.tierra,
  },
  stageCurrent: {
    borderColor: tokens.color.oro,
  },
  stageUpcoming: {
    opacity: 0.5,
  },
  stageCircle: {
    width: 32,
    height: 32,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.surface2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: tokens.spacing.s3,
  },
  stageCircleDone: {
    backgroundColor: tokens.color.approvedBg,
  },
  stageCircleCurrent: {
    backgroundColor: tokens.color.crema,
  },
  stageNumber: {
    fontSize: tokens.type.body.size,
    fontWeight: "600",
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  stageNumberDone: {
    color: tokens.color.approved,
  },
  stageInfo: {
    flex: 1,
  },
  stageTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacing.s2,
  },
  stageName: {
    flex: 1,
    fontSize: tokens.type.heading3.size,
    fontWeight: tokens.type.heading3.weight,
    lineHeight: tokens.type.heading3.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
  },
  badge: {
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.s3,
    paddingVertical: tokens.spacing.s1,
  },
  badgeDone: {
    backgroundColor: tokens.color.approvedBg,
  },
  badgeCurrent: {
    backgroundColor: tokens.color.crema,
  },
  badgeText: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
  },
  badgeTextDone: {
    color: tokens.color.approved,
  },
  badgeTextCurrent: {
    color: tokens.color.flagged,
  },
  stageDetail: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
    fontVariant: ["tabular-nums"],
    marginTop: tokens.spacing.s1,
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
