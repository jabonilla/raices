import type { JSX } from "react";
import {
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { tokens } from "../theme/tokens";

export interface TextInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder?: string;
  readonly error?: string;
  readonly disabled?: boolean;
  readonly secureTextEntry?: boolean;
  readonly keyboardType?: "default" | "numeric" | "phone-pad";
  readonly autoCapitalize?: "none" | "sentences" | "words" | "characters";
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * Text input primitive. Label above, 52px field, radius-md, error state in
 * the flagged tone (warm brown — never alarm red). Disabled at 40% opacity.
 */
export function TextInput({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  disabled = false,
  secureTextEntry = false,
  keyboardType = "default",
  autoCapitalize = "sentences",
  style,
}: TextInputProps): JSX.Element {
  const hasError = error !== undefined && error !== "";
  return (
    <View style={[styles.wrapper, disabled && styles.disabled, style]}>
      <Text style={[styles.label, hasError && styles.labelError]}>{label}</Text>
      <RNTextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        editable={!disabled}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={tokens.color.textMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={[styles.field, hasError && styles.fieldError]}
      />
      {hasError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    marginBottom: tokens.spacing.s2,
  },
  labelError: {
    color: tokens.color.flagged,
  },
  field: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.surface1,
    paddingHorizontal: tokens.spacing.s4,
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  fieldError: {
    borderColor: tokens.color.flagged,
  },
  error: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.flagged,
    marginTop: tokens.spacing.s2,
  },
});
