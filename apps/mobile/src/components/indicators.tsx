import type { JSX } from "react";
import { StyleSheet, Text, View } from "react-native";

import { tokens } from "../theme/tokens";

export interface StatusDotProps {
  readonly tone: "ok" | "emergency";
  /**
   * Pulse animation. Design system rule: pulse is for emergency requests
   * awaiting approval ONLY. Passing pulse with any other tone is a design
   * system violation, so it renders static instead.
   */
  readonly pulse?: boolean;
}

/**
 * 8px status dot (design system 3.5). Static Tierra for connection status;
 * brick pulse for emergency awaiting approval — and nothing else.
 */
export function StatusDot({ tone, pulse = false }: StatusDotProps): JSX.Element {
  const allowPulse = tone === "emergency" && pulse;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={tone === "emergency" ? "Urgente" : "Conectado"}
      style={[
        styles.dot,
        tone === "emergency" ? styles.emergency : styles.ok,
        allowPulse && styles.pulse,
      ]}
    />
  );
}

export interface CountBadgeProps {
  readonly count: number;
  readonly accessibilityLabel?: string;
}

/**
 * Pending-approval count badge (design system 3.5): 18px circle, Tierra
 * background, white number.
 */
export function CountBadge({ count, accessibilityLabel }: CountBadgeProps): JSX.Element {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? `${String(count)} pendientes`}
      style={styles.count}
    >
      <Text style={styles.countText}>{String(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: tokens.radius.full,
  },
  ok: {
    backgroundColor: tokens.color.tierra,
  },
  emergency: {
    backgroundColor: tokens.color.emergency,
  },
  // Pulse is a web animation; on native it would be an Animated loop.
  // The token-level rule (pulse = emergency only) is enforced above.
  pulse: {
    opacity: 0.6,
  },
  count: {
    width: 18,
    height: 18,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.tierra,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textInverse,
  },
});
