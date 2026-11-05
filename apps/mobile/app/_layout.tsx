import { Stack, usePathname, useRouter } from "expo-router";
import type { JSX } from "react";
import { StyleSheet, View } from "react-native";

import "../src/i18n";
import { DemoBanner } from "../src/components/DemoBanner";
import { TabBar, type TabKey } from "../src/components/TabBar";
import { selectProvider } from "../src/data/realProvider";
import { SessionProvider } from "../src/data/SessionContext";
import { tokens } from "../src/theme/tokens";

/**
 * Root layout (K2.48).
 *
 * DemoBanner sits above every screen that serves demo data: this is the
 * web demo build, so every fixture-backed screen carries the "MODO DEMO ·
 * Sin dinero real" marker. The one exception is a slice route in real
 * mode (/relationships, /invite, /approval), where the data comes from
 * the live API — marking live records as demo data would be the lie in
 * the other direction. Every other screen keeps the banner.
 *
 * TabBar sits below every screen: persistent navigation per the design
 * system (Inicio, Mi Meta, Enviar, Historial, Asistente). Every tabbed
 * screen is one tap away from anywhere; the demo banner + tab bar frame
 * all content.
 *
 * The Stack header is hidden: the screens have their own chrome, and the
 * default header leaks the route name ("index") as a stray label.
 *
 * Enviar ("send") has no dedicated screen — per the design system it is a
 * primary action, not a destination. In this demo it routes to
 * /relationships (pick a person), the closest entry point to a send flow.
 */
const TAB_ROUTES: Record<Exclude<TabKey, "send">, string> = {
  home: "/home",
  goal: "/goal",
  history: "/history",
  assistant: "/assistant",
};

function activeTabForPath(pathname: string): Exclude<TabKey, "send"> {
  const entry = (Object.entries(TAB_ROUTES) as [Exclude<TabKey, "send">, string][]).find(
    ([, route]) => pathname === route || pathname.startsWith(`${route}/`),
  );
  return entry ? entry[0] : "home";
}

/**
 * Slice routes (S5): in real mode these serve live API data, so the demo
 * banner must not claim their records are sample data. Every other route
 * serves fixture data in every mode and keeps the banner.
 */
const SLICE_ROUTES = ["/relationships", "/invite", "/approval"] as const;

function isSliceRoute(pathname: string): boolean {
  return SLICE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export default function Layout(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();

  const handleTabPress = (tab: TabKey) => {
    if (tab === "send") {
      router.push("/relationships");
      return;
    }
    router.push(TAB_ROUTES[tab]);
  };

  const showDemoBanner = !(selectProvider() === "real" && isSliceRoute(pathname));

  return (
    <SessionProvider>
      <View style={styles.root}>
        {showDemoBanner ? <DemoBanner /> : null}
        <View style={styles.content}>
          <Stack screenOptions={{ headerShown: false }} />
        </View>
        <TabBar active={activeTabForPath(pathname)} onTabPress={handleTabPress} />
      </View>
    </SessionProvider>
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
