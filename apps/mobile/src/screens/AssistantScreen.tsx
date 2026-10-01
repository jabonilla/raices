import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, TextInput as RNTextInput, View } from "react-native";

import "../../src/i18n";
import { Card } from "../components/Card";
import { ScreenState, type ScreenContentState } from "../components/ScreenState";
import { useScreenData } from "../data/ScreenDataContext";
import { tokens } from "../theme/tokens";

/**
 * 05 · Asistente — static shell. The AI has no write access (PRD-v2 Feature
 * 9): it explains, it never acts, and the refusal is a first-class string.
 * No avatar, no name — a breathing dot and Tierra Pale are the only
 * authorship signals.
 *
 * `screenState` renders the loading / empty / error / offline shells (K2.21).
 * The empty state carries no action: the input row is the path forward.
 * TODO(copy): assistant.states.* are invented — the copy sheet and the DS
 * specify no empty or error copy for Asistente. Listed in the PR for Claude
 * (copy owner).
 */
export function AssistantScreen({
  screenState = "content",
}: {
  readonly screenState?: ScreenContentState;
}): JSX.Element {
  const { t } = useTranslation();
  const screenData = useScreenData();
  if (screenState === "loading" || screenState === "offline") {
    return <ScreenState kind={screenState} />;
  }
  if (screenState === "empty") {
    return (
      <ScreenState
        kind="empty"
        title={t("assistant.states.emptyTitle")}
        body={t("assistant.states.emptyBody")}
      />
    );
  }
  if (screenState === "error") {
    return (
      <ScreenState
        kind="error"
        title={t("assistant.states.errorTitle")}
        body={t("states.errorBody")}
        primaryLabel={t("states.retry")}
        onPrimaryPress={() => {}}
        secondaryLabel={t("states.askAi")}
        onSecondaryPress={() => {}}
      />
    );
  }
  const data = screenData.getAssistantData();
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{t("assistant.title")}</Text>
          <View
            style={styles.langToggle}
            accessibilityRole="radiogroup"
            accessibilityLabel={t("assistant.languageToggle")}
          >
            <View
              accessibilityRole="radio"
              accessibilityState={{ selected: true }}
              style={[styles.langOption, styles.langOptionActive]}
            >
              <Text style={[styles.langText, styles.langTextActive]}>
                {t("assistant.languageEs")}
              </Text>
            </View>
            <View
              accessibilityRole="radio"
              accessibilityState={{ selected: false }}
              style={styles.langOption}
            >
              <Text style={styles.langText}>{t("assistant.languageEn")}</Text>
            </View>
          </View>
        </View>
        <View style={styles.scopeRow}>
          <View aria-hidden style={styles.dot} />
          <Text style={styles.scope}>{t("assistant.scope")}</Text>
        </View>

        {data.messages.map((message, index) =>
          message.from === "ai" ? (
            <AiMessage key={index} text={message.text} />
          ) : (
            <UserMessage key={index} text={message.text} />
          ),
        )}

        <Card style={styles.refCard}>
          <View style={styles.refTop}>
            <Text style={styles.refCategory}>{data.refCard.categoryText}</Text>
            <Text style={styles.refTime}>{data.refCard.timeText}</Text>
          </View>
          <View style={styles.refBottom}>
            <Text style={styles.refAmount}>{data.refCard.amountText}</Text>
            <Text style={styles.refLink}>{data.refCard.linkText}</Text>
          </View>
        </Card>
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.suggestionsContent}
      >
        {data.suggestions.map((s) => (
          <View key={s} style={styles.suggestion}>
            <Text style={styles.suggestionText}>{s}</Text>
          </View>
        ))}
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: tokens.spacing.s3,
  },
  title: {
    fontSize: tokens.type.heading1.size,
    fontWeight: tokens.type.heading1.weight,
    lineHeight: tokens.type.heading1.lineHeight,
    fontFamily: tokens.font.display,
    color: tokens.color.textPrimary,
  },
  langToggle: {
    flexDirection: "row",
    backgroundColor: tokens.color.surface2,
    borderRadius: tokens.radius.full,
    padding: 2,
  },
  langOption: {
    borderRadius: tokens.radius.full,
    paddingHorizontal: tokens.spacing.s3,
    paddingVertical: tokens.spacing.s2,
  },
  langOptionActive: {
    backgroundColor: tokens.color.surface1,
    // iOS-style segmented shadow; android renders elevation.
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  langText: {
    fontSize: tokens.type.bodySmall.size,
    fontWeight: tokens.type.bodySmall.weight,
    lineHeight: tokens.type.bodySmall.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
  },
  langTextActive: {
    fontWeight: tokens.type.label.weight,
    color: tokens.color.textPrimary,
  },
  scopeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: tokens.spacing.s4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.tierra,
    marginRight: tokens.spacing.s2,
    marginTop: 6,
    opacity: 0.6,
  },
  scope: {
    flex: 1,
    fontSize: tokens.type.body.size,
    fontWeight: tokens.type.body.weight,
    lineHeight: tokens.type.body.lineHeight,
    fontFamily: tokens.font.body,
    color: tokens.color.textSecondary,
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
    borderLeftWidth: 3,
    borderLeftColor: tokens.color.flagged,
  },
  refTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: tokens.spacing.s1,
  },
  refBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
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
  // NOTE (K2.23 audit): no maxHeight here on purpose. The row must grow with
  // the OS font-size setting (K2.7 bans allowFontScaling); a fixed cap would
  // clip suggestion text at the largest accessibility sizes.
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
