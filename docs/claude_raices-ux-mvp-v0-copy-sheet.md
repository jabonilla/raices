# Raíces — UX MVP v0: Copy Sheet

**Figma:** https://www.figma.com/design/Ri7igRdNpYRsGvoLw9v1Cy
**Built from:** `design-system.md` (Raíces product system — Tierra, Plus Jakarta Sans + Inter, warm neutrals)
**Scope:** Sender side, 4 screens. Spanish-first, Guatemalan register.

---

## Screen copy inventory

### 01 · Inicio

| Element | Copy | Note |
|---|---|---|
| Greeting | Buenos días, Carlos | Name, not "Usuario" |
| Date | Miércoles, 26 de agosto | |
| Balance left | Aquí (EE.UU.) / $1,240.00 / disponible para enviar | Never "US Balance" |
| Balance right | Allá (Guatemala) / $500.00 / enviado este mes | Never "Remittance total" |
| Pending pill | 2 pedidos esperando tu respuesta | "pedidos", not "solicitudes pendientes" |
| Goal card | Casa en Chimaltenango · Etapa 2 de 4 · $8,400 de $15,000 · 56% | User's own words for the goal |
| Section | Actividad reciente | |
| Tx status | ✓ Enviado / Para revisar | Never "Aprobado"/"Marcado" |
| Tabs | Inicio · Mi Meta · Enviar · Historial · Asistente | |

### 02 · Aprobación (bottom sheet)

| Element | Copy | Note |
|---|---|---|
| Recipient | María / Tu esposa | Relational label, never "Beneficiario" |
| Category | 🛒 Comida | |
| Purpose | "Para el mercado de la semana y leche para los niños" | Her exact words, in quotes |
| Amount | $95.00 | 40px, largest element on screen |
| Plan match | ✓ Esto está dentro de tu plan · $105 disponibles en Comida | Always present, reassuring or flagging |
| Primary | Aprobar $95.00 | Names the amount, not "Confirmar" |
| Secondary | Ahorita no | Text link, never a button |

### 03 · Mi Meta

| Element | Copy | Note |
|---|---|---|
| Title | Casa en Chimaltenango | |
| Subtitle | Empezaste en marzo de 2025 | Second person, not "Fecha de inicio" |
| Total | Ahorrado hasta hoy / $8,400 | |
| Remaining | Faltan $6,600 para los $15,000 | Distance framed as progress, not deficit |
| Stage 1 | ✓ Terreno comprado · $4,000 · 12 de marzo · **Verificado** | |
| Stage 2 | 2 Cimientos y bloques · $4,400 de $5,000 · foto de María el lunes · **En curso** | Names who documented it |
| Stage 3 | 3 Paredes y techo · $3,500 · cuando termine la etapa 2 | 50% opacity |
| Stage 4 | 4 Acabados · $2,500 | 50% opacity |

### 04 · Historial

| Element | Copy | Note |
|---|---|---|
| Title | Historial | |
| Filters | Todos · Aprobados · Pendientes · Para revisar | Horizontal scroll |
| Date groups | Ayer · Esta semana · Hace 2 semanas | Relative, never absolute |
| Emergency | 🚨 Emergencia · Medicamento para mamá · **Urgente** | Brick left border, 3px |
| Declined | 💼 Negocio · **En pausa** · 60% opacity | Never "Rechazado" |

---

## Copy alternatives worth testing

| Element | A (shipped) | B | C |
|---|---|---|---|
| Pending pill | 2 pedidos esperando tu respuesta | María te pidió 2 cosas | Tienes 2 pedidos |
| Approve CTA | Aprobar $95.00 | Mandar $95.00 | Sí, mandarlo |
| Decline link | Ahorita no | Espérate tantito | Hablemos primero |
| Plan match | Esto está dentro de tu plan | Todo normal esta semana | Te queda $105 en Comida |
| Remaining | Faltan $6,600 para los $15,000 | Vas por más de la mitad | 56% de la casa |

**Why A wins in each case:** it names the specific thing (amount, person, category) rather than describing a state. "Aprobar $95.00" survives being read on a lock screen in ten seconds; "Confirmar" does not. "Ahorita no" is the phrase a person actually uses — it defers without refusing, which is exactly the emotional job the decline path has to do.

---

## Banned-word check

Clean against `design-system.md` §6.2. No instance of: rechazado, denegado, sospechoso, alerta, usuario, beneficiario, enviar (as "submit"), verificación de identidad, or any error code.

One flag: **"Verificado"** on stage 1 sits close to institutional language. It reads as *someone confirmed this with their own eyes*, not *the system validated you* — but it is worth a native-speaker check before it ships.

---

## Localization notes

- Spanish strings run 20–30% longer than English. Every card in the file uses FILL sizing and wraps — none clip. Verified at Spanish length.
- "Ahorita" is Guatemalan/Mexican register. It does not carry the same meaning in Castilian or Rioplatense Spanish. If the market widens past Guatemala, this string needs a per-country variant.
- Amounts are USD throughout. Recipient-side screens will need GTQ (`Q 1,200.00`) with the conversion shown, not hidden.
- Relational labels ("Tu esposa") must be user-entered, never inferred. There is no safe default.

---

## Gaps before this is buildable

| Gap | Why it matters |
|---|---|
| Product name | The wordmark slot is empty on every screen |
| Category icons | Emoji stand-ins are placeholders — the DS calls for a custom 2px outline set |
| Emergency approval screen | Highest-stakes screen in the product, not yet drawn |
| Empty states | Four of them are specified in the DS and none are in the file |
| Recipient-side views | The whole other half of the product |

---

## 05 · Asistente (added)

Two artboards: `05a · Asistente — Wireframe` (with a numbered annotation column) and `05b · Asistente — UI`.

The screen is shaped by one constraint from PRD-v2 Feature 9: **the AI has no write access.** It cannot initiate, approve, or modify anything, it does not query the ledger, and it cannot restate a number it was not handed. That is not a backend detail — it is the whole design brief. A user who has been quietly overcharged for years will test this thing, and the first invented number loses them permanently.

### Copy

| Element | Copy | Note |
|---|---|---|
| Title | Asistente | |
| Language toggle | Español / English | Always visible. Never detected — DS §3.6 |
| Scope line | Te explico lo que pasa con tu dinero. Moverlo siempre lo decides tú. | States the no-write boundary as the user's power, not the AI's limit |
| AI greeting | Buenos días, Carlos. ¿Qué quieres saber? | |
| User | ¿Por qué el pago de $120 salió para revisar? | |
| AI answer | No cae en ninguna categoría de tu plan y el lugar no lo reconocemos. Nadie ha dicho que esté mal — solo falta confirmarlo. | 2 lines. No "sospechoso", no "inusual", no "marcado por el sistema" |
| Reference card | ❓ Sin categoría · $120.00 · Hace 5 días · **Ver el pago →** | The AI cites the real record and links out. It never recomputes |
| User | ¿Y cuánto le llega a María en quetzales? | |
| AI refusal | Ese dato no lo tengo aquí. El tipo de cambio te lo muestra la pantalla de envío, antes de que confirmes nada. | Deterministic. PRD-v2 requires refusing FX quotes outright |
| Suggestions | ¿Cuánto me queda para comida? · ¿Cómo cambio mi plan? · ¿Qué pasa si digo que no? | Horizontal scroll, above the input so they survive the first exchange |
| Input | Escribe tu pregunta… | "Pregunta", not "comando" — the AI answers, it does not act |

### The refusal is the most important string on the screen

Most assistants hide the boundary and hope nobody finds it. This one shows it in the second exchange, and hands the user somewhere real to go instead. Two reasons it earns its place: the FX question is one a sender actually asks, and it is on the PRD's adversarial eval list as a mandatory refusal. Designing the refusal now means the eval has a UI to test against.

Worth a native-speaker check: **"Nadie ha dicho que esté mal"** is doing delicate work — it has to reassure without promising the payment is fine.

### Alternatives

| Element | A (shipped) | B | C |
|---|---|---|---|
| Scope line | Moverlo siempre lo decides tú | Yo explico, tú decides | Solo te explico — no muevo dinero |
| AI refusal | Ese dato no lo tengo aquí | No manejo tipos de cambio | Eso te lo dice la pantalla de envío |
| Input | Escribe tu pregunta… | Pregúntame lo que sea | ¿En qué te ayudo? |

C on the scope line is more direct but leads with the negative. B on the refusal sounds like a policy; A sounds like a person who does not have the file in front of them, which is the truth.

### Still open

The DS lists "does the AI have a name or persona?" as a founder decision. The screen is built assuming **no** — no avatar, no name, a breathing dot and Tierra Pale as the only authorship signal. If a name gets adopted later, the header is the only thing that changes.
