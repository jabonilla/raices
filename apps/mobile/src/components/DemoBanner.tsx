import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import type { JSX } from "react";

import { apiBaseUrl, checkApiReachable, type ApiReachability } from "../data/apiHealth";
import { tokens } from "../theme/tokens";

/**
 * Demo banner (k2/web-live).
 *
 * Persistent, on every screen of the web demo. Two jobs:
 * 1. Make it impossible to mistake the demo for real money:
 *    "MODO DEMO · Datos de prueba · Sin dinero real".
 * 2. Show the LIVE API reachability: a real /health probe runs on boot
 *    against EXPO_PUBLIC_API_URL. Green dot = the server answered;
 *    red dot = unreachable (offline or API down).
 *
 * All colors, type, and spacing come from the design tokens (a test fails
 * on hardcoded values in components).
 */
export function DemoBanner(): JSX.Element {
  const { t } = useTranslation();
  const [reachability, setReachability] = useState<ApiReachability>("checking");

  useEffect(() => {
    let cancelled = false;
    void checkApiReachable(apiBaseUrl()).then((ok) => {
      if (!cancelled) {
        setReachability(ok ? "reachable" : "unreachable");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const statusKey =
    reachability === "reachable"
      ? "demo.apiReachable"
      : reachability === "unreachable"
        ? "demo.apiUnreachable"
        : "demo.apiChecking";
  const dotColor =
    reachability === "reachable"
      ? tokens.color.approved
      : reachability === "unreachable"
        ? tokens.color.emergency
        : tokens.color.pending;

  return (
    <View style={styles.banner} accessibilityRole="header">
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.bannerText}>{t("demo.banner")}</Text>
      <Text style={styles.statusText}>{t(statusKey)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: tokens.color.roca,
    paddingHorizontal: tokens.spacing.s4,
    paddingVertical: tokens.spacing.s2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: tokens.spacing.s2,
  },
  bannerText: {
    flex: 1,
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textInverse,
  },
  statusText: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMutedInverse,
  },
});
