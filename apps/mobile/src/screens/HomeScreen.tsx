import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { Card } from "../components/Card";
import { ScreenState, type ScreenContentState } from "../components/ScreenState";
import { TransactionCard } from "../components/TransactionCard";
import { useScreenData } from "../data/ScreenDataContext";
import { tokens } from "../theme/tokens";

// The pending pill's arrow is a presentational glyph (like TransactionCard's
// CATEGORY_ICON) — icons are presentational, not localizable copy.
const PENDING_ARROW = "→";

/**
 * 01 · Inicio — Figma "Raíces — MVP v0" (Tierra theme, 2026-09-30).
 *
 * Dark tierra header carries the greeting, date, and the Aquí/Allá balance
 * cards; the body holds the cream pending pill, the goal card with its
 * "Etapa N de M" badge and gold progress bar, and recent activity.
 *
 * Data comes from the ScreenDataProvider (K2.24) via `useScreenData()` —
 * never from i18n. Amounts arrive as preformatted opaque strings and pass
 * through verbatim (issue #12).
 *
 * `screenState` renders the loading / empty / error / offline shells (K2.21).
 * TODO(copy): home.states.* are invented — the copy sheet and the DS specify
 * no empty or error copy for Inicio. Listed in the PR for Claude (copy owner).
 */
export function HomeScreen({
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
        title={t("home.states.emptyTitle")}
        body={t("home.states.emptyBody")}
        primaryLabel={t("common.sendNow")}
        onPrimaryPress={() => {}}
      />
    );
  }
  if (screenState === "error") {
    return (
      <ScreenState
        kind="error"
        title={t("home.states.errorTitle")}
        body={t("states.errorBody")}
        primaryLabel={t("states.retry")}
        onPrimaryPress={() => {}}
        secondaryLabel={t("states.askAi")}
        onSecondaryPress={() => {}}
      />
    );
  }
  const data = screenData.getHomeData();
  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.greeting}>{t("home.greeting", { name: data.greetingName })}</Text>
        <Text style={styles.date}>{data.dateText}</Text>

        <View style={styles.balanceRow}>
          {data.balances.map((balance) => (
            <View key={balance.label} accessibilityLabel={balance.label} style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>{balance.label}</Text>
              <Text style={styles.balanceAmount}>{balance.amountText}</Text>
              <Text style={styles.balanceSub}>{balance.sub}</Text>
            </View>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("home.pendingPill", { count: data.pendingCount })}
          onPress={() => {}}
          style={styles.pendingPill}
        >
          <View aria-hidden style={styles.pendingDot} />
          <Text style={styles.pendingPillText}>
            {t("home.pendingPill", { count: data.pendingCount })}
          </Text>
          <Text aria-hidden style={styles.pendingArrow}>
            {PENDING_ARROW}
          </Text>
        </Pressable>

        <Card accessibilityLabel={data.goalCard.title}>
          <View style={styles.goalTop}>
            <Text style={styles.goalTitle}>{data.goalCard.title}</Text>
            <View style={styles.stageBadge}>
              <Text style={styles.stageBadgeText}>{data.goalCard.stageText}</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width:
                    // Percent is a bounded 0-100 number; RN DimensionValue accepts `${number}%`.
                    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                    `${data.goalCard.percent}%`,
                },
              ]}
            />
          </View>
          <View style={styles.goalMeta}>
            <Text style={styles.goalProgress}>
              {t("goalCard.progress", {
                saved: data.goalCard.savedAmountText,
                goal: data.goalCard.totalAmountText,
              })}
            </Text>
            <Text style={styles.goalPercent}>
              {t("goalCard.percent", { percent: data.goalCard.percent })}
            </Text>
          </View>
        </Card>

        <Text style={styles.section}>{t("home.recentActivity")}</Text>
        {data.recentActivity.map((item, index) => (
          <View key={`${item.category}-${String(index)}`}>
            {index > 0 ? <View style={styles.cardGap} /> : null}
            <TransactionCard
              category={item.category}
              categoryLabel={item.categoryLabel}
              status={item.status}
              amountText={item.amountText}
              purpose={item.purpose}
              timestamp={item.timestamp}
              {...(item.tier !== undefined ? { tier: item.tier } : {})}
              {...(item.stageText !== undefined ? { stageText: item.stageText } : {})}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: tokens.color.surface0,
  },
  // Tierra header: greeting, date, and the Aquí/Allá cards live on deep
  // green. The body scrolls underneath as a separate region.
  header: {
    backgroundColor: tokens.color.tierraDeep,
    paddingHorizontal: tokens.spacing.s5,
    paddingTop: tokens.spacing.s12,
    paddingBottom: tokens.spacing.s5,
  },
  greeting: {
    fontSize: tokens.type.heading1.size,
    fontWeight: tokens.type.heading1.weight,
    lineHeight: tokens.type.heading1.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textInverse,
  },
  date: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMutedInverse,
    marginTop: tokens.spacing.s1,
    marginBottom: tokens.spacing.s4,
  },
  balanceRow: {
    flexDirection: "row",
    gap: tokens.spacing.s3,
  },
  balanceCard: {
    flex: 1,
    backgroundColor: tokens.color.tierraCard,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.s4,
  },
  balanceLabel: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMutedInverse,
  },
  balanceAmount: {
    fontSize: tokens.type.amount.size,
    fontWeight: tokens.type.amount.weight,
    lineHeight: tokens.type.amount.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textInverse,
    fontVariant: ["tabular-nums"],
    marginVertical: tokens.spacing.s2,
  },
  balanceSub: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMutedInverse,
  },
  content: {
    padding: tokens.spacing.s4,
    paddingBottom: tokens.spacing.s10,
  },
  pendingPill: {
    backgroundColor: tokens.color.crema,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.s4,
    paddingVertical: tokens.spacing.s3,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: tokens.spacing.s4,
    minHeight: tokens.touchTarget.min,
  },
  pendingDot: {
    width: 8,
    height: 8,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.oro,
    marginRight: tokens.spacing.s3,
  },
  pendingPillText: {
    flex: 1,
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  pendingArrow: {
    fontSize: tokens.type.body.size,
    color: tokens.color.textMuted,
    marginLeft: tokens.spacing.s2,
  },
  goalTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: tokens.spacing.s3,
    gap: tokens.spacing.s2,
  },
  goalTitle: {
    flex: 1,
    fontSize: tokens.type.heading2.size,
    fontWeight: tokens.type.heading2.weight,
    lineHeight: tokens.type.heading2.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
  },
  stageBadge: {
    backgroundColor: tokens.color.crema,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.s3,
    paddingVertical: tokens.spacing.s1,
  },
  stageBadgeText: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.flagged,
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
  goalMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: tokens.spacing.s2,
  },
  goalProgress: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
    fontVariant: ["tabular-nums"],
  },
  goalPercent: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  section: {
    fontSize: tokens.type.heading3.size,
    fontWeight: tokens.type.heading3.weight,
    lineHeight: tokens.type.heading3.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
    marginTop: tokens.spacing.s6,
    marginBottom: tokens.spacing.s3,
  },
  cardGap: {
    height: tokens.spacing.s3,
  },
});
