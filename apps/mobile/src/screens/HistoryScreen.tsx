import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { ScreenState, type ScreenContentState } from "../components/ScreenState";
import { TransactionCard } from "../components/TransactionCard";
import { useScreenData } from "../data/ScreenDataContext";
import { tokens } from "../theme/tokens";

type Filter = "all" | "approved" | "pending" | "flagged";

/**
 * 04 · Historial — static shell. Filter pills are local UI state only;
 * filtering is visual (no backend). Declined renders at 60% opacity.
 *
 * `screenState` renders the loading / empty / error / offline shells (K2.21).
 * Empty copy is DS §13.4 verbatim.
 * TODO(copy): history.states.errorTitle is invented; the English translations
 * are draft. Listed in the PR for Claude (copy owner).
 */
export function HistoryScreen({
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
        title={t("history.states.emptyTitle")}
        body={t("history.states.emptyBody")}
        primaryLabel={t("common.sendNow")}
        onPrimaryPress={() => {}}
      />
    );
  }
  if (screenState === "error") {
    return (
      <ScreenState
        kind="error"
        title={t("history.states.errorTitle")}
        body={t("states.errorBody")}
        primaryLabel={t("states.retry")}
        onPrimaryPress={() => {}}
        secondaryLabel={t("states.askAi")}
        onSecondaryPress={() => {}}
      />
    );
  }
  const data = screenData.getHistoryData();
  const [filter, setFilter] = useState<Filter>("all");
  const filters: Filter[] = ["all", "approved", "pending", "flagged"];
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("history.title")}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
        {filters.map((f) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            accessibilityLabel={t(`history.filters.${f}`)}
            accessibilityState={{ selected: filter === f }}
            onPress={() => {
              setFilter(f);
            }}
            style={[styles.pill, filter === f && styles.pillActive]}
          >
            <Text style={[styles.pillText, filter === f && styles.pillTextActive]}>
              {t(`history.filters.${f}`)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {data.groups.map((group) => (
        <View key={group.title}>
          <Text style={styles.group}>{group.title}</Text>
          {group.items.map((item, index) => {
            const card = (
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
            );
            return (
              <View key={`${item.category}-${item.amountText}-${String(index)}`}>
                {index > 0 ? <View style={styles.cardGap} /> : null}
                {/*
                  Declined renders at 60% opacity. The status comes from the
                  provider — the screen only maps status to presentation.
                */}
                {item.status === "declined" ? <View style={styles.declined}>{card}</View> : card}
              </View>
            );
          })}
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
  title: {
    fontSize: tokens.type.heading1.size,
    fontWeight: tokens.type.heading1.weight,
    lineHeight: tokens.type.heading1.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
    marginBottom: tokens.spacing.s3,
  },
  filters: {
    marginBottom: tokens.spacing.s4,
  },
  pill: {
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.color.borderStrong,
    backgroundColor: tokens.color.surface1,
    paddingHorizontal: tokens.spacing.s4,
    paddingVertical: tokens.spacing.s2,
    marginRight: tokens.spacing.s2,
    minHeight: tokens.touchTarget.min,
    justifyContent: "center",
  },
  pillActive: {
    backgroundColor: tokens.color.tierra,
    borderColor: tokens.color.tierra,
  },
  pillText: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  pillTextActive: {
    color: tokens.color.textInverse,
  },
  group: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMuted,
    marginTop: tokens.spacing.s4,
    marginBottom: tokens.spacing.s2,
  },
  cardGap: {
    height: tokens.spacing.s3,
  },
  declined: {
    opacity: 0.6,
  },
});
