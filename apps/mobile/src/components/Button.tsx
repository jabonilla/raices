import type { JSX } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { tokens } from "../theme/tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "emergency";

export interface ButtonProps {
  readonly variant: ButtonVariant;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly accessibilityLabel?: string;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Button primitive (design system 3.1). Five variants, every specified state.
 *
 * - primary: the single primary action per screen (Approve, Send, Confirm)
 * - secondary: supporting actions (Decline, View Details)
 * - ghost: tertiary actions, navigation (Cancel, Skip, Back)
 * - destructive: decline confirmation only — warm, never alarming. Copy is
 *   always "Not yet" / "Hold on this one", never "Decline" / "Reject".
 * - emergency: one-tap, maximum target, emergency screens only
 *
 * Rules enforced here: 44pt minimum target on every variant, disabled at
 * 40% opacity, loading swaps the label for a spinner.
 */
export function Button({
  variant,
  label,
  onPress,
  disabled = false,
  loading = false,
  accessibilityLabel,
  style,
}: ButtonProps): JSX.Element {
  const interactive = !disabled && !loading;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !interactive, busy: loading }}
      disabled={!interactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant].container,
        pressed && interactive && styles.pressed,
        !interactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles[variant].spinner} accessibilityLabel="Cargando" />
      ) : (
        <Text style={[styles.label, variantStyles[variant].label]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: tokens.touchTarget.min,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.spacing.s6,
    borderRadius: tokens.radius.md,
  },
  pressed: {
    // Active/Pressed: scale 0.97 approximated with opacity on web; the
    // 16% darker background is handled per-variant below via opacity.
    opacity: 0.84,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: tokens.type.bodyLarge.size,
    fontWeight: tokens.type.bodyLarge.weight,
    lineHeight: tokens.type.bodyLarge.lineHeight,
    fontFamily: tokens.font.body,
  },
});

const variantStyles: Record<
  ButtonVariant,
  { container: ViewStyle; label: TextStyle; spinner: string }
> = {
  primary: {
    container: {
      minHeight: 52,
      minWidth: 160,
      backgroundColor: tokens.color.tierra,
    },
    label: { color: tokens.color.textInverse },
    spinner: tokens.color.textInverse,
  },
  secondary: {
    container: {
      minHeight: 52,
      minWidth: 160,
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderColor: tokens.color.tierra,
    },
    label: { color: tokens.color.tierra },
    spinner: tokens.color.tierra,
  },
  ghost: {
    container: {
      minHeight: tokens.touchTarget.min,
      backgroundColor: "transparent",
    },
    label: { color: tokens.color.textSecondary },
    spinner: tokens.color.textSecondary,
  },
  destructive: {
    container: {
      minHeight: 52,
      minWidth: 160,
      backgroundColor: tokens.color.declinedBg,
      borderWidth: 1.5,
      borderColor: tokens.color.borderStrong,
    },
    label: { color: tokens.color.declined },
    spinner: tokens.color.declined,
  },
  emergency: {
    container: {
      minHeight: 64,
      width: "100%",
      backgroundColor: tokens.color.tierra,
      borderRadius: tokens.radius.lg,
    },
    label: {
      color: tokens.color.textInverse,
      fontSize: tokens.type.heading3.size,
      fontWeight: tokens.type.heading3.weight,
      lineHeight: tokens.type.heading3.lineHeight,
    },
    spinner: tokens.color.textInverse,
  },
};
