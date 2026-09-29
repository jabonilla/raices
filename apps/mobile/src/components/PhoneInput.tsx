import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import "../i18n";
import { tokens } from "../theme/tokens";

/**
 * Supported countries for the phone picker (K2.27). The list is deliberately
 * short: these are the corridors Raíces serves first. Guatemala is the
 * default for recipients, the US for senders — the caller picks which via
 * `defaultCountry`.
 */
export type CountryCode = "GT" | "US" | "MX" | "SV" | "HN" | "ES";

export interface Country {
  readonly code: CountryCode;
  /** E.164 dial prefix, with the leading +. */
  readonly dial: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: "GT", dial: "+502" },
  { code: "US", dial: "+1" },
  { code: "MX", dial: "+52" },
  { code: "SV", dial: "+503" },
  { code: "HN", dial: "+504" },
  { code: "ES", dial: "+34" },
];

/** E.164 allows at most 15 digits after the +. */
const MAX_E164_DIGITS = 15;
/** Fewer than 7 digits is never a real phone number. */
const MIN_E164_DIGITS = 7;

/**
 * Validate a candidate E.164 number. Returns the i18n key of the problem in
 * plain Spanish, or null when the number is well-formed. The key (not the
 * translated string) is returned so the caller translates at render time.
 */
export function validatePhoneE164(candidate: string): string | null {
  const value = candidate.trim();
  if (value === "" || value === "+") {
    return "phone.errors.required";
  }
  if (!value.startsWith("+")) {
    return "phone.errors.plus";
  }
  const digits = value.slice(1);
  if (!/^[0-9]+$/.test(digits)) {
    return "phone.errors.digits";
  }
  if (digits.length < MIN_E164_DIGITS) {
    return "phone.errors.tooShort";
  }
  if (digits.length > MAX_E164_DIGITS) {
    return "phone.errors.tooLong";
  }
  return null;
}

export interface PhoneInputProps {
  readonly label: string;
  /** Full E.164 value ("" while empty). */
  readonly value: string;
  readonly onChangeText: (e164: string) => void;
  /** Which country is preselected. Recipients default to GT, senders to US. */
  readonly defaultCountry?: CountryCode;
  readonly error?: string | undefined;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

function countryForValue(value: string, fallback: Country): Country {
  // Longest dial prefix wins: "+1" must not shadow a longer prefix.
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  return sorted.find((c) => value.startsWith(c.dial)) ?? fallback;
}

/**
 * Phone input (K2.27): country picker + national number, reported as one
 * E.164 string. Validation happens on submit in the owning screen, in plain
 * Spanish, via `validatePhoneE164`.
 */
export function PhoneInput({
  label,
  value,
  onChangeText,
  defaultCountry = "GT",
  error,
  disabled = false,
  style,
}: PhoneInputProps): JSX.Element {
  const { t } = useTranslation();
  const fallback = COUNTRIES.find((c) => c.code === defaultCountry) ?? { code: "GT", dial: "+502" };
  const [country, setCountry] = useState<Country>(() => countryForValue(value, fallback));
  const [pickerOpen, setPickerOpen] = useState(false);

  const national = value.startsWith(country.dial) ? value.slice(country.dial.length) : "";

  function emit(nextCountry: Country, nextNational: string): void {
    // Keep only digits: the phone-pad keyboard can still produce spaces or
    // dashes on some devices.
    const digits = nextNational.replace(/[^0-9]/g, "");
    onChangeText(digits === "" ? "" : `${nextCountry.dial}${digits}`);
  }

  function selectCountry(next: Country): void {
    setCountry(next);
    setPickerOpen(false);
    emit(next, national);
  }

  const hasError = error !== undefined && error !== "";
  return (
    <View style={[styles.wrapper, disabled && styles.disabled, style]}>
      <Text style={[styles.label, hasError && styles.labelError]}>{label}</Text>
      <View style={styles.row}>
        <Pressable
          accessibilityLabel={t("phone.countryLabel", {
            country: t(`phone.countries.${country.code}`),
          })}
          accessibilityRole="button"
          accessibilityState={{ expanded: pickerOpen, disabled }}
          disabled={disabled}
          onPress={() => {
            setPickerOpen((open) => !open);
          }}
          style={[styles.dialButton, hasError && styles.fieldError]}
        >
          <Text style={styles.dialText}>{country.dial}</Text>
          {/* Decorative caret glyphs, not copy: the button already carries
              an accessibilityLabel with the country name. */}
          <Text style={styles.dialCaret}>{pickerOpen ? "▲" : "▼"}</Text>
        </Pressable>
        <RNTextInput
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          editable={!disabled}
          value={national}
          onChangeText={(text) => {
            emit(country, text);
          }}
          placeholder={t("phone.placeholder")}
          placeholderTextColor={tokens.color.textMuted}
          keyboardType="phone-pad"
          autoCapitalize="none"
          style={[styles.field, hasError && styles.fieldError]}
        />
      </View>
      {pickerOpen ? (
        <View accessibilityRole="menu" style={styles.picker}>
          {COUNTRIES.map((c) => {
            const selected = c.code === country.code;
            return (
              <Pressable
                key={c.code}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled }}
                accessibilityLabel={`${t(`phone.countries.${c.code}`)} ${c.dial}`}
                disabled={disabled}
                onPress={() => {
                  selectCountry(c);
                }}
                style={[styles.option, selected && styles.optionSelected]}
              >
                <Text style={styles.optionText}>
                  {`${t(`phone.countries.${c.code}`)} · ${c.dial}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
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
  row: {
    flexDirection: "row",
    gap: tokens.spacing.s2,
  },
  dialButton: {
    minHeight: 52,
    minWidth: tokens.touchTarget.min,
    borderWidth: 1,
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.surface1,
    paddingHorizontal: tokens.spacing.s3,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.spacing.s1,
  },
  dialText: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  dialCaret: {
    fontSize: tokens.type.bodySmall.size,
    color: tokens.color.textMuted,
  },
  field: {
    flex: 1,
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
  picker: {
    marginTop: tokens.spacing.s2,
    borderWidth: 1,
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.surface1,
    overflow: "hidden",
  },
  option: {
    minHeight: tokens.touchTarget.min,
    justifyContent: "center",
    paddingHorizontal: tokens.spacing.s4,
  },
  optionSelected: {
    backgroundColor: tokens.color.surface2,
  },
  optionText: {
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
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
