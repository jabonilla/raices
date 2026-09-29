import type { ApiErrorCode } from "../../api/src/errors.js";

/**
 * Error catalog (K2.26): every ApiErrorCode from the API envelope maps to
 * user-facing copy in both locales.
 *
 * Design choice: the canonical strings live in the mobile i18n JSON
 * (`apiErrors.<code>.title` / `.body`) — the single home of user-facing
 * copy, so locale switching, the parity test, and the copy sheet workflow
 * cover them. The API keeps returning the code (its English `message` field
 * stays a dev-facing string for logs); it does NOT localize. A shared
 * package owning the strings would duplicate them outside i18n and drift —
 * one source of truth wins.
 *
 * Completeness is enforced by test/error-catalog.test.ts, which imports
 * API_ERROR_CODES from the API envelope source: adding a code without copy
 * turns CI red. There is deliberately no runtime fallback — an unmapped
 * code is a build-time failure, never a generic string in the user's face.
 *
 * Copy status: the copy sheet is silent on error wording, so every message
 * is invented in the app's register for Claude (copy owner) to replace.
 * Tracked as TODO(copy) in the K2.26 PR body.
 */
export interface ApiErrorCopyKeys {
  readonly titleKey: string;
  readonly bodyKey: string;
}

/**
 * i18n keys for the user-facing title (what happened) and body (what to do
 * next) for an API error code. Resolve with `t(titleKey)` / `t(bodyKey)`.
 * Never render the raw code.
 */
export function apiErrorCopyKeys(code: ApiErrorCode): ApiErrorCopyKeys {
  return {
    titleKey: `apiErrors.${code}.title`,
    bodyKey: `apiErrors.${code}.body`,
  };
}
