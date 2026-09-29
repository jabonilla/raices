/**
 * Webhook signature verification (K2.28): the receiving half of the channel
 * seam still has no real provider, so verification lives behind an interface
 * and the only implementation is a fake. No real credentials anywhere.
 *
 * The verifier sees the RAW request body bytes and the signature the caller
 * presented (conventionally the `x-webhook-signature` header — the fake's
 * convention, not a provider's). A real provider implementation would HMAC
 * the raw body with a stored secret and compare in constant time; the fake
 * just compares against a configured expected value so tests can exercise
 * both the accept and reject paths deterministically.
 */
export interface WebhookSignatureVerifier {
  verify(input: {
    /** Raw request body bytes, exactly as received. */
    readonly rawBody: Buffer;
    /** Signature presented by the caller, if any. */
    readonly signature: string | undefined;
  }): boolean;
}

/**
 * Fake verifier (K2.28). Accepts exactly one configured signature value and
 * rejects everything else, including a missing signature. The default value
 * is a well-known TEST constant — it is not a credential, it only exists so
 * the skeleton route can be exercised end to end.
 */
export class FakeSignatureVerifier implements WebhookSignatureVerifier {
  static readonly TEST_SIGNATURE = "test-signature";

  private readonly expected: string;

  constructor(expected: string = FakeSignatureVerifier.TEST_SIGNATURE) {
    this.expected = expected;
  }

  verify(input: { readonly rawBody: Buffer; readonly signature: string | undefined }): boolean {
    // Note: the fake ignores rawBody and checks only the presented signature.
    // The real implementation will HMAC the raw bytes with a stored secret.
    return input.signature !== undefined && input.signature === this.expected;
  }
}
