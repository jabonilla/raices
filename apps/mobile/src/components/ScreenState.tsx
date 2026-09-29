import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { Button } from "./Button";
import { tokens } from "../theme/tokens";

/**
 * The four non-happy-path states every screen can render (K2.21, DS §13).
 * The screens are static shells, so each takes an optional `screenState` prop
 * ("content" by default) and renders this component instead of its content.
 *
 * Rules honored here:
 * - Error states never show a raw error: one sentence saying what happened,
 *   one saying what to do next, in the user's language (DS §13.1). No error
 *   codes, no stack traces, no institutional alarm signals.
 * - Offline is explicit: the whole content area says so. Stale data is never
 *   presented as if it were live.
 * - Empty states get a single primary action at most, never a secondary one
 *   (DS §13.4). Error states follow the DS §13.3 pattern: primary action +
 *   "Ask AI".
 *
 * Glyphs are emoji stand-ins. The design system calls for a custom 2px
 * outline icon set; that is a design task (see the copy sheet's gaps table),
 * same as the existing category icons.
 */
export type ScreenContentState = "content" | "loading" | "empty" | "error" | "offline";

type ScreenStateProps =
  | { readonly kind: "loading" | "offline" }
  | {
      readonly kind: "empty" | "error";
      readonly title: string;
      readonly body: string;
      readonly primaryLabel?: string;
      readonly onPrimaryPress?: () => void;
      readonly secondaryLabel?: string;
      readonly onSecondaryPress?: () => void;
    };

const GLYPHS = {
  empty: "🌄",
  error: "〰️",
  offline: "☁️",
} as const;

export function ScreenState(props: ScreenStateProps): JSX.Element {
  const { t } = useTranslation();

  switch (props.kind) {
    case "loading":
      return (
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator
            size="large"
            color={tokens.color.tierra}
            accessibilityLabel={t("states.loading")}
          />
          <Text style={styles.loadingText}>{t("states.loading")}</Text>
        </View>
      );
    case "offline":
      // Shared copy: offline is about connectivity, never about the screen.
      return (
        <StateBody
          glyph={GLYPHS.offline}
          title={t("states.offlineTitle")}
          body={t("states.offlineBody")}
        />
      );
    case "empty":
    case "error":
      return (
        <StateBody
          glyph={GLYPHS[props.kind]}
          title={props.title}
          body={props.body}
          primaryLabel={props.primaryLabel}
          onPrimaryPress={props.onPrimaryPress}
          secondaryLabel={props.secondaryLabel}
          onSecondaryPress={props.onSecondaryPress}
        />
      );
  }
}

function StateBody({
  glyph,
  title,
  body,
  primaryLabel,
  onPrimaryPress,
  secondaryLabel,
  onSecondaryPress,
}: {
  readonly glyph: string;
  readonly title: string;
  readonly body: string;
  readonly primaryLabel?: string | undefined;
  readonly onPrimaryPress?: (() => void) | undefined;
  readonly secondaryLabel?: string | undefined;
  readonly onSecondaryPress?: (() => void) | undefined;
}): JSX.Element {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite" accessibilityLabel={title}>
      {/* Glyphs are presentational stand-ins, like the existing category icons. */}
      <Text style={styles.glyph}>{glyph}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {primaryLabel !== undefined ? (
        <Button
          variant="primary"
          label={primaryLabel}
          onPress={onPrimaryPress ?? (() => {})}
          style={styles.primary}
        />
      ) : null}
      {secondaryLabel !== undefined ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={secondaryLabel}
          onPress={onSecondaryPress ?? (() => {})}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>{secondaryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: tokens.color.surface0,
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.spacing.s6,
  },
  loadingText: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.spacing.s3,
  },
  glyph: {
    fontSize: tokens.type.display.size,
    lineHeight: tokens.type.display.lineHeight,
    marginBottom: tokens.spacing.s4,
  },
  title: {
    fontSize: tokens.type.heading2.size,
    fontWeight: tokens.type.heading2.weight,
    lineHeight: tokens.type.heading2.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
    textAlign: "center",
    marginBottom: tokens.spacing.s2,
  },
  body: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    textAlign: "center",
    marginBottom: tokens.spacing.s6,
  },
  primary: {
    marginBottom: tokens.spacing.s2,
  },
  secondary: {
    minHeight: tokens.touchTarget.min,
    justifyContent: "center",
    paddingHorizontal: tokens.spacing.s4,
  },
  secondaryText: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.tierra,
  },
});
