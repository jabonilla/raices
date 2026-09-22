/**
 * Intl.NumberFormat v3 (ES2023) accepts a decimal string and formats it
 * without going through a float. No TypeScript lib declares that overload
 * yet, so it is declared here.
 *
 * This is what lets `format` stay exact: passing the major-unit string keeps
 * every digit, where passing a number silently rounds past 2^53. Verified on
 * Node 22 — `format("12345678901234567890.99")` yields
 * `$12,345,678,901,234,567,890.99`, while the number overload yields
 * `$12,345,678,901,234,567,000.00`.
 */
declare namespace Intl {
  interface NumberFormat {
    format(value: number | bigint | string): string;
  }
}
