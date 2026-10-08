import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import type { JSX } from "react";

import { tokens } from "../theme/tokens";

/**
 * Demo banner (k2/web-live).
 *
 * Persistent, on every screen of the web demo. One job: make it impossible
 * to mistake the demo for real money: "MODO DEMO · Datos de prueba ·
 * Sin dinero real".
 *
 * NOTE (2026-10-08): this banner previously showed a live API reachability
 * dot, but the probe was removed — Chrome's CORB blocks cross-origin
 * no-cors fetches of the API's JSON responses, so the probe always reported
 * unreachable even with the API up. A wrong red dot is worse than no dot.
 * When K3 adds `Access-Control-Allow-Origin: https://jabonilla.github.io`
 * to /health and /ready, re-add the probe (see git history for apiHealth.ts)
 * with a normal fetch that reads the status codes.
 *
 * All colors, type, and spacing come from the design tokens (a test fails
 * on hardcoded values in components).
 */
export function DemoBanner(): JSX.Element {
  const { t } = useTranslation();

  return (
    <View style={styles.banner} accessibilityRole="header">
      <Text style={styles.bannerText}>{t("demo.banner")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.roca,
    paddingHorizontal: tokens.spacing.s4,
    paddingVertical: tokens.spacing.s2,
  },
  bannerText: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textInverse,
    textAlign: "center",
  },
});
