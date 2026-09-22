import { StatusBar } from "expo-status-bar";
import type { JSX } from "react";
import { StyleSheet, Text, View } from "react-native";

import { tokens } from "../src/theme/tokens";

export default function Index(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Raíces</Text>
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
