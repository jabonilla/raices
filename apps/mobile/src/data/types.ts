import type { TransactionStatus } from "../components/StatusBadge";
import type { TransactionCategory, TransactionTier } from "../components/TransactionCard";

/**
 * Data shapes for the mobile screens (K2.24).
 *
 * The split between i18n and this module is deliberate:
 * - i18n owns UI chrome copy: labels, titles, templates, button text.
 * - This module owns record data: names, purposes, messages, list items, and
 *   amounts.
 *
 * Amounts are preformatted OPAQUE strings (e.g. "$9,876,543.21"). The data
 * layer never formats, computes, or parses money (issue #12) — formatting is
 * the backend's job in Phase 3; here the strings pass through verbatim.
 * Percentages and counts are plain numbers because they drive layout
 * (progress-bar width) or interpolation, never money math.
 */

/** One transaction row. Mirrors TransactionCardProps minus the component. */
export interface TransactionItem {
  readonly category: TransactionCategory;
  readonly categoryLabel: string;
  readonly status: TransactionStatus;
  /** Preformatted opaque amount string. Never parsed, never computed. */
  readonly amountText: string;
  readonly purpose: string;
  readonly timestamp: string;
  readonly tier?: TransactionTier;
  readonly stageText?: string;
}

/** 01 · Inicio */
export interface HomeBalance {
  readonly label: string;
  readonly amountText: string;
  readonly sub: string;
}

export interface HomeGoalCard {
  readonly title: string;
  readonly stageText: string;
  readonly savedAmountText: string;
  readonly totalAmountText: string;
  /** 0–100. Drives the progress-bar width only. */
  readonly percent: number;
}

export interface HomeData {
  readonly greetingName: string;
  /** Opaque display string, e.g. "Miércoles, 26 de agosto". */
  readonly dateText: string;
  readonly balances: readonly HomeBalance[];
  readonly pendingCount: number;
  readonly goalCard: HomeGoalCard;
  readonly recentActivity: readonly TransactionItem[];
}

/** 02 · Aprobación */
export interface ApprovalData {
  readonly recipientName: string;
  readonly relationship: string;
  readonly categoryLabel: string;
  readonly purpose: string;
  /** Preformatted opaque amount string. Never parsed, never computed. */
  readonly amountText: string;
  readonly planMatchText: string;
  /** Preformatted opaque amount string for the plan-match detail line. */
  readonly planAvailableText: string;
}

/** 03 · Mi Meta */
export interface GoalStage {
  readonly name: string;
  /** Opaque detail string, e.g. "$4,400 de $5,000". */
  readonly detail: string;
  readonly meta?: string;
  readonly badge?: string;
  readonly done: boolean;
  readonly upcoming: boolean;
}

export interface GoalData {
  readonly title: string;
  readonly subtitle: string;
  readonly savedAmountText: string;
  readonly remainingAmountText: string;
  readonly totalAmountText: string;
  /** 0–100. Drives the progress-bar width only. */
  readonly progressPercent: number;
  readonly stages: readonly GoalStage[];
}

/** 04 · Historial */
export interface HistoryGroup {
  readonly title: string;
  readonly items: readonly TransactionItem[];
}

export interface HistoryData {
  readonly groups: readonly HistoryGroup[];
}

/** 05 · Asistente */
export interface AssistantMessage {
  readonly from: "ai" | "user";
  readonly text: string;
}

export interface AssistantRefCard {
  readonly categoryText: string;
  readonly amountText: string;
  readonly timeText: string;
  readonly linkText: string;
}

export interface AssistantData {
  readonly messages: readonly AssistantMessage[];
  readonly refCard: AssistantRefCard;
  readonly suggestions: readonly string[];
}
