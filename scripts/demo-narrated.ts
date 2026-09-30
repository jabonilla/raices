/**
 * Narrated demo scenario (K2.37).
 *
 * Walks a scripted money transfer end-to-end with on-screen narration.
 * José runs this in front of settlement partners — it makes the product's
 * logic legible to someone who has never seen Raíces.
 *
 * Usage: pnpm demo:narrated
 * Prerequisites: pnpm demo must be running (API on localhost:3000).
 *
 * The scenario: Carlos in the US sends $25.00 to María in Guatemala for
 * groceries. We walk through every step: the request, the approval gate,
 * the ledger, and the notification.
 */

const API = "http://localhost:3000";

function narrate(title: string, body: string): void {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${title}`);
  console.log("=".repeat(70));
  console.log(`\n  ${body}\n`);
}

function show(label: string, data: unknown): void {
  console.log(`  → ${label}:`);
  console.log("  " + JSON.stringify(data, null, 2).split("\n").join("\n  "));
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main(): Promise<void> {
  console.log("\n");
  console.log("  ╔══════════════════════════════════════════════════════════════╗");
  console.log("  ║                    RAÍCES — NARRATED DEMO                    ║");
  console.log("  ║         Cross-border payments: US → Guatemala                ║");
  console.log("  ╚══════════════════════════════════════════════════════════════╝");

  narrate(
    "THE PROBLEM",
    "Carlos works in the US. His mother María lives in Guatemala. " +
      "He wants to send her $25 for groceries. Traditional remittance " +
      "is expensive, slow, and opaque. María doesn't have a bank account " +
      "or a smartphone app — she uses WhatsApp only.\n\n" +
      "Raíces solves this: Carlos sends from the US, María receives via " +
      "WhatsApp. Every transfer states its purpose and passes an approval " +
      "gate. The money moves on a balanced ledger — debits always equal credits."
  );

  // Step 1: Health check
  narrate(
    "STEP 1 — The system is alive",
    "We start by confirming the API is running. This is the liveness " +
      "check — it needs nothing but the process itself."
  );
  const health = await api("GET", "/health");
  show("GET /health", health);

  // Step 2: Create transfer request
  narrate(
    "STEP 2 — Carlos requests a transfer",
    "Carlos opens the app and says: send $25.00 to María for groceries. " +
      "Notice two things: the AMOUNT ($25.00) and the PURPOSE ('groceries'). " +
      "Every transfer in Raíces carries a stated purpose. This isn't " +
      "decoration — it's how we prevent misuse and how María knows " +
      "what the money is for.\n\n" +
      "The request is created but the money has NOT moved yet. " +
      "It's waiting for approval."
  );
  const request = (await api("POST", "/transfers", {
    recipient: "maria",
    amountCents: 2500,
    currency: "USD",
    purpose: "groceries",
    sender: "carlos",
  })) as { id: string };
  show("POST /transfers", request);

  // Step 3: Approval gate
  narrate(
    "STEP 3 — The approval gate",
    "Here's what makes Raíces different from a wire transfer: nothing " +
      "moves until it's approved. The request sits in a queue. Carlos " +
      "sees it in his app and taps 'Approve'.\n\n" +
      "Why? Because cross-border money movement is irreversible. The " +
      "approval gate is the last human checkpoint before the ledger " +
      "records an immutable transaction. This is a product decision, " +
      "not a technical limitation."
  );
  const approval = (await api("POST", `/transfers/${request.id}/approve`, {})) as Record<string, unknown>;
  show("POST /transfers/:id/approve", approval);

  // Step 4: Ledger
  narrate(
    "STEP 4 — The ledger records it",
    "Once approved, the transfer is written to the ledger as a balanced " +
      "transaction: a $25.00 debit on the USD settlement account, and a " +
      "$25.00 credit to María's recipient account.\n\n" +
      "Debits equal credits. Always. This isn't enforced by application " +
      "code that could have a bug — it's enforced by a database trigger. " +
      "If the numbers don't balance, the write is rejected. The ledger " +
      "is append-only: we never update or delete, only add. This is how " +
      "we prove to auditors and partners that every cent is accounted for."
  );
  const ledger = await api("GET", `/transfers/${request.id}/ledger`);
  show("GET /transfers/:id/ledger", ledger);

  // Step 5: Notification
  narrate(
    "STEP 5 — María gets a WhatsApp",
    "María doesn't have our app. She doesn't need it. She gets a " +
      "WhatsApp message: 'You have $25.00 waiting for groceries. Reply " +
      "YES to accept.'\n\n" +
      "She replies YES. That's it. No download, no account, no password. " +
      "This is why Raíces works for the real world — we meet recipients " +
      "where they already are.\n\n" +
      "(In this demo, the WhatsApp is fake. In production, it's the " +
      "real WhatsApp Business API.)"
  );
  show("WhatsApp to +50255501111", {
    body: "You have $25.00 waiting for groceries. Reply YES to accept.",
    status: "delivered (fake)",
  });

  // Step 6: Settlement
  narrate(
    "STEP 6 — Settlement",
    "The $25.00 moves from our USD settlement account to the local " +
      "payout partner in Guatemala. They hand cash to María or deposit " +
      "to her mobile money account.\n\n" +
      "This is where YOU come in, as a settlement partner. Raíces " +
      "handles the ledger, the approval, and the WhatsApp. You handle " +
      "the last mile: getting physical money to María. We settle with " +
      "you in bulk, on terms we agree."
  );
  show("Settlement", {
    from: "settlement:usd",
    to: "partner:guatemala-payout",
    amountCents: 2500,
    currency: "USD",
    status: "settled (mock)",
  });

  narrate(
    "DONE",
    "That's Raíces: $25.00 from Carlos in the US to María in Guatemala, " +
      "with a stated purpose, an approval gate, a balanced ledger, and " +
      "a WhatsApp notification. No app for María. Full audit trail for us.\n\n" +
      "Questions?"
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nDemo failed:", message);
  console.error("\nMake sure 'pnpm demo' is running first (API on localhost:3000).");
  process.exit(1);
});
