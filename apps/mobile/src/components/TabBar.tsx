import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import "../i18n";
import { tokens } from "../theme/tokens";

// The FAB arrow is a presentational glyph, not localizable copy.
const FAB_ARROW = "↑";

export type TabKey = "home" | "goal" | "send" | "history" | "assistant";

export interface TabBarProps {
  readonly active: Exclude<TabKey, "send">;
  readonly onTabPress?: (tab: TabKey) => void;
}

/**
 * Bottom tab bar — Figma "Raíces — MVP v0" (Tierra theme, 2026-09-30).
 *
 * Five positions: Inicio, Mi Meta, Enviar (center FAB), Historial,
 * Asistente. The active tab shows a tierra dot above its label. Enviar is
 * a 46pt tierra FAB with an up arrow — the primary action.
 *
 * Navigation wiring is a separate ticket; `onTabPress` is the seam.
 */
export function TabBar({ active, onTabPress }: TabBarProps): JSX.Element {
  const { t } = useTranslation();
  const tabs: Exclude<TabKey, "send">[] = ["home", "goal", "history", "assistant"];

  const renderTab = (tab: Exclude<TabKey, "send">) => {
    const isActive = tab === active;
    return (
      <Pressable
        key={tab}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={t(`tabs.${tab}`)}
        onPress={() => onTabPress?.(tab)}
        style={styles.tab}
      >
        {isActive ? (
          <View aria-hidden style={styles.activeDot} />
        ) : (
          <View style={styles.dotSpacer} />
        )}
        <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{t(`tabs.${tab}`)}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.bar}>
      {tabs.slice(0, 2).map(renderTab)}
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={t("tabs.send")}
        onPress={() => onTabPress?.("send")}
        style={styles.fabTab}
      >
        <View style={styles.fab}>
          <Text aria-hidden style={styles.fabArrow}>
            {FAB_ARROW}
          </Text>
        </View>
        <Text style={styles.tabLabel}>{t("tabs.send")}</Text>
      </Pressable>
      {tabs.slice(2).map(renderTab)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: tokens.color.surface1,
    borderTopWidth: 1,
    borderTopColor: tokens.color.arena,
    paddingTop: tokens.spacing.s3,
    paddingBottom: tokens.spacing.s6,
    paddingHorizontal: tokens.spacing.s4,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    minHeight: tokens.touchTarget.min,
    justifyContent: "flex-start",
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.tierra,
    marginBottom: tokens.spacing.s1,
  },
  dotSpacer: {
    width: 5,
    height: 5,
    marginBottom: tokens.spacing.s1,
  },
  tabLabel: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMuted,
  },
  tabLabelActive: {
    color: tokens.color.textPrimary,
    fontWeight: tokens.type.heading3.weight,
  },
  fabTab: {
    flex: 1,
    alignItems: "center",
    minHeight: tokens.touchTarget.min,
  },
  fab: {
    width: 46,
    height: 46,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.tierraDeep,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -20,
    marginBottom: tokens.spacing.s1,
  },
  fabArrow: {
    fontSize: tokens.type.heading2.size,
    color: tokens.color.textInverse,
    fontWeight: tokens.type.heading2.weight,
  },
});
