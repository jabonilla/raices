import type { JSX, ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../theme/tokens";

export interface CardProps {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityLabel?: string;
}

/**
 * Card primitive (design system 2.4/3.x). Flat by default — surface with a
 * border, no shadow. Padding follows the card token.
 */
export function Card({ children, style, accessibilityLabel }: CardProps): JSX.Element {
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.card, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.color.surface1,
    borderWidth: 1,
    borderColor: tokens.color.arena,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.s6,
  },
});
