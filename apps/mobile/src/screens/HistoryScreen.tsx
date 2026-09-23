import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { TransactionCard } from "../components/TransactionCard";
import { tokens } from "../theme/tokens";

type Filter = "all" | "approved" | "pending" | "flagged";

/**
 * 04 · Historial — static shell. Filter pills are local UI state only;
 * filtering is visual (no backend). Declined renders at 60% opacity.
 */
export function HistoryScreen(): JSX.Element {
  const { t } = useTranslation();
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

      <Text style={styles.group}>{t("history.groups.yesterday")}</Text>
      <TransactionCard
        category="emergency"
        categoryLabel={t("history.emergencyCategory")}
        status="emergency"
        amountText={t("history.emergencyAmount")}
        purpose={t("history.emergencyPurpose")}
        timestamp={t("history.groups.yesterday")}
        tier="emergency"
      />
      <View style={styles.cardGap} />
      {/*
        TODO(copy): the declined row's purpose ("Inversión en negocio") is not
        in the copy sheet, which specifies only "💼 Negocio · En pausa".
      */}
      <View style={styles.declined}>
        <TransactionCard
          category="business"
          categoryLabel={t("history.declinedCategory")}
          status="declined"
          amountText={t("history.declinedAmount")}
          purpose={t("history.declinedPurpose")}
          timestamp={t("history.groups.yesterday")}
        />
      </View>

      <Text style={styles.group}>{t("history.groups.thisWeek")}</Text>
      {/*
        TODO(copy): the two rows below are not in the copy sheet; static
        placeholders for the visual shell.
      */}
      <TransactionCard
        category="food"
        categoryLabel={t("history.recentFoodCategory")}
        status="approved"
        amountText={t("history.recentFoodAmount")}
        purpose={t("history.recentFoodPurpose")}
        timestamp={t("history.groups.thisWeek")}
      />

      <Text style={styles.group}>{t("history.groups.twoWeeksAgo")}</Text>
      <TransactionCard
        category="housing"
        categoryLabel={t("history.recentHousingCategory")}
        status="approved"
        amountText={t("history.recentHousingAmount")}
        purpose={t("history.recentHousingPurpose")}
        timestamp={t("history.groups.twoWeeksAgo")}
      />
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
