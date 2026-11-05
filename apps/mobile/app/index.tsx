import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import "../src/i18n";
import { selectProvider } from "../src/data/realProvider";
import { useSession } from "../src/data/SessionContext";
import { tokens } from "../src/theme/tokens";

export default function Index(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useSession();
  const getStarted = t("app.getStarted");
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("app.name")}</Text>
      <Pressable
        accessibilityLabel={getStarted}
        accessibilityRole="button"
        style={styles.button}
        onPress={() => {
          // Real build, no session yet: sign in first. Fixture build and
          // signed-in senders go straight to /home, as before.
          router.push(selectProvider() === "real" && session === null ? "/auth" : "/home");
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
    backgroundColor: tokens.color.surface0,
    padding: tokens.spacing.s4,
  },
  title: {
    fontSize: tokens.type.display.size,
    fontWeight: tokens.type.display.weight,
    lineHeight: tokens.type.display.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
    // Text scales with the OS font-size setting by default in React Native.
    // Never set allowFontScaling={false} (banned by lint, K2.7).
  },
  button: {
    marginTop: tokens.spacing.s6,
    // K2.7 baseline: minimum 44x44pt touch target.
    minWidth: tokens.touchTarget.min,
    minHeight: tokens.touchTarget.min,
    paddingHorizontal: tokens.spacing.s6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.tierra,
    borderRadius: tokens.radius.md,
  },
  buttonText: {
    fontSize: tokens.type.bodyLarge.size,
    fontWeight: tokens.type.bodyLarge.weight,
    lineHeight: tokens.type.bodyLarge.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textInverse,
  },
});
