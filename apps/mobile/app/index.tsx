import { StatusBar } from "expo-status-bar";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import "../src/i18n";
import { tokens } from "../src/theme/tokens";

export default function Index(): JSX.Element {
  const { t } = useTranslation();
  const getStarted = t("app.getStarted");
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("app.name")}</Text>
      <Pressable
        accessibilityLabel={getStarted}
        accessibilityRole="button"
        style={styles.button}
        onPress={() => {
          // Placeholder: real navigation arrives with later tickets.
        }}
      >
        <Text style={styles.buttonText}>{getStarted}</Text>
      </Pressable>
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
    // Text scales with the OS font-size setting by default in React Native.
    // Never set allowFontScaling={false} (banned by lint, K2.7).
  },
  button: {
    marginTop: tokens.spacing.lg,
    // K2.7 baseline: minimum 44x44pt touch target.
    minWidth: tokens.touchTarget.min,
    minHeight: tokens.touchTarget.min,
    paddingHorizontal: tokens.spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.primary,
    borderRadius: tokens.spacing.sm,
  },
  buttonText: {
    fontSize: tokens.type.size.md,
    fontWeight: tokens.type.weight.medium,
    color: tokens.color.background,
  },
});
