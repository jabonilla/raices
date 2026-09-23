import { StatusBar } from "expo-status-bar";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

import "../src/i18n";
import { tokens } from "../src/theme/tokens";

export default function Index(): JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("app.name")}</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.background,
    padding: tokens.spacing.md,
  },
  title: {
    fontSize: tokens.type.size.xl,
    fontWeight: tokens.type.weight.bold,
    color: tokens.color.text,
  },
});
