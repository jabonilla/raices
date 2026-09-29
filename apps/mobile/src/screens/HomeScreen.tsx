import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { Card } from "../components/Card";
import { ScreenState, type ScreenContentState } from "../components/ScreenState";
import { TransactionCard } from "../components/TransactionCard";
import { useScreenData } from "../data/ScreenDataContext";
import { tokens } from "../theme/tokens";

/**
 * 01 · Inicio — static shell. Copy sheet `claude_raices-ux-mvp-v0-copy-sheet.md`.
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
        primaryLabel={t("home.states.emptyAction")}
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
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>{t("home.greeting", { name: data.greetingName })}</Text>
      <Text style={styles.date}>{data.dateText}</Text>

      <View style={styles.balanceRow}>
        {data.balances.map((balance) => (
          <Card key={balance.label} style={styles.balanceCard} accessibilityLabel={balance.label}>
            <Text style={styles.balanceLabel}>{balance.label}</Text>
            <Text style={styles.balanceAmount}>{balance.amountText}</Text>
            <Text style={styles.balanceSub}>{balance.sub}</Text>
          </Card>
        ))}
      </View>

      <View style={styles.pendingPill}>
        <Text style={styles.pendingPillText}>
          {t("home.pendingPill", { count: data.pendingCount })}
        </Text>
      </View>

      <Card accessibilityLabel={data.goalCard.title}>
        <Text style={styles.goalTitle}>{data.goalCard.title}</Text>
        <Text style={styles.goalStage}>{data.goalCard.stageText}</Text>
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
  greeting: {
    fontSize: tokens.type.heading1.size,
    fontWeight: tokens.type.heading1.weight,
    lineHeight: tokens.type.heading1.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
  },
  date: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMuted,
    marginTop: tokens.spacing.s1,
    marginBottom: tokens.spacing.s4,
  },
  balanceRow: {
    flexDirection: "row",
    gap: tokens.spacing.s3,
    marginBottom: tokens.spacing.s3,
  },
  balanceCard: {
    flex: 1,
  },
  balanceLabel: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  balanceAmount: {
    fontSize: tokens.type.amount.size,
    fontWeight: tokens.type.amount.weight,
    lineHeight: tokens.type.amount.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.roca,
    fontVariant: ["tabular-nums"],
    marginVertical: tokens.spacing.s2,
  },
  balanceSub: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMuted,
  },
  pendingPill: {
    backgroundColor: tokens.color.pendingBg,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.s4,
    paddingVertical: tokens.spacing.s3,
    alignSelf: "flex-start",
    marginBottom: tokens.spacing.s4,
  },
  pendingPillText: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.pending,
  },
  goalTitle: {
    fontSize: tokens.type.heading2.size,
    fontWeight: tokens.type.heading2.weight,
    lineHeight: tokens.type.heading2.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
  },
  goalStage: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.spacing.s1,
    marginBottom: tokens.spacing.s3,
  },
  progressTrack: {
    height: 8,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.arena,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: tokens.color.tierra,
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
    color: tokens.color.tierra,
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
