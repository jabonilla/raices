import { Stack } from "expo-router";
import type { JSX } from "react";
import { StyleSheet, View } from "react-native";

import { DemoBanner } from "../src/components/DemoBanner";
import { tokens } from "../src/theme/tokens";

/**
 * Root layout (k2/web-live).
 *
 * The DemoBanner sits above every screen: this is the web demo build, so
 * every screen carries the "MODO DEMO · Sin dinero real" marker plus the
 * live API reachability state. No screen can render without it.
 */
export default function Layout(): JSX.Element {
  return (
    <View style={styles.root}>
      <DemoBanner />
      <View style={styles.content}>
        <Stack />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.color.surface0,
  },
  content: {
    flex: 1,
  },
});
