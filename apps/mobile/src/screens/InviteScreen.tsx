import type { JSX } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import "../../src/i18n";
import { Button } from "../components/Button";
import { PhoneInput, validatePhoneE164 } from "../components/PhoneInput";
import { ScreenState, type ScreenContentState } from "../components/ScreenState";
import { TextInput } from "../components/TextInput";
import { useScreenData } from "../data/ScreenDataContext";
import { tokens } from "../theme/tokens";

/**
 * 06a · Invite — invite flow (K2.27). P2.2 settled the semantics, so this is
 * built truthfully:
 * - phone number plus a display name, both required at invite time
 * - the display name is what THIS sender calls THIS recipient, not a global
 *   name — it is PII and must never be logged, spanned, or sent to analytics
 *   (this screen makes no such calls; a test asserts it)
 * - E.164 phone input with a country picker defaulting to Guatemala for
 *   recipients; validation runs before submit and errors are plain Spanish
 * - fixture provider only, via the K2.24 interface — no API calls. Submit
 *   records the invite locally and shows a confirmation panel.
 *
 * TODO(copy): the confirmation panel copy is functional, not from the copy
 * sheet — the sheet specifies no invite-success wording. Listed in the PR
 * for Claude (copy owner).
 */
export function InviteScreen({
  screenState = "content",
  onSubmit,
}: {
  readonly screenState?: ScreenContentState;
  /**
   * Real-path submit (S5): the route passes the API call. When absent,
   * the fixture-local behavior applies — the invite is recorded locally
   * and the confirmation panel shows exactly what was entered.
   * A rejection keeps the form on screen with a plain error line.
   */
  readonly onSubmit?: (input: { displayName: string; phoneE164: string }) => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  // Data layer is present for the K2.24 contract even though the fixture
  // invite flow needs no records: the screen must render inside <ScreenData>.
  useScreenData();

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState<{ displayName: string; phoneE164: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  if (screenState === "loading" || screenState === "offline") {
    return <ScreenState kind={screenState} />;
  }
  if (screenState === "empty" || screenState === "error") {
    return (
      <ScreenState
        kind={screenState}
        title={t("invite.title")}
        body={t("states.errorBody")}
        primaryLabel={t("states.retry")}
        onPrimaryPress={() => {}}
      />
    );
  }

  async function submit(): Promise<void> {
    const trimmedName = displayName.trim();
    const nextNameError = trimmedName === "" ? t("invite.errors.nameRequired") : undefined;
    const phoneKey = validatePhoneE164(phone);
    const nextPhoneError = phoneKey === null ? undefined : t(phoneKey);
    setNameError(nextNameError);
    setPhoneError(nextPhoneError);
    if (nextNameError !== undefined || nextPhoneError !== undefined) {
      return;
    }
    const input = { displayName: trimmedName, phoneE164: phone.trim() };
    if (onSubmit === undefined) {
      // Fixture only: no API call. The invite is recorded locally and the
      // confirmation panel shows exactly what was entered.
      setSent(input);
      return;
    }
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      await onSubmit(input);
      setSent(input);
    } catch {
      setSubmitError(t("states.errorBody"));
    } finally {
      setSubmitting(false);
    }
  }

  function reset(): void {
    setDisplayName("");
    setPhone("");
    setNameError(undefined);
    setPhoneError(undefined);
    setSent(null);
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t("invite.title")}</Text>
      {sent === null ? (
        <View>
          <TextInput
            label={t("invite.nameLabel")}
            value={displayName}
            onChangeText={(text) => {
              setDisplayName(text);
              if (nameError !== undefined) setNameError(undefined);
            }}
            placeholder={t("invite.namePlaceholder")}
            error={nameError}
            autoCapitalize="words"
          />
          <PhoneInput
            label={t("invite.phoneLabel")}
            value={phone}
            onChangeText={(e164) => {
              setPhone(e164);
              if (phoneError !== undefined) setPhoneError(undefined);
            }}
            defaultCountry="GT"
            error={phoneError}
            style={styles.phone}
          />
          {submitError !== undefined ? <Text style={styles.submitError}>{submitError}</Text> : null}
          <Button
            variant="primary"
            label={t("invite.submit")}
            onPress={() => {
              void submit();
            }}
            disabled={submitting}
            loading={submitting}
            style={styles.submit}
          />
        </View>
      ) : (
        <View style={styles.confirm}>
          <Text style={styles.confirmTitle}>{t("invite.sentTitle")}</Text>
          <Text style={styles.confirmBody}>{t("invite.sentBody")}</Text>
          <Text style={styles.confirmName}>{sent.displayName}</Text>
          <Text style={styles.confirmPhone}>{sent.phoneE164}</Text>
          <Button
            variant="primary"
            label={t("invite.inviteAnother")}
            onPress={reset}
            style={styles.submit}
          />
        </View>
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
  },
  title: {
    fontSize: tokens.type.heading1.size,
    fontWeight: tokens.type.heading1.weight,
    lineHeight: tokens.type.heading1.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
    marginBottom: tokens.spacing.s4,
  },
  phone: {
    marginTop: tokens.spacing.s4,
  },
  submit: {
    marginTop: tokens.spacing.s6,
  },
  submitError: {
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.flagged,
    marginTop: tokens.spacing.s4,
  },
  confirm: {
    alignItems: "center",
    paddingVertical: tokens.spacing.s8,
  },
  confirmTitle: {
    fontSize: tokens.type.heading2.size,
    fontWeight: tokens.type.heading2.weight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
    marginBottom: tokens.spacing.s2,
  },
  confirmBody: {
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    marginBottom: tokens.spacing.s3,
  },
  confirmName: {
    fontSize: tokens.type.bodyLarge.size,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  confirmPhone: {
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.spacing.s1,
  },
});
