import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, TextInput as RNTextInput, View } from "react-native";

import "../../src/i18n";
import { Card } from "../components/Card";
import { tokens } from "../theme/tokens";

/**
 * 05 · Asistente — static shell. The AI has no write access (PRD-v2 Feature
 * 9): it explains, it never acts, and the refusal is a first-class string.
 * No avatar, no name — a breathing dot and Tierra Pale are the only
 * authorship signals.
 */
export function AssistantScreen(): JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.dot} />
          <Text style={styles.title}>{t("assistant.title")}</Text>
        </View>
        <Text style={styles.language}>{t("assistant.languageToggle")}</Text>
        <Text style={styles.scope}>{t("assistant.scope")}</Text>

        <AiMessage text={t("assistant.greeting", { name: "Carlos" })} />
        <UserMessage text={t("assistant.userQuestion1")} />
        <AiMessage text={t("assistant.aiAnswer1")} />

        <Card style={styles.refCard}>
          <Text style={styles.refCategory}>{t("assistant.refCategory")}</Text>
          <Text style={styles.refAmount}>{t("assistant.refAmount")}</Text>
          <Text style={styles.refTime}>{t("assistant.refTime")}</Text>
          <Text style={styles.refLink}>{t("assistant.refLink")}</Text>
        </Card>

        <UserMessage text={t("assistant.userQuestion2")} />
        <AiMessage text={t("assistant.aiRefusal")} />
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.suggestions}
        contentContainerStyle={styles.suggestionsContent}
      >
        {[t("assistant.suggestion1"), t("assistant.suggestion2"), t("assistant.suggestion3")].map(
          (s) => (
            <View key={s} style={styles.suggestion}>
              <Text style={styles.suggestionText}>{s}</Text>
            </View>
          ),
        )}
      </ScrollView>

      <View style={styles.inputRow}>
        <RNTextInput
          accessibilityLabel={t("assistant.inputPlaceholder")}
          placeholder={t("assistant.inputPlaceholder")}
          placeholderTextColor={tokens.color.textMuted}
          style={styles.input}
        />
      </View>
    </View>
  );
}

function AiMessage({ text }: { readonly text: string }): JSX.Element {
  return (
    <View style={styles.aiBubble}>
      <Text style={styles.aiText}>{text}</Text>
    </View>
  );
}

function UserMessage({ text }: { readonly text: string }): JSX.Element {
  return (
    <View style={styles.userBubble}>
      <Text style={styles.userText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: tokens.color.surface0,
  },
  content: {
    padding: tokens.spacing.s4,
    paddingBottom: tokens.spacing.s4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.tierra,
    marginRight: tokens.spacing.s2,
    opacity: 0.6,
  },
  title: {
    fontSize: tokens.type.heading1.size,
    fontWeight: tokens.type.heading1.weight,
    lineHeight: tokens.type.heading1.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
  },
  language: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.tierra,
    marginTop: tokens.spacing.s1,
  },
  scope: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
    marginTop: tokens.spacing.s3,
    marginBottom: tokens.spacing.s4,
  },
  aiBubble: {
    backgroundColor: tokens.color.tierraPale,
    borderRadius: tokens.radius.lg,
    borderTopLeftRadius: tokens.radius.sm,
    padding: tokens.spacing.s4,
    marginBottom: tokens.spacing.s3,
    alignSelf: "flex-start",
    maxWidth: "85%",
  },
  aiText: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  userBubble: {
    backgroundColor: tokens.color.surface1,
    borderWidth: 1,
    borderColor: tokens.color.arena,
    borderRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.sm,
    padding: tokens.spacing.s4,
    marginBottom: tokens.spacing.s3,
    alignSelf: "flex-end",
    maxWidth: "85%",
  },
  userText: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
  },
  refCard: {
    marginBottom: tokens.spacing.s3,
  },
  refCategory: {
    fontSize: tokens.type.label.size,
    fontWeight: tokens.type.label.weight,
    lineHeight: tokens.type.label.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  refAmount: {
    fontSize: tokens.type.amount.size,
    fontWeight: tokens.type.amount.weight,
    lineHeight: tokens.type.amount.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.roca,
    fontVariant: ["tabular-nums"],
    marginVertical: tokens.spacing.s1,
  },
  refTime: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textMuted,
  },
  refLink: {
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.tierra,
    marginTop: tokens.spacing.s2,
  },
  suggestions: {
    maxHeight: 48,
  },
  suggestionsContent: {
    paddingHorizontal: tokens.spacing.s4,
    alignItems: "center",
  },
  suggestion: {
    borderWidth: 1,
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.s4,
    paddingVertical: tokens.spacing.s2,
    marginRight: tokens.spacing.s2,
    backgroundColor: tokens.color.surface1,
  },
  suggestionText: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  inputRow: {
    padding: tokens.spacing.s4,
    backgroundColor: tokens.color.surface1,
    borderTopWidth: 1,
    borderTopColor: tokens.color.arena,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.spacing.s4,
    fontSize: tokens.type.body.size,
    fontFamily: tokens.font.body,
    color: tokens.color.textPrimary,
    backgroundColor: tokens.color.surface0,
  },
});
