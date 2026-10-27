import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, TextInput as RNTextInput } from "react-native";

import "../i18n";
import { Button } from "../components/Button";
import { PhoneInput, validatePhoneE164 } from "../components/PhoneInput";
import type { ApiClient, Session } from "../data/apiClient";
import { ApiClientError } from "../data/apiClient";
import { tokens } from "../theme/tokens";

/**
 * Sign-in screen (S5, step 1 of the slice).
 *
 * Phone-OTP against the #153 auth routes: POST /auth/otp/request returns a
 * challenge id, POST /auth/otp/verify exchanges the challenge id plus the
 * 6-digit code for a session. The challenge id and the code live in
 * component state only — they are never logged, never stored, and never
 * leave this screen except inside the verify request itself.
 *
 * Error copy is deliberate: a wrong code says so (it is the user's typo,
 * not a session problem); a rate limit says to wait; offline says offline.
 * Anything else falls back to the generic error body, never a raw API
 * message — API bodies can contain PII.
 */
export function AuthScreen({
  client,
  onAuthenticated,
}: {
  readonly client: ApiClient;
  readonly onAuthenticated: (session: Session) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  function errorBody(error: unknown): string {
    if (error instanceof ApiClientError) {
      if (error.kind === "offline") return t("states.offlineBody");
      if (error.kind === "rate-limited") return t("apiErrors.rate_limited.body");
    }
    return t("states.errorBody");
  }

  async function sendCode(): Promise<void> {
    const key = validatePhoneE164(phone);
    if (key !== null) {
      setPhoneError(t(key));
      return;
    }
    setPhoneError(undefined);
    setFormError(undefined);
    setBusy(true);
    try {
      const challenge = await client.requestOtp(phone.trim());
      setChallengeId(challenge.challengeId);
    } catch (error) {
      setFormError(errorBody(error));
    } finally {
      setBusy(false);
    }
  }

  async function verify(): Promise<void> {
    if (challengeId === null) return;
    if (!/^\d{6}$/.test(code.trim())) {
      setFormError(t("auth.wrongCode"));
      return;
    }
    setFormError(undefined);
    setBusy(true);
    try {
      const session = await client.verifyOtp(challengeId, code.trim());
      onAuthenticated(session);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        (error.kind === "unauthorized" || error.kind === "bad-request")
      ) {
        setFormError(t("auth.wrongCode"));
      } else {
        setFormError(errorBody(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("auth.title")}</Text>
      {challengeId === null ? (
        <>
          <PhoneInput
            label={t("auth.phoneLabel")}
            value={phone}
            onChangeText={setPhone}
            defaultCountry="US"
            error={phoneError}
            disabled={busy}
          />
          {formError !== undefined ? <Text style={styles.error}>{formError}</Text> : null}
          <Button
            variant="primary"
            label={t("auth.sendCode")}
            onPress={() => void sendCode()}
            loading={busy}
          />
        </>
      ) : (
        <>
          <Text style={styles.sent}>{t("auth.codeSent")}</Text>
          <Text style={styles.label}>{t("auth.codeLabel")}</Text>
          <RNTextInput
            accessibilityLabel={t("auth.codeLabel")}
            value={code}
            onChangeText={setCode}
            placeholder={t("auth.codePlaceholder")}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            editable={!busy}
            style={styles.codeInput}
          />
          {formError !== undefined ? <Text style={styles.error}>{formError}</Text> : null}
          <Button
            variant="primary"
            label={t("auth.verify")}
            onPress={() => void verify()}
            loading={busy}
          />
          <Button
            variant="secondary"
            label={t("auth.useAnotherNumber")}
            onPress={() => {
              setChallengeId(null);
              setCode("");
              setFormError(undefined);
            }}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: tokens.color.surface0,
  },
  content: {
    padding: tokens.spacing.s4,
    gap: tokens.spacing.s4,
  },
  title: {
    fontSize: tokens.type.heading2.size,
    fontWeight: tokens.type.heading2.weight,
    lineHeight: tokens.type.heading2.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
  },
  sent: {
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  label: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  codeInput: {
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    padding: tokens.spacing.s3,
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
    letterSpacing: 4,
  },
  error: {
    fontSize: tokens.type.body.size,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.flagged,
  },
});
