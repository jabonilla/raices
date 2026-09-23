# Design System
## Immigrant Wealth Protection App

**Version:** 1.0 — Foundation  
**Status:** For product + engineering review  
**Last updated:** August 2026  
**Audience:** UX designers, frontend engineers, product team

---

## 0. Design Philosophy

This design system does not exist to look impressive. It exists to earn trust from people who have been failed by every institution that has ever tried to earn it before.

The visual language has one job: make the product feel like it belongs to the user — not like something built for them by people who have never met them.

**The tension we're resolving:**

The user is a working-class Guatemalan immigrant who has been rejected by banks, ignored by fintech, and failed by formal systems. They also deserve — and will respond to — a product that looks as serious and capable as the goal it's helping them achieve. The house. The land. The business. These are not small things. The product cannot look small either.

**Approachable premium** means: the product looks like it belongs in the same league as Robinhood or Titan — disciplined, confident, financially serious — but it speaks Guatemalan Spanish, it doesn't use words like "compliance," and it treats the user like someone who has been waiting their whole life for something built for them.

---

## 1. Brand Identity

### 1.1 Product Name
Product name is TBD. This design system is internally referred to as **Raíces** — a codename for the system itself, not the product. All design token prefixes use "raices" as a convention placeholder until a product name is chosen.

### 1.2 Brand Positioning Statement
> Not a bank. Not a remittance app. The financial companion that crosses the border with you.

### 1.3 Design Principles (ranked by priority)

**1. Dignity first**
Every screen, every copy choice, every interaction must pass this test: does this give the user dignity, or does it take it away? Derived directly from the behavioral research: shame is the most underappreciated factor in this product's landscape.

**2. Clarity over cleverness**
The user does not have time to figure out your design. They are on a 10-minute break, hands calloused, phone in one hand. The interface must communicate its purpose before they have to think. No clever metaphors. No abstract icons. No UI patterns that require reading.

**3. Partnership, not surveillance**
The accountability mechanic is the product's core feature. It must never feel like monitoring. Every visual choice that creates a sense of judgment, inspection, or audit must be revised. The product is a shared plan — not a leash.

**4. Premium without pretension**
Clean, confident, spacious. The visual quality signals: this was built by people who take your money as seriously as you do. But the language, the imagery, and the flow stay rooted in the user's world. Not Wall Street. Not Silicon Valley. The aspiration of a family building something real.

**5. Mobile-first, low-bandwidth honest**
The sender is on LTE during a work break. The recipient may be on 2G in a rural area. The design must function beautifully at its lowest technical tier. No heavy images in critical flows. Meaningful interactions complete in under 60 seconds.

---

## 2. Design Tokens

### 2.1 Color

#### Primary Palette

| Token | Name | Value | Usage |
|---|---|---|---|
| `--color-tierra` | Tierra | `#2D4A3E` | Primary brand — all primary actions, key text, high-stakes confirmations |
| `--color-tierra-light` | Tierra Light | `#3D6355` | Hover states, secondary emphasis |
| `--color-tierra-pale` | Tierra Pale | `#EAF2EE` | Background tints, subtle highlights |
| `--color-oro` | Oro | `#C4922A` | Approval / positive / milestone completion |
| `--color-oro-light` | Oro Light | `#F5E4BF` | Approval backgrounds, success tints |
| `--color-roca` | Roca | `#1A1A1A` | Primary text — headlines, important labels |
| `--color-niebla` | Niebla | `#F7F6F3` | Page background — warm off-white, not clinical white |
| `--color-arena` | Arena | `#EDEDEA` | Card borders, dividers, subtle structure |

**Color rationale:** Tierra (deep forest green) was chosen deliberately over the fintech defaults (blue, navy, purple). It carries connotations of earth, land, roots — the actual goals users are building toward. It is serious without being cold, premium without being generic. Oro (warm gold) signals approval and milestone completion — aspirational, not garish.

#### Semantic Colors

| Token | Value | Usage |
|---|---|---|
| `--color-approved` | `#2D4A3E` (Tierra) | Approved transactions, connected status, success states |
| `--color-approved-bg` | `#EAF2EE` | Approved state backgrounds |
| `--color-pending` | `#C4922A` (Oro) | Pending approval, needs attention, in-progress |
| `--color-pending-bg` | `#F5E4BF` | Pending state backgrounds |
| `--color-flagged` | `#8B4513` | Flagged / needs review — warm brown, not alarm-red |
| `--color-flagged-bg` | `#F5EDE8` | Flagged state backgrounds |
| `--color-emergency` | `#B5451B` | Emergency requests only |
| `--color-emergency-bg` | `#FAECEA` | Emergency state backgrounds |
| `--color-declined` | `#6B6B6B` | Declined — neutral, non-punitive |
| `--color-declined-bg` | `#F0F0EE` | Declined state backgrounds |

**Semantic rationale:** "Flagged" is warm brown, not red. Red reads as alarm and triggers institutional anxiety in this user. "Declined" is neutral gray — the research is explicit that decline must not feel punitive. The design system enforces this at the token level.

#### Neutral Palette

| Token | Value | Usage |
|---|---|---|
| `--color-text-primary` | `#1A1A1A` | Headlines, key data |
| `--color-text-secondary` | `#4A4A4A` | Body text, descriptions |
| `--color-text-muted` | `#888885` | Metadata, timestamps, helper text |
| `--color-text-inverse` | `#FFFFFF` | Text on dark backgrounds |
| `--color-surface-0` | `#F7F6F3` | Page background (Niebla) |
| `--color-surface-1` | `#FFFFFF` | Card surface |
| `--color-surface-2` | `#F2F1EE` | Inset surface, secondary card |
| `--color-border` | `#E8E7E3` | Default borders |
| `--color-border-strong` | `#D4D3CF` | Emphasized borders |

---

### 2.2 Typography

#### Type System

The type system uses two families only:

**Display / Headings:** `"Plus Jakarta Sans"` — a geometric humanist sans-serif. Premium, confident, and unusually warm at display sizes. Used for all headings, large numbers, and milestone moments.

**Body / UI:** `"Inter"` — the industry standard for legible mobile UI. Used for all body text, labels, buttons, and navigation. No surprises. Maximum readability on small screens.

**Why not a serif?** The behavioral research is clear: the user compares every app to WhatsApp. WhatsApp is sans-serif, clean, and direct. A serif body would signal "institution" — which is exactly the wrong register for this product.

#### Type Scale

| Token | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| `--type-display` | 32px | 600 | 1.2 | Milestone completions, onboarding headlines |
| `--type-heading-1` | 24px | 600 | 1.3 | Page titles, major section headers |
| `--type-heading-2` | 20px | 600 | 1.35 | Card titles, section headers |
| `--type-heading-3` | 17px | 500 | 1.4 | Sub-section headers, list headers |
| `--type-body-large` | 16px | 400 | 1.6 | Primary body text, descriptions |
| `--type-body` | 15px | 400 | 1.6 | Standard body, card content |
| `--type-body-small` | 13px | 400 | 1.5 | Supporting text, metadata |
| `--type-label` | 12px | 500 | 1.4 | Labels, badges, tags |
| `--type-amount` | 28px | 600 | 1.1 | Transaction amounts (tabular-nums) |
| `--type-amount-large` | 40px | 600 | 1.0 | Large milestone amounts |

**Amount sizing:** Money amounts use tabular-nums and a dedicated scale because they are the most emotionally significant numbers in the product. They deserve visual weight. "$15,000" should feel real and serious.

#### Font Loading

```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Inter:wght@400;500&display=swap');

:root {
  --font-display: 'Plus Jakarta Sans', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', monospace;
}
```

---

### 2.3 Spacing

The spacing system uses an 8-point base with a 4-point half-step for tight UI contexts.

| Token | Value | Usage |
|---|---|---|
| `--space-1` | 4px | Icon margins, tight internal gaps |
| `--space-2` | 8px | Between label and value, small gaps |
| `--space-3` | 12px | Within components, list item internal |
| `--space-4` | 16px | Standard padding, card internal |
| `--space-5` | 20px | Section gaps, between related elements |
| `--space-6` | 24px | Card padding, major component gaps |
| `--space-8` | 32px | Section separators |
| `--space-10` | 40px | Page section padding |
| `--space-12` | 48px | Large section gaps |
| `--space-16` | 64px | Page-level breathing room |

---

### 2.4 Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 6px | Tags, badges, small components |
| `--radius-md` | 10px | Buttons, input fields |
| `--radius-lg` | 14px | Cards, modal sheets |
| `--radius-xl` | 20px | Bottom sheets, full-screen cards |
| `--radius-full` | 9999px | Avatar circles, pill indicators |

---

### 2.5 Elevation / Shadows

The system uses minimal elevation — most surfaces are flat. Shadow is reserved for modals and bottom sheets.

| Token | Value | Usage |
|---|---|---|
| `--shadow-none` | none | Default card state (border only) |
| `--shadow-card` | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` | Hover state on interactive cards |
| `--shadow-sheet` | `0 -4px 24px rgba(0,0,0,0.08), 0 -1px 8px rgba(0,0,0,0.04)` | Bottom sheets, approval modals |
| `--shadow-modal` | `0 20px 60px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)` | Alert modals, emergency screens |

---

### 2.6 Motion

| Token | Value | Usage |
|---|---|---|
| `--duration-fast` | 120ms | Micro-interactions, state changes |
| `--duration-base` | 200ms | Standard transitions |
| `--duration-slow` | 320ms | Bottom sheets, page transitions |
| `--duration-celebration` | 600ms | Milestone completion, approval confirm |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Elements entering |
| `--ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Elements leaving |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Approval confirmation, positive feedback |

**Motion rationale:** The `--ease-spring` easing (slight overshoot) is reserved exclusively for positive, celebratory moments: a request approved, a milestone confirmed. It creates a subtle physical quality that signals something good just happened. It must not appear on neutral or negative interactions.

---

## 3. Component Library

### 3.1 Buttons

Buttons are the most frequently touched element in the approval flow. They must be large enough for calloused hands, clear enough to tap from a notification, and emotionally calibrated for their context.

#### Variants

**Primary (Tierra)**
Used for: single primary action per screen (Approve, Send, Confirm)
- Background: `--color-tierra`
- Text: `--color-text-inverse`
- Height: 52px (mobile) / 48px (web)
- Border radius: `--radius-md`
- Font: `--type-body-large`, weight 500
- Min width: 160px, max: full width in bottom action areas

**Secondary**
Used for: supporting actions (Decline, View Details, Ask AI)
- Background: transparent
- Border: 1.5px solid `--color-tierra`
- Text: `--color-tierra`
- Height: 52px (mobile) / 48px (web)

**Ghost**
Used for: tertiary actions, navigation (Cancel, Skip, Back)
- Background: transparent
- Border: none
- Text: `--color-text-secondary`
- Height: 44px

**Destructive (for decline flow)**
Used exclusively in the decline confirmation — warm, not alarming
- Background: `--color-declined-bg`
- Text: `--color-declined`
- Border: 1.5px solid `--color-border-strong`
- Copy: always "Not yet" or "Hold on this one" — never "Decline" or "Reject"

**Emergency Approve (special)**
One-tap. Maximum tap target. Appears only on emergency screens.
- Background: `--color-tierra`
- Text: `--color-text-inverse`
- Height: 64px
- Width: 100%
- Border radius: `--radius-lg`
- Font: `--type-heading-3`, weight 600
- Has subtle spring animation on tap

#### Button States

| State | Visual change |
|---|---|
| Default | Base colors |
| Hover | 8% darker background (web only) |
| Active/Pressed | Scale 0.97, 16% darker |
| Disabled | 40% opacity, no pointer events |
| Loading | Spinner replaces label, same background |

#### Button Rules (enforced by system)

- Never two primary buttons on the same screen
- Approve always appears on the right / bottom in side-by-side layouts
- Decline always appears on the left / top — less visually dominant
- Emergency Approve is always full-width and stands alone
- Never use "Submit," "OK," or "Proceed" — always name the specific action

---

### 3.2 Transaction Cards

The transaction card is the fundamental unit of the product. It appears in the history view, the approval queue, and the weekly digest. It must communicate: who, what amount, what purpose, and what status — at a glance, from a distance, in bright sunlight.

#### Card Anatomy

```
┌─────────────────────────────────────────┐
│ [Category Icon] [Category Label]  [Status Badge]  │
│                                                    │
│ [Purpose Description]                              │
│                                                    │
│ [Amount]                            [Timestamp]   │
└─────────────────────────────────────────┘
```

**Category Icon:** 20×20px, single-color, filled — one of 6 icons (🏠 Housing, 🛒 Food, ⚡ Utilities, 💼 Business, 🚨 Emergency, ❓ Unrecognized). Never custom icons — the 6 must be instantly recognizable.

**Status Badge:** Pill badge in the top-right. Never uses alarm language. See status vocabulary below.

**Amount:** `--type-amount` — always right-aligned, always with currency symbol. This is the most important number on the card.

**Status vocabulary (enforced):**

| State | Badge copy | Badge color |
|---|---|---|
| Approved | ✓ Enviado | Approved (green) |
| Pending | Esperando | Pending (gold) |
| Flagged | Para revisar | Flagged (warm brown) |
| Emergency | Urgente | Emergency (brick) |
| Declined | En pausa | Declined (neutral gray) |
| Failed | No llegó | Neutral gray with explanation |

The Spanish copy is intentional and primary. The app defaults to Spanish. English strings exist but Spanish is first-class.

#### Card Tiers (visual differentiation)

**Recurring (auto-approved):** Standard card. No badge needed if auto-approved. Subtle left border in Tierra Pale.

**Planned Investment:** Slightly elevated card with gold left border. Amount shown with stage indicator ("Etapa 2 de 4").

**Emergency:** Card has brick-red left border, 2px. Badge shows "Urgente." Appears with subtle pulse animation while awaiting approval.

**Unrecognized:** Card has flagged warm-brown left border. Badge shows "Para revisar." Slightly inset background to visually separate from normal flow.

---

### 3.3 The Approval Screen

The approval screen is the highest-frequency critical interaction in the product. It is opened from a push notification during a work break. It must complete in under 60 seconds. It must never require scrolling for the core decision.

#### Layout (mobile, modal bottom sheet)

```
┌────────────────────────────────────────┐
│  [Handle bar]                          │
│                                        │
│  [Recipient Avatar]  [Recipient Name]  │
│  [Relationship label: "Tu esposa"]     │
│                                        │
│  ──────────────────────────────────    │
│                                        │
│  [Category Icon]  [Category]           │
│  "[Purpose description in their words]"│
│                                        │
│  $XXX.XX                               │
│                                        │
│  ──────────────────────────────────    │
│                                        │
│  [Plan match indicator]                │
│  "Esto está dentro de tu plan"         │
│                                        │
│  ──────────────────────────────────    │
│                                        │
│  [Approve Button — full width]         │
│  [Not yet — text link]                 │
│                                        │
└────────────────────────────────────────┘
```

**Design rules:**
- Amount is always the largest text element — 40px, `--color-roca`
- Plan match indicator is always present — either reassuring ("Dentro de tu plan") or flagging ("Más alto de lo normal")
- "Not yet" appears as a text link, never a button — to reduce the visual weight of declining
- The recipient's name is human and relational — shows their actual name, not "Recipient"
- Recipient description always uses a relational label ("Tu esposa," "Tu mamá") where known

#### Emergency Approval Screen

The emergency screen has a different register. The copy changes. The layout slows down.

```
┌────────────────────────────────────────┐
│  [Handle bar]                          │
│                                        │
│  [Recipient Name] dice que es urgente  │
│                                        │
│  "[Their exact words]"                 │
│                                        │
│  $XXX.XX                               │
│                                        │
│  ──────────────────────────────────    │
│                                        │
│  [LARGE APPROVE BUTTON — 64px]         │
│  "Aprobar ahora"                       │
│                                        │
│  [Call them first — text link]         │
│                                        │
└────────────────────────────────────────┘
```

The "Call them first" link opens the recipient's phone number. The emergency screen knows this is an emotionally charged moment. It offers a human escape valve.

---

### 3.4 The Transaction History (Feed)

The history view is the product's core transparency feature. It is also the recipient's dignity record. Design it for both perspectives.

**Visual hierarchy:**
- Date headers group transactions by date — "Ayer," "Esta semana," "Hace 2 semanas" (relative dates, not absolute)
- Approved transactions render at full opacity
- Declined transactions render at 60% opacity — present but visually quieter
- Emergency transactions have a subtle left border accent
- Empty states are warm and action-oriented: "Todavía no has enviado nada. Cuando lo hagas, lo verás aquí."

**Filter bar:**
Simple horizontal scroll of filter pills: Todos · Aprobados · Pendientes · Para revisar · Urgentes
Pills use the same status colors as badges. No complex date pickers at MVP.

**Interaction:**
Tapping any transaction opens a detail sheet. Detail sheet includes: full record + "Ask AI about this" button at the bottom.

---

### 3.5 Status Indicators

Status indicators appear throughout: in the header, on cards, in notifications. The system has one rule: never use the same visual treatment for different emotional registers.

| Indicator type | Usage | Visual |
|---|---|---|
| Pulse dot | Emergency awaiting approval | 8px dot, brick color, slow pulse animation |
| Static dot | Connection status | 8px dot, Tierra green, no animation |
| Progress ring | Milestone/investment stage progress | 40px ring, Tierra fill, gold for completed |
| Count badge | Pending approvals | 18px circle, Tierra bg, white number |

**The pulse animation rule:** Pulse animation is used only for Emergency requests. Using it anywhere else degrades the signal. The system must enforce this: if a product team adds pulse to a non-emergency element, it is a design system violation.

---

### 3.6 The AI Companion Entry Point

The AI is not a help section. It is not a chatbot in a modal. It is a persistent, ambient presence — accessible always, never intrusive.

**Entry point:** A small circle in the bottom navigation with a subtle animated indicator (slow breathing effect, 3-second cycle, very low opacity). It should feel alive but quiet.

**When AI proactively initiates:** A small banner appears at the top of the relevant screen — not a notification, not a full modal. Just a soft card: "Parece que esta transacción fue marcada. ¿Quieres que te explique?" The banner can be dismissed by swiping up.

**AI conversation visual style:**
- AI messages use a Tierra Pale background and the system body font
- The tone is conversational — short messages, never paragraphs
- No avatar or robot icon — the AI does not have a face. It is the product's voice.
- Always bilingual — language switches based on user preference, not detection

---

### 3.7 The Money Plan Summary Card

The money plan is the sender's "home base" — their view of what they've agreed to, how it's tracking, and what's next.

```
┌────────────────────────────────────────┐
│  Tu plan                               │
│  [Connected to: Recipient Name] ●      │
│                                        │
│  Vivienda         $400 / mes           │
│  ████████░░       $320 usado           │
│                                        │
│  Comida           $200 / mes           │
│  ████░░░░░░       $80 usado            │
│                                        │
│  Servicios        $120 / mes           │
│  ██████████       $120 usado ✓         │
│                                        │
│  ──────────────────────────────────    │
│  Este mes: $500 / $720 enviado         │
└────────────────────────────────────────┘
```

Progress bars use `--color-tierra` fill on `--color-arena` track. Completed categories show a gold checkmark. Over-budget categories turn the progress bar to the flagged color — no alarm, just a visual signal.

---

## 4. Iconography

### 4.1 Icon Style

All icons use a single style: outline with rounded corners and caps, 2px stroke, 24×24px default grid. The library is custom — not a generic icon set — because the category icons must be instantly culturally legible for this user.

### 4.2 Core Category Icons

| Category | Icon | Notes |
|---|---|---|
| Housing | House outline, simple roof | Not an apartment or skyscraper — a family house |
| Food / Groceries | A bag or simple basket | Not a fork and knife (restaurant) |
| Utilities | A lightning bolt | Simple, universal |
| Business | A simple storefront | Not a briefcase — a small business |
| Emergency | A heart with a pulse line | Warmth, not alarm |
| Savings | A small circle with a ring | Not a piggy bank |
| Unrecognized | A question mark | Simple, non-threatening |

### 4.3 Navigation Icons

Bottom navigation uses 5 tabs: Home, Plan, Send/Request, History, AI.

Icons are 24px, outline style. Active state: filled with Tierra color. Inactive: `--color-text-muted`.

---

## 5. Illustrations

### 5.1 Illustration Style

Illustrations appear in three contexts: onboarding, empty states, and milestone completions. They must be culturally specific and warm — not generic fintech art.

**Style direction:**
- Flat, geometric, slightly rounded forms
- Color palette drawn exclusively from the brand tokens — no new colors introduced
- Subject matter is specific to Guatemala: specific architecture, landscape, and human figures that read as culturally authentic
- Human figures use warm, illustrative proportions — not corporate stock art

### 5.2 Key Illustration Moments

**Onboarding (sender):** A figure looking toward the horizon, a house silhouette in the background. The image of the goal — before anything else.

**Connection confirmed:** Two figures on either side of a border, both reaching toward the same point. The partnership framing, made visual.

**Milestone completion:** The specific investment — a house, a storefront — rendered simply and warmly. This is the product's most important visual moment.

**Empty states:** A simple landscape — land, sky — waiting to become something. Patient and hopeful, not apologetic.

---

## 6. Copy System

The copy system is as much a product decision as the color system. Both are enforced at the same level.

### 6.1 Voice Principles (from behavioral research)

**Friend, not bank.** Every word should sound like a trusted member of the community. Not an institution, not a brand.

**Direct, not corporate.** Short sentences. Active voice. No hedging, no qualifications.

**Guatemalan Spanish, not generic Spanish.** The product is written by — and reviewed by — native Guatemalan Spanish speakers. Not Mexican, not Castilian.

**Transparent, not alarming.** When something goes wrong, copy is honest without being frightening.

### 6.2 Banned Words (enforced system-wide)

The following words must never appear in any product surface — UI strings, notifications, AI responses, error messages, or onboarding:

| Banned | Reason |
|---|---|
| KYC, AML, compliance, regulatory | Bank-speak; alienation signal |
| Rejected, denied | Punitive; damages relationship |
| Suspicious, unusual, alert, warning | Creates institutional anxiety |
| User, account holder, beneficiary, payee | Dehumanizing |
| Submit, proceed | Generic; sounds like paperwork |
| Error: [code] | Exposes system internals |

### 6.3 Required Substitutions

| Instead of | Say |
|---|---|
| "Transaction declined" | "En pausa por ahora" |
| "Flagged for review" | "Esto necesita tu atención" |
| "Emergency transfer requested" | "[Name] dice que es urgente" |
| "Account restricted" | "Algo pasó — hablemos" |
| "Please verify your identity" | "Necesitamos confirmar algo rápido" |
| "Transfer limit exceeded" | "Este es más alto de lo normal" |
| "Error processing request" | "No pudimos procesarlo. Intenta de nuevo." |

### 6.4 High-Stakes Copy (must be designed, not drafted)

**Emergency notification (sender receives):**
> [Name] dice que algo urgente pasó. Necesita $[amount] para [reason]. Toca para ayudar.

**Decline confirmation (recipient receives):**
> [Sender name] quiere hablar sobre este antes de enviarlo. Ya te va a escribir.

**Flagged transaction (sender sees):**
> Este es un poco más alto de lo que tienes para [category]. Puede estar bien — solo quería que lo vieras.

**Milestone complete:**
> ✓ Etapa [N] confirmada. [Name] verificó que [description]. El siguiente paso está listo cuando tú digas.

**First onboarding message (recipient):**
> [Sender name] quiere que los dos tengan un registro claro de para qué es el dinero. Esto es para los dos — no solo para ellos.

---

## 7. Screen Patterns

### 7.1 Navigation Structure

The navigation was redesigned around a core insight: the old structure led with approvals and transactions, which frames the product as a remittance tool. The new structure leads with the immigrant's total financial picture and elevates their goal to the center of the experience. The remittance action is still immediately accessible but is not a tab — it's a persistent action available from the home screen and via a floating button in the history view.

```
Bottom Tab Bar (5 tabs):
├── Inicio (Home)     — full financial picture: US balance, Guatemala activity, goal progress, pending approvals
├── Mi Meta (My Goal) — the investment or goal in detail: milestones, progress, verification status, escrow stages
├── Enviar ↑          — center tab, primary action, elevated visually (Tierra color, larger icon)
├── Historial         — full transaction history, filterable
└── Asistente         — AI companion, ambient entry point
```

**What changed from v1 and why:**

"Plan" was removed as a tab. The money plan is important but it is a management layer, not a destination. It lives inside Inicio (as the category budget view) and Mi Meta (as the investment stage structure). Surfacing it as a top-level tab made the product feel like a budgeting app.

"Mi Meta" replaced "Plan" at position 2. The goal — the house, the land, the business — is the emotional center of the product. It deserves its own tab. When a user opens the app, the second thing they should be able to do is check how close they are to what they came here to build.

**Tab bar visual:**
- Background: `--color-surface-1` (white)
- Top border: 0.5px `--color-border`
- Height: 72px (includes safe area padding)
- Enviar tab: Tierra color icon, slightly larger (28px vs 22px), label in Tierra — it is the most important action
- Active state: Tierra fill icon + Tierra label
- Inactive state: `--color-text-muted` icon and label
- Badge count on Inicio only (pending approvals)

### 7.2 Screen Architecture

The product has three layers of financial information, each corresponding to a different time horizon. The screen structure mirrors this:

| Layer | Time horizon | Screen | Emotional register |
|---|---|---|---|
| Daily operations | This week | Inicio | Calm, efficient, low-anxiety |
| Monthly tracking | This month | Inicio (scroll down) / Plan within Inicio | Informational |
| Life goal | Years | Mi Meta | Aspirational, weighty, ceremonial at milestones |

**Inicio (Home):**
The screen answers: *Where does my money stand right now — here and there?*

Structure (top to bottom):
1. Tierra header: greeting + "Aquí y Allá" — two numbers side by side: US balance (savings available to send) and Guatemala (total sent this month). These two numbers together communicate the full cross-border picture at a glance.
2. Pending approvals pill — compact, not dominant. The number of requests awaiting response.
3. Goal progress card — always present, always below the fold of the header. Shows the named goal, progress bar, amount saved vs. target, and current milestone stage. This card is the product's emotional anchor. It must never be removed from the home screen.
4. Recent activity feed — last 5–7 transactions, reverse chronological. The feed is context, not the headline.

**Mi Meta (My Goal):**
The screen answers: *How close am I to the thing I came here to build?*

Structure:
1. Dark header (Roca) — the goal name, large, proud. Start date. A quieter register than the Tierra home — this is serious, not energetic.
2. Total saved — large number, Oro progress bar, distance to target.
3. Milestones — vertically stacked stages with status: completed (Tierra), in progress (Oro), pending (muted). Each stage shows amount, description, and verification status if applicable.
4. For active stages: an "Update from Guatemala" section showing the most recent photo documentation or milestone note.

**Mis Finanzas (US side — accessible from Inicio):**
The screen answers: *What do I have here, and how is it growing?*

This screen surfaces when the user taps the US balance figure on the home screen. It is a detail view, not a primary tab.

Structure:
1. Tierra header — total US balance, large.
2. Quick actions: Enviar, Agregar funds.
3. Savings breakdown: named savings buckets (Para la casa, Emergencias) with APY shown in Oro. This is the P2 high-yield checking layer — designed in now, fully built at Series A.
4. Monthly summary: sent to Guatemala, saved toward goal, interest earned. Three numbers that tell the full story of the month.

**Historial (History):**
Unchanged in structure — filtered feed. What changes is its role: it is now clearly a ledger, not the product. The user arrives here to investigate or confirm, not to understand their financial life. That job belongs to Inicio and Mi Meta.

**Detail sheet (any transaction):**
Slides up from bottom. Handle bar at top. 90% screen height max. Full transaction record. "Ask the AI about this" button always present at the bottom.

### 7.3 The "Aquí y Allá" Pattern

The most important design decision in the home screen is showing two numbers simultaneously: what the sender has in the US and what is active in Guatemala. No existing financial product does this for this user. Every app they have used treats these as separate financial lives. This product is the first to say: *your money has one story, and it crosses a border.*

This pattern — "Aquí y Allá" — must appear on the home screen header at all times. It is not a feature. It is the product's identity made visual.

**Copy:**
- Left card: "Aquí (EE.UU.)" — savings available
- Right card: "Allá (Guatemala)" — sent this month / active in plan

**Visual treatment:**
- Both cards use the same white-on-Tierra treatment at equal size
- Neither number is styled as "primary" — they are co-equal
- The border between them is implicit (gap), not a divider line

---

## 8. Wealth & Journey Layer Components

These components represent the product's expansion beyond remittance. They are the visual expression of the thesis: this is not a transfer app, it is the financial homebase for the immigrant journey.

### 8.1 The "Aquí y Allá" Header Module

The dual-balance header that appears on the Inicio home screen. Two cards, equal weight, side by side: US balance on the left, Guatemala activity on the right.

**Design rules:**
- Always two cards. Never collapsed to one.
- Equal visual weight. Neither side is "primary."
- US card label: "Aquí (EE.UU.)" — never "US Balance" or "Available funds"
- Guatemala card label: "Allá (Guatemala)" — never "Sent" or "Remittance total"
- Amounts in `--type-amount` (28px, tabular-nums)
- Background: white-at-15%-opacity on Tierra — maintains the brand header while creating card separation
- This module must never be removed or deprioritized. It is the product's identity at the interaction layer.

### 8.2 Goal Progress Card

Appears on the Inicio screen (compact) and Mi Meta screen (expanded). The goal is always named — "Casa en Chimaltenango," not "Investment Goal 1."

**Compact version (Inicio):**
- Card surface, 1px border
- Top row: goal name (heading-2) + current milestone badge (Oro pill)
- Progress bar: 5px height, Oro fill on Arena track
- Bottom row: amount saved vs. target (left) + percentage (right, Tierra color)

**Expanded version (Mi Meta):**
- Full-screen context
- Large total amount (type-amount-large, 40px) in Roca
- Oro progress bar, 8px height, with animation on load
- Distance to target below the bar in muted text
- Milestone stack below (see 8.3)

**Naming rule:** The goal name is always the user's own words — "Mi casa en Chimaltenango," "El negocio de mi mamá," "El terreno de San Marcos." The product never relabels it as a category. The name is set during goal creation and displayed exactly as entered.

### 8.3 Milestone Stack

The visual representation of an investment's stages. Appears on the Mi Meta screen and in the Planned Investment transaction detail.

**Stage states:**

| State | Left border | Icon | Label color | Opacity |
|---|---|---|---|---|
| Completed | Tierra (3px) | ✓ on Tierra-pale circle | text-primary | 100% |
| In progress | Oro (3px) | Stage number on Oro-light circle | text-primary | 100% |
| Pending | Border (1px) | Stage number on Arena circle | text-muted | 50% |
| Verified | Tierra (3px) | ✓ with "Verificado" badge | text-primary | 100% |

**Milestone card anatomy:**
```
[Stage icon]  [Stage name]           [Status badge]
              [Amount · Status · Date]
              [Photo thumbnail if documented]
```

**Rules:**
- Maximum 6 stages per goal (research shows more than 6 creates cognitive overload)
- Completed stages never disappear — they remain visible as history
- The active stage is always fully expanded; pending stages are collapsed at 50% opacity
- Verification status (P1) appears as a badge: "Verificado" in Tierra, "Verificación pendiente" in Oro

### 8.4 Savings Bucket Cards

Appear on the Mis Finanzas screen. Each bucket has a name (user-defined), a balance, and — in P2 — an APY figure shown in Oro.

**Visual treatment:**
- Card surface, 1px border
- Two columns: left (bucket name + goal label), right (balance + APY)
- APY shown in `--color-oro` — it is aspirational, not transactional
- "Para la casa" bucket always appears first if a goal is active
- Empty state: "Todavía no tienes ahorros aquí. ¿Quieres empezar con algo?" — warm, not generic

**APY display rule:** APY is shown in Oro because it represents money growing toward the dream. It must never appear in green (which the system uses for approved transactions) or in the standard text color (which would make it invisible). The color is a semantic choice: gold = growth = closer to the goal.

### 8.5 Monthly Journey Summary

A compact module on the Inicio screen (below the recent feed) and a full view accessible from the home header. Shows the three numbers that tell the month's full story:

1. **Enviado a Guatemala** — total transferred this month
2. **Guardado para la meta** — amount added to goal savings
3. **Rendimientos ganados** — interest earned (P2; shows $0.00 or hidden until P2 is live)

**Design rule:** These three numbers appear in a single card with no charts, no graphs, no trend lines. The PRD is explicit: no complex visualizations at MVP. The summary is a list of three labeled amounts — clean, readable in 3 seconds.

**When to show rendimientos:** Only after P2 high-yield checking is live. Before that, the line does not appear at all — not as $0.00, not as "coming soon." A line that shows nothing erodes trust in the numbers around it.

### 8.6 The Journey Timeline (P2)

A long-form view of the user's complete financial history with the product — from first transfer to current state. Not a transaction list. A narrative.

This component is designed-in now and built at P2. Its existence shapes the data model from day one: every transaction needs a `created_at` timestamp and a `goal_id` foreign key so the timeline can be reconstructed accurately.

**Visual concept:** A vertical timeline where each major event has a marker — first transfer, first recurring schedule set up, first large investment initiated, milestones completed. The user can scroll through the history of their journey. At the bottom: "X years, X months of building toward [goal name]."

**Why this matters:** The product's deepest value is longitudinal — it is there for the entire immigrant financial journey. The timeline is the visual proof of that. It is the product's equivalent of a bank showing you your account history — but instead of debits and credits, it shows progress toward a dream.

---

## 9. Accessibility

### 9.1 Contrast Requirements

All text meets WCAG 2.1 AA minimum:
- Body text on white: `--color-text-secondary` (#4A4A4A) on white = 9.6:1 ✓
- Muted text: `--color-text-muted` (#888885) on white = 4.6:1 ✓ (just above AA for large text)
- Inverse text on Tierra: white on `--color-tierra` = 7.2:1 ✓

### 9.2 Touch Targets

Minimum tap target: 44×44px for all interactive elements. Emergency Approve button: 64px height with full-width. All category icons in approval flow: 48×48px.

### 9.3 Text Scaling

All font sizes use rem. The system supports OS-level text scaling up to 200% without layout breakage. Amount displays use `font-variant-numeric: tabular-nums` to maintain alignment at any scale.

### 9.4 Reduced Motion

All animations respect `prefers-reduced-motion`. When motion is reduced: pulse animations become static dots, spring animations become instant state changes, sheet transitions become cross-fades.

---

## 10. Localization

### 10.1 Language Priority

Spanish is first-class. All design decisions are validated in Spanish first. English strings are derived from Spanish — not the reverse.

### 10.2 String Length Allowances

Spanish strings run 20-30% longer than English equivalents. All UI components must accommodate this. Buttons must not clip at Spanish string lengths. Cards must allow 2-line descriptions without breaking layout.

### 10.3 Number and Currency Formatting

| Context | Format |
|---|---|
| USD amounts | $1,200.00 |
| GTQ amounts | Q 1,200.00 |
| Large amounts | $15,000 (no decimals for thousands) |
| Percentages | 85% (no decimal) |
| Dates (Spanish) | "Ayer," "Hace 3 días," "12 de agosto" |

---

## 11. Channel Architecture

This is the most important structural decision in the product. It defines what the app is, what WhatsApp and SMS are, and how they relate. Everything else in the design system descends from it.

### 11.1 The Three-Channel Model

The product operates across three surfaces simultaneously. Each has a distinct role. None is optional.

| Channel | Primary user | Role | What it does |
|---|---|---|---|
| **The app** | Sender | Administration | Full financial picture — balances, goal progress, plan management, history, AI. Where the sender *understands* their money. |
| **WhatsApp** | Both | Transactions | Request, approve, confirm, notify. Neither party needs the app to participate in a transaction. |
| **SMS** | Both (fallback) | Transactions | Identical to WhatsApp for users without WhatsApp or data. Critical for recipient connectivity in rural Guatemala. |

**The governing principle:** The app is additive, not required. Everything that can happen in the app can also happen on WhatsApp or SMS — but with less context and less history. A sender who only uses WhatsApp is still a full product participant. A sender who uses the app gets the full financial picture that makes every WhatsApp interaction more informed.

### 11.2 What Each Channel Handles

#### The App (sender primary)

The app is the sender's financial homebase. It handles everything that requires context, history, or administration:

- Full balance view (US savings + Guatemala activity)
- Goal progress and milestone tracking
- Plan creation and category management
- Complete transaction history
- AI companion — explanations, mediation, plan suggestions
- Verification report viewing (P1)
- Escrow stage management (P1)
- Savings bucket management (P2)

The app does not require the recipient to have it. A sender can administer their entire financial life from the app while the recipient participates entirely through WhatsApp.

#### WhatsApp (both sides, primary transaction channel)

WhatsApp is where transactions happen for both parties. It is not a notification layer — it is a full transaction surface.

**Recipient can via WhatsApp:**
- Request a transfer ("Necesito Q400 para el mercado")
- Mark a request as urgent
- Confirm a milestone is complete
- Upload a photo as documentation
- Ask the AI a question about their plan

**Sender can via WhatsApp:**
- Approve or decline a request (one tap on a button in the message)
- Initiate a transfer to the recipient
- Check their current balance
- Get a summary of recent activity
- Approve an emergency with one tap

**WhatsApp message design rules:**
- Every message is in Spanish by default
- Actionable messages include inline buttons (WhatsApp Business API button templates) — never ask the user to type a response
- Approval buttons: [✓ Aprobar] [Ahorita no] — always in this order, always these exact labels
- Emergency messages use a distinct format: recipient name first, amount, their words in quotes, single approve button
- The AI responds through WhatsApp in the same voice as the in-app AI — same tone, same language, same rules
- No message ever contains the words on the banned list (Section 6.2)
- Messages never exceed 3 lines of body text before the action buttons — brevity is mandatory on mobile

**WhatsApp message templates (enforced):**

*Standard request (recipient → sender):*
```
María pidió $95 para comida.
"Para el mercado de la semana y leche para los niños"
✓ Dentro de tu plan

[Aprobar]  [Ahorita no]
```

*Emergency request (recipient → sender):*
```
María dice que es urgente.
"$140 para medicamento de mamá — necesito hoy"

[Aprobar ahora]  [Llamarla]
```

*Approval confirmation (sender → recipient):*
```
Carlos aprobó tu pedido de $95.
El dinero llega en unos minutos.
```

*Decline notification (sender → recipient):*
```
Carlos quiere hablar sobre este antes de enviarlo.
Ya te va a escribir.
```

*Milestone update request (system → recipient):*
```
¿Cómo va la etapa 2 de la casa?
Manda una foto o escribe una actualización.
Carlos la puede ver desde la app.

[Mandar foto]  [Escribir update]
```

*Weekly digest (system → sender):*
```
Esta semana todo fue al plan.
$320 enviados · 4 pagos aprobados

[Ver detalles en la app →]
```

#### SMS (fallback for both)

SMS is the safety net for users without WhatsApp or in areas with limited data. It mirrors WhatsApp functionality with one constraint: no inline buttons. Actions are triggered by reply keywords.

**SMS reply keywords (enforced, single words only):**

| Keyword | Action |
|---|---|
| `SI` | Approve the pending request |
| `NO` | Decline / hold the pending request |
| `URGENTE` | Recipient flags a request as emergency |
| `AYUDA` | Triggers AI response with plain-language explanation |
| `RESUMEN` | Sender receives weekly summary |

Keywords work in Spanish only. They are case-insensitive. Any unrecognized reply triggers: *"Responde SI para aprobar o NO para esperar. Escribe AYUDA si necesitas explicación."*

### 11.3 The Graduation Path

Recipients begin as WhatsApp/SMS participants. They can graduate to the full app at any point — and the product should make this feel like a natural upgrade, not a requirement.

**Graduation triggers (system offers app download when):**
- Recipient has completed 3+ successful transactions through WhatsApp
- Recipient is managing an active construction milestone (photo uploads become easier in-app)
- Recipient expresses interest in sending money themselves
- Sender has been using the app for 60+ days (stable relationship established)

**Graduation message (WhatsApp → recipient):**
```
Ya llevas 3 meses manejando el plan con Carlos.
Si quieres ver todo desde la app — el historial,
las etapas, lo que viene — te lo ponemos fácil.

[Descargar la app]  [Seguir por WhatsApp]
```

No pressure. Always optional. "Seguir por WhatsApp" is always available and always valid.

**Once in the app, the recipient sees a role-switched view:**
- Their transaction history (what they've requested and received)
- The shared plan (read-only at first, co-editable at P1)
- Their milestone documentation (photos they've uploaded)
- The AI companion in the same voice they know from WhatsApp
- A "Quiero empezar a enviar" path that begins the sender onboarding flow

### 11.4 Channel Design Rules (enforced across all surfaces)

These rules apply everywhere — app, WhatsApp, and SMS — without exception:

1. **Same copy system, every channel.** The banned word list (Section 6.2) and the required substitutions apply to WhatsApp messages and SMS strings exactly as they apply to app copy. No channel gets a different voice.

2. **The sender's approval is always one action.** Whether from the app, a WhatsApp button, or an SMS reply of "SI" — approving a request is always a single action. Never two steps. Never a confirmation screen on WhatsApp.

3. **Emergency always bypasses normal flow.** On every channel, emergency requests surface immediately and differently. WhatsApp emergency messages use a distinct template. SMS emergency messages are prefixed with the recipient's name in capitals.

4. **The AI is present on every channel.** The AI companion is not an app-only feature. It responds on WhatsApp and SMS too. WhatsApp: full message responses. SMS: short, keyword-triggered explanations. Same voice, same rules, same language.

5. **No channel requires the other.** A recipient who never downloads the app is a full product participant. A sender who prefers WhatsApp for approvals and uses the app only for their financial overview is a full product participant. The channels are additive — not dependent.

---

## 12. Recipient Experience

The recipient is not a downstream user. They are an active participant in the product across all three channels. The design system must account for their experience as explicitly as it accounts for the sender's.

### 12.1 Recipient Modes

Recipients exist in one of two modes, and the design must serve both:

| Mode | Channel | What they can do |
|---|---|---|
| **WhatsApp/SMS native** | WhatsApp or SMS only | Request funds, mark urgent, confirm milestones, upload photos, ask AI |
| **App participant** | App (role-switched) | Everything above + full history, plan view, documentation gallery, graduation to sender |

### 12.2 Recipient WhatsApp Experience

This is the default recipient experience at launch. It must feel like a natural extension of how they already communicate — not like using a financial product.

**Design rules for recipient-facing WhatsApp:**
- Messages open with the sender's name, not the product name. "Carlos" not "Tu plan" not "[App name]"
- Every request confirmation shows what was approved and when the money arrives — not a transaction ID
- Photo upload flow: one message asks for a photo, one message confirms receipt. Never more than two steps.
- If the recipient sends a free-text message (not a keyword), the AI interprets it and responds. "Cuánto me queda para comida este mes" gets a real answer, not an error.
- Weekly plan summary is sent to the recipient too — not just the sender. Their version: what they received, what categories were used, what's available this month.

**Recipient weekly summary (WhatsApp):**
```
Esta semana, Carlos:
✓ Aprobó $85 para comida
✓ Aprobó $60 para servicios
⏳ Todavía está revisando el de $650

[Ver historial completo →]
```

### 12.3 Recipient App View (role-switched)

When a recipient downloads the app, they see a different home screen than the sender. Same design system, same tokens, same components — different information architecture.

**Recipient home screen structure:**
1. **Header:** Their name + "Lo que han construido juntos" — not a balance, not a number. A relational statement.
2. **This month:** What was received, by category. Clean list, no charts.
3. **Tu registro:** Their documentation — photos uploaded, milestones confirmed, notes sent. This is their dignity record. The system makes it easy to see and share.
4. **La meta:** The shared goal, shown from their perspective — what they're managing on the ground, what's next.

**What the recipient does NOT see in the app:**
- The sender's US balance or savings
- The sender's full transaction history of their own US finances
- Any screen that positions them as being monitored

**What they DO see:**
- Everything related to transactions between them and the sender
- Their own documentation history
- The shared plan and goal
- The AI companion

### 12.4 Role Graduation — Recipient to Sender

When a recipient becomes a sender (they move to the US, they start sending money to family themselves), the transition must feel earned and natural — not like starting over.

**Graduation flow:**
- Recipient taps "Quiero empezar a enviar" in the app
- The product acknowledges their history: "Llevas X meses en esto. Ahora es tu turno de llevar el plan."
- Sender onboarding is abbreviated — they already know how the product works, they've seen it from the other side
- Their existing transaction history carries over — they can see both their recipient history and their new sender history in one timeline
- Their relationship with the original sender can be preserved (they can become co-participants in the same plan, or create their own separate plan)

**Copy for graduation moment:**
> "Ya conoces cómo funciona esto. Ahora te toca a ti."

Not: "Complete sender verification to unlock sending features."

---

## 13. Error States & Empty States

The behavioral research is unambiguous: one confusing error screen and the user deletes the app. They will not call support. They will go back to WhatsApp. Error and empty states are not edge cases — they are high-stakes product moments that require the same design care as the approval flow.

### 13.1 Design Rules for All Error States

1. **Never show a technical error message to the user.** No error codes, no stack traces, no "something went wrong" without telling them what to do next.
2. **Always give a next step.** Every error state must answer: what should I do now?
3. **Never use the banned word list.** Error states are where institutional language is most tempting and most damaging.
4. **Errors on WhatsApp and SMS follow the same rules.** A failed transaction on WhatsApp gets a warm, plain-language message — not a system error string.
5. **Recovery must be one tap.** If a transaction fails, the recovery action (try again, contact support, ask AI) must be reachable in one tap from the error state.

### 13.2 Error State Vocabulary

| Situation | Don't say | Say instead |
|---|---|---|
| Transfer failed | "Transaction failed. Error 4021." | "No pudimos enviarlo. Intenta de nuevo o escríbenos." |
| Network error | "Connection timeout. Please retry." | "Sin señal por un momento. Todo sigue guardado — intenta cuando tengas conexión." |
| Request declined by system | "Your request was denied." | "Este pedido necesita revisión. Carlos lo va a ver pronto." |
| Payment partner error | "Service unavailable." | "Hay una pausa del lado del banco. En unos minutos debería estar listo." |
| Session expired | "Your session has expired. Please log in again." | "Por seguridad cerramos tu sesión. Entra de nuevo — tarda un segundo." |
| Verification failed | "Identity verification failed." | "Necesitamos confirmar algo antes de continuar. El asistente puede ayudarte." |
| Photo upload failed | "Upload failed." | "No se subió la foto. Intenta de nuevo — si no funciona, mándala por WhatsApp." |

### 13.3 Error State Visual Treatment

All error states share a consistent visual pattern:

```
[Warm icon — never a red X or warning triangle]

[What happened — one sentence, plain language]

[What to do — one sentence, specific action]

[Primary action button]
[Secondary: Ask AI]
```

**Icon rules for error states:**
- Network/connectivity: cloud with a line through it (neutral, not alarming)
- Payment failure: a clock (implies temporary, not broken)
- Verification needed: a simple lock (neutral, not a warning sign)
- Generic: a simple wave or pause symbol

Never: red X, warning triangle, exclamation mark in a circle. These are institutional alarm signals. This product does not alarm — it informs.

### 13.4 Empty States

Empty states are the first impression for new users and the resting state between activity. They must be warm and action-oriented — never a blank screen, never a generic "Nothing here yet."

| Screen | Empty state copy | Action |
|---|---|---|
| Transaction history (new user) | "Cuando envíes tu primer pago, lo vas a ver aquí. Todo queda guardado." | [Enviar ahora] |
| Transaction history (recipient, new) | "Aquí vas a ver todo lo que Carlos te ha enviado y para qué fue." | [Pedir algo] |
| Goal / Mi Meta (no goal set) | "¿Para qué estás ahorrando? Ponle nombre a lo que estás construyendo." | [Crear mi meta] |
| Plan (no categories set) | "Todavía no tienen un plan. Tarda 3 minutos — y los dos se van a entender mejor." | [Hacer el plan] |
| Notifications (all caught up) | "Todo al día. No hay nada esperando tu atención." | — |
| Search / filter (no results) | "No encontramos nada con ese filtro. Prueba con otro." | [Ver todo] |

**Empty state visual treatment:**
- Simple illustration (single color, Tierra Pale) — landscape or single object, never people in ambiguous situations
- Headline in `--type-heading-2`, `--color-text-primary`
- Description in `--type-body`, `--color-text-secondary`
- Single CTA button (Primary variant) — always present, always specific
- No secondary action on empty states — one path forward only

### 13.5 Error States on WhatsApp and SMS

Failed transactions and errors on WhatsApp and SMS need their own defined responses. These are not app screens — they are message templates.

**WhatsApp — transfer failed:**
```
No pudimos enviar el pago de $95 esta vez.
Todo sigue guardado. Intenta de nuevo en unos minutos.

[Intentar de nuevo]  [Hablar con el asistente]
```

**SMS — transfer failed:**
```
No pudimos enviar el pago. Todo sigue guardado.
Responde REINTENTAR para volver a intentar
o AYUDA si necesitas explicación.
```

**WhatsApp — no response from sender (emergency, 30 min elapsed):**
```
Carlos no ha respondido todavía.
¿Quieres que le mandemos un recordatorio?

[Sí, recuérdalo]  [Esperar un poco más]
```

---

## 14. Onboarding Patterns

Onboarding is split into two completely separate experiences: one for senders, one for recipients. They share the same design system and copy voice but have different structures, different motivations, and different drop-off risks.

### 14.1 Sender Onboarding

The sender chose to download this app. They are motivated. The job of sender onboarding is to get them to their first meaningful action — seeing their financial picture or approving their first request — as fast as possible.

**Guiding principle:** Show value before asking for anything.

**Flow:**

```
Screen 1 — What this is (30 seconds)
  "No eres el primero en perder el control de tu dinero cuando cruza la frontera.
   Esto es para que eso no vuelva a pasar."
  [Empezar]

Screen 2 — Your goal (60 seconds)
  "¿Para qué estás mandando dinero a casa?"
  [Casa o terreno] [Negocio] [Familia] [Ahorros] [Todo lo anterior]
  → They name their goal. This is the emotional hook. Not a category selection.

Screen 3 — Who receives it (60 seconds)
  "¿Quién maneja el dinero allá?"
  Name + relationship + phone number (WhatsApp or SMS)
  → We send them an invite immediately. The sender sees: "Le mandamos un mensaje a María."

Screen 4 — Your plan (90 seconds)
  "¿Cuánto mandas más o menos cada mes?"
  Simple sliders or amounts per category — pre-filled with regional averages as suggestions
  → The plan is created. Not configured. Created.

Screen 5 — Connect your money (variable)
  Link bank account or debit card for sending
  → This is the only step that feels like a bank. The copy must compensate:
  "Para poder mover el dinero, necesitamos conectar tu cuenta. Es lo único que le pedimos al banco."

Screen 6 — You're ready
  "Todo listo. Cuando María pida algo, te va a llegar por WhatsApp."
  → First notification preview shown. They know exactly what to expect.
```

**Sender onboarding rules:**
- Maximum 6 screens. Each screen has one job.
- Progress indicator visible throughout (step X of 6) — never hide progress from an anxious user
- Every screen has a "Guardar y continuar después" escape — setup saves at every step
- No verification required before screen 5 — value first, friction last
- Total time target: under 4 minutes for a motivated user
- If they abandon: the next WhatsApp message from the product picks up where they left off

### 14.2 Recipient WhatsApp Onboarding

The recipient did not choose this. They received a WhatsApp message from someone they trust. Their onboarding is entirely within WhatsApp — no app download, no form, no friction.

**Guiding principle:** The first message they receive must make them feel included, not enrolled.

**WhatsApp onboarding flow:**

```
Message 1 — The invitation (from sender's name, not product name)
  "Carlos quiere que los dos tengan un registro claro de para qué es el dinero.
   Esto es para los dos — no solo para él.
   ¿Quieres ver cómo funciona? Tarda 2 minutos."

  [Sí, ver cómo funciona]  [Preguntarle a Carlos primero]

Message 2 — What they can do (if they tap yes)
  "Desde aquí puedes:
   → Pedir dinero con una razón clara
   → Marcar algo como urgente si es necesario
   → Ver lo que Carlos ya te ha enviado
   ¿Empezamos con algo pequeño para probar?"

  [Sí, probemos]  [Tengo una pregunta]

Message 3 — First test request (guided)
  "¿Cuánto necesitas y para qué?
   Escribe algo como: '85 para el mercado de esta semana'"
  → AI parses their natural language response into a structured request
  → Sends to Carlos for approval
  → When Carlos approves, they receive the confirmation

Message 4 — Confirmation (after first approval)
  "Carlos aprobó tu pedido. El dinero llega en unos minutos.
   Ya quedó guardado en el registro de los dos."
```

**Recipient WhatsApp onboarding rules:**
- The invitation message comes from the sender's name in the WhatsApp header — not the product name
- Never more than 2 options per message — WhatsApp button limit is 3, but 2 is cleaner and less confusing
- "Preguntarle a Carlos primero" is always a valid option — it respects their agency
- Natural language input is accepted everywhere — the AI parses it, not the user
- The flow completes when their first request is approved — that is the moment the system "works" for them
- No personal data collected in this flow beyond their phone number (already known from WhatsApp)

### 14.3 Recipient App Onboarding (graduated users)

When a WhatsApp recipient chooses to download the app, their onboarding is abbreviated. They already know how the product works — they've been using it.

**Flow:**

```
Screen 1 — Welcome back, differently
  "Ya conoces esto. Ahora lo tienes todo en un lugar."
  [Their transaction history is shown immediately — not a blank app]

Screen 2 — What's new in the app
  Three things they can do here that they can't on WhatsApp:
  "Ver todo el historial · Subir fotos más fácil · Ver las etapas de la meta"
  [Entendido]

Screen 3 — Optional: Want to send money too?
  "Si en algún momento quieres empezar a enviar,
   ya sabes cómo funciona todo.
   Por ahora, todo sigue igual."
  [Me interesa más adelante]  [Empezar ahora]
```

Total: 3 screens. Under 90 seconds. No re-verification if their phone number is already confirmed via WhatsApp.

### 14.4 Onboarding Drop-off Recovery

Both sender and recipient onboarding must have defined recovery paths for users who abandon mid-flow.

| Abandoned at | Recovery message (WhatsApp/SMS) | Timing |
|---|---|---|
| Sender — before goal screen | "¿Sigues queriendo proteger tu dinero en Guatemala? Guardamos tu lugar." + deep link | 24 hours |
| Sender — before plan screen | "Ya casi. Solo falta decirle al sistema cuánto mandas cada mes." + deep link | 4 hours |
| Sender — before bank connection | "El plan está listo. Solo falta conectar la cuenta para poder mover el dinero." + deep link | 2 hours |
| Recipient — didn't respond to invite | "Carlos todavía te está esperando. Cuando quieras, esto tarda 2 minutos." | 48 hours |
| Recipient — abandoned after message 1 | "¿Tienes alguna pregunta sobre cómo funciona? Escribe lo que quieras saber." | 24 hours |

Recovery messages are sent once only. If there is no response after recovery, the system waits — it does not send a third message. Pressure destroys the relationship.

---

## 15. Open Questions

These are the remaining decisions that require founder input before the design system is fully locked. All other questions from the original list have been resolved.

| Question | Impact | Status |
|---|---|---|
| Final product name | Wordmark, all brand references, WhatsApp sender name | TBD — needed before any user-facing launch |
| Does the AI have a name or persona? | Onboarding, AI entry point, WhatsApp header name for AI messages | TBD — founder decision |
| Dark mode at launch? | Doubles token work and QA — recommend deferring to post-MVP | Recommend: no |
| P1 investment/escrow visual treatment | New card types, milestone release screen, verifier report format | Needed before P1 build begins |

---

*This document is the design foundation for all product work. Every component, screen, and copy decision descends from the principles and tokens defined here. Changes to any section require design review — especially the copy system, channel architecture (Section 11), and semantic color tokens, which are behavioral decisions as much as visual ones.*

---

**Files in this system:**
- `design-system.md` — this document (system specification)
- `design-system-visual.html` — interactive token reference (see attached)
