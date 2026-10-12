import type { JSX } from "react";
import { Image, StyleSheet, View } from "react-native";

import "../i18n";
import { tokens } from "../theme/tokens";

export interface PhotoSlotProps {
  /** Remote image URL. When absent, renders the graceful fallback. */
  readonly uri?: string;
  /** Accessibility label describing the photo content. */
  readonly accessibilityLabel: string;
  /** Width/height for the slot. Defaults to a 16:9-ish card. */
  readonly width?: number;
  readonly height?: number;
}

/**
 * Photo slot (K2.49 B+).
 *
 * The reference design uses striped blocks as photo slots: the empty
 * state, the arrival moment, small profile images. This component is
 * the slot: it renders the image when a URI is provided, and degrades
 * gracefully when not — a warm crema inset surface, never a broken
 * frame or a grey box with an icon.
 *
 * Images are remote URLs (Unsplash/Pexels, licensed), never bundled:
 * the bundle budget holds.
 */
export function PhotoSlot({
  uri,
  accessibilityLabel,
  width,
  height = 160,
}: PhotoSlotProps): JSX.Element {
  if (!uri) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        style={[styles.fallback, width ? { width } : styles.fluid, { height }]}
      />
    );
  }
  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      source={{ uri }}
      style={[styles.image, width ? { width } : styles.fluid, { height }]}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({
  fluid: {
    alignSelf: "stretch",
  },
  fallback: {
    // Warm inset surface — reads as intentional, not broken.
    backgroundColor: tokens.color.surfaceInset,
    borderRadius: tokens.radius.lg,
  },
  image: {
    borderRadius: tokens.radius.lg,
  },
});
