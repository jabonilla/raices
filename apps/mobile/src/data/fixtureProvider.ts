import type { ScreenDataProvider } from "./provider";
import type {
  ApprovalData,
  AssistantData,
  GoalData,
  HistoryData,
  HomeData,
  RelationshipItem,
  RelationshipsData,
} from "./types";

/**
 * Fixture provider (K2.24): realistic Spanish-language sample data for the
 * five screens. Used in development and tests via
 * `<ScreenData provider={fixtureProvider}>`.
 *
 * Amounts are preformatted opaque strings copied verbatim from the copy
 * sheet era — this module never formats money (issue #12).
 *
 * The default fixture mirrors the content the static shells showed before
 * the data layer existed, so the pre-K2.24 screen tests keep asserting the
 * same strings. `uglyFixtureProvider` (below) carries the stress cases:
 * screens that only look right with tidy data are not done.
 */

/** ISO-8601 instant `n` days before now. Fixture dates stay relative so the */
/** invitation-expiry states (K2.27) are deterministic whenever rendered. */
function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

/** P2.2 invitation expiry: invitedAt + 14 days (db/migrations/0004). */
function expiresAtISO(invitedAtISO: string): string {
  return new Date(new Date(invitedAtISO).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
}

function relationship(
  id: string,
  displayName: string,
  phoneE164: string,
  status: RelationshipItem["status"],
  invitedDaysAgo: number,
): RelationshipItem {
  const invitedAtISO = daysAgoISO(invitedDaysAgo);
  return { id, displayName, phoneE164, status, invitedAtISO, expiresAtISO: expiresAtISO(invitedAtISO) };
}

/**
 * Relationship fixtures (K2.27): one of every status, an invited
 * relationship with time remaining, an expired invitation with a resend
 * action, and one person ("Mamá", +502 5550 1111) in TWO relationships —
 * the UI must never assume one sender per recipient.
 */
function fixtureRelationships(): RelationshipsData {
  return {
    relationships: [
      relationship("rel-1", "Mamá", "+50255501111", "active", 60),
      relationship("rel-2", "Tío Jorge", "+50255502222", "invited", 2),
      relationship("rel-3", "Prima Ana", "+50255503333", "invited", 20),
      relationship("rel-4", "Hermano Luis", "+50255504444", "paused", 90),
      relationship("rel-5", "Vecino Pedro", "+15025550555", "terminated", 120),
      relationship("rel-6", "Mamá", "+50255501111", "paused", 200),
    ],
  };
}

export const fixtureProvider: ScreenDataProvider = {
  getHomeData(): HomeData {
    return {
      greetingName: "Carlos",
      dateText: "Miércoles, 26 de agosto",
      balances: [
        {
          label: "Aquí (EE.UU.)",
          amountText: "$1,240.00",
          sub: "disponible para enviar",
        },
        {
          label: "Allá (Guatemala)",
          amountText: "$500.00",
          sub: "enviado este mes",
        },
      ],
      pendingCount: 2,
      goalCard: {
        title: "Casa en Chimaltenango",
        stageText: "Etapa 2 de 4",
        savedAmountText: "$8,400",
        totalAmountText: "$15,000",
        percent: 56,
      },
      recentActivity: [
        {
          category: "housing",
          categoryLabel: "Vivienda",
          status: "approved",
          amountText: "$400.00",
          purpose: "Renta de marzo",
          timestamp: "Ayer",
        },
        {
          category: "unrecognized",
          categoryLabel: "Sin categoría",
          status: "flagged",
          amountText: "$120.00",
          purpose: "Pago sin categoría",
          timestamp: "Ayer",
          tier: "unrecognized",
        },
      ],
    };
  },

  getApprovalData(): ApprovalData {
    return {
      recipientName: "María",
      relationship: "Tu esposa",
      categoryLabel: "Comida",
      purpose: "“Para el mercado de la semana y leche para los niños”",
      amountText: "$95.00",
      planMatchText: "✓ Esto está dentro de tu plan",
      planAvailableText: "$105",
    };
  },

  getGoalData(): GoalData {
    return {
      title: "Casa en Chimaltenango",
      subtitle: "Empezaste en marzo de 2025",
      savedAmountText: "$8,400",
      remainingAmountText: "$6,600",
      totalAmountText: "$15,000",
      progressPercent: 56,
      stages: [
        {
          name: "Terreno comprado",
          detail: "$4,000",
          meta: "12 de marzo",
          badge: "Verificado",
          done: true,
          upcoming: false,
        },
        {
          name: "2 Cimientos y bloques",
          detail: "$4,400 de $5,000",
          meta: "foto de María el lunes",
          badge: "En curso",
          done: false,
          upcoming: false,
        },
        {
          name: "3 Paredes y techo",
          detail: "$3,500",
          meta: "cuando termine la etapa 2",
          done: false,
          upcoming: true,
        },
        {
          name: "4 Acabados",
          detail: "$2,500",
          done: false,
          upcoming: true,
        },
      ],
    };
  },

  getHistoryData(): HistoryData {
    return {
      groups: [
        {
          title: "Ayer",
          items: [
            {
              category: "emergency",
              categoryLabel: "Emergencia",
              status: "emergency",
              amountText: "$85.00",
              purpose: "Medicamento para mamá",
              timestamp: "Ayer",
              tier: "emergency",
            },
            {
              category: "business",
              categoryLabel: "Negocio",
              status: "declined",
              amountText: "$200.00",
              purpose: "Inversión en negocio",
              timestamp: "Ayer",
            },
          ],
        },
        {
          title: "Esta semana",
          items: [
            {
              category: "food",
              categoryLabel: "Comida",
              status: "approved",
              amountText: "$95.00",
              purpose: "Para el mercado de la semana",
              timestamp: "Esta semana",
            },
          ],
        },
        {
          title: "Hace dos semanas",
          items: [
            {
              category: "housing",
              categoryLabel: "Vivienda",
              status: "approved",
              amountText: "$400.00",
              purpose: "Renta de marzo",
              timestamp: "Hace dos semanas",
            },
          ],
        },
      ],
    };
  },

  getAssistantData(): AssistantData {
    return {
      messages: [
        {
          from: "ai",
          text: "Buenos días, Carlos. ¿Qué quieres saber?",
        },
        {
          from: "user",
          text: "¿Por qué el pago de $120 salió para revisar?",
        },
        {
          from: "ai",
          text: "No cae en ninguna categoría de tu plan y el lugar no lo reconocemos. Nadie ha dicho que esté mal — solo falta confirmarlo.",
        },
        {
          from: "user",
          text: "¿Y cuánto le llega a María en quetzales?",
        },
        {
          from: "ai",
          text: "Ese dato no lo tengo aquí. El tipo de cambio te lo muestra la pantalla de envío, antes de que confirmes nada.",
        },
      ],
      refCard: {
        categoryText: "❓ Sin categoría",
        amountText: "$120.00",
        timeText: "Hace 5 días",
        linkText: "Ver el pago →",
      },
      suggestions: [
        "¿Cuánto me queda para comida?",
        "¿Cómo cambio mi plan?",
        "¿Qué pasa si digo que no?",
      ],
    };
  },
  getRelationshipsData(): RelationshipsData {
    return fixtureRelationships();
  },
};

/**
 * Ugly-cases fixture (K2.24): the same interface, but every stress case the
 * spec demands, so layout assumptions get exercised instead of assumed:
 *
 * - long names: "María Guadalupe Hernández de la Cruz" (greeting + goal note)
 * - 18-character recipient name: "Lucía Fernanda Gil" (exactly 18 chars)
 * - amounts at the widest realistic magnitude: "$9,876,543.21"
 * - an empty list: HomeScreen.recentActivity is []
 * - a single item: one history group carries exactly one transaction
 * - a very long category name on a transaction card
 *
 * Tests render every screen against this provider and assert the content is
 * present. A screen that crashes or drops content on ugly data is not done.
 */
export const uglyFixtureProvider: ScreenDataProvider = {
  getHomeData(): HomeData {
    return {
      greetingName: "María Guadalupe Hernández de la Cruz",
      dateText: "Miércoles, 26 de agosto",
      balances: [
        {
          label: "Aquí (EE.UU.)",
          amountText: "$9,876,543.21",
          sub: "disponible para enviar",
        },
        {
          label: "Allá (Guatemala)",
          amountText: "$9,876,543.21",
          sub: "enviado este mes",
        },
      ],
      pendingCount: 27,
      goalCard: {
        title: "Casa en Chimaltenango para toda la familia extendida",
        stageText: "Etapa 2 de 4",
        savedAmountText: "$9,876,543.21",
        totalAmountText: "$9,876,543.21",
        percent: 100,
      },
      // The empty list: a new user with no activity yet.
      recentActivity: [],
    };
  },

  getApprovalData(): ApprovalData {
    return {
      // Exactly 18 characters — counted, not eyeballed.
      recipientName: "Lucía Fernanda Gil",
      relationship: "Tu esposa",
      categoryLabel: "Materiales de construcción para la segunda etapa de la casa",
      purpose:
        "“Para el mercado de la semana, leche para los niños, y los bloques que faltan para terminar la pared del cuarto de atrás antes de que empiecen las lluvias”",
      amountText: "$9,876,543.21",
      planMatchText: "✓ Esto está dentro de tu plan",
      planAvailableText: "$9,876,543.21",
    };
  },

  getGoalData(): GoalData {
    return {
      title: "Casa en Chimaltenango para toda la familia extendida",
      subtitle: "Empezaste en marzo de 2025",
      savedAmountText: "$9,876,543.21",
      remainingAmountText: "$9,876,543.21",
      totalAmountText: "$9,876,543.21",
      progressPercent: 100,
      stages: [
        {
          name: "Terreno comprado en el cantón norte de Chimaltenango",
          detail: "$9,876,543.21",
          meta: "12 de marzo",
          badge: "Verificado",
          done: true,
          upcoming: false,
        },
        {
          name: "2 Cimientos y bloques",
          detail: "$9,876,543.21 de $9,876,543.21",
          meta: "foto de María Guadalupe Hernández de la Cruz el lunes",
          badge: "En curso",
          done: false,
          upcoming: false,
        },
      ],
    };
  },

  getHistoryData(): HistoryData {
    return {
      groups: [
        {
          title: "Ayer",
          // The single item: one transaction, alone in its group.
          items: [
            {
              category: "business",
              categoryLabel: "Materiales de construcción para la segunda etapa de la casa",
              status: "declined",
              amountText: "$9,876,543.21",
              purpose:
                "Inversión en el negocio de bloques de la familia Hernández de la Cruz para la ampliación",
              timestamp: "Ayer",
            },
          ],
        },
        {
          // The empty group: a day with no movement renders its header only.
          title: "Esta semana",
          items: [],
        },
      ],
    };
  },

  getAssistantData(): AssistantData {
    return {
      messages: [
        {
          from: "ai",
          text: "Buenos días, María Guadalupe Hernández de la Cruz. ¿Qué quieres saber?",
        },
        {
          from: "user",
          text: "¿Por qué el pago de $9,876,543.21 salió para revisar si ya lo habíamos platicado la semana pasada con toda la familia?",
        },
        {
          from: "ai",
          text: "No cae en ninguna categoría de tu plan y el lugar no lo reconocemos. Nadie ha dicho que esté mal — solo falta confirmarlo.",
        },
      ],
      refCard: {
        categoryText: "❓ Sin categoría",
        amountText: "$9,876,543.21",
        timeText: "Hace 5 días",
        linkText: "Ver el pago →",
      },
      suggestions: [
        "¿Cuánto me queda para la segunda etapa de la casa este mes?",
        "¿Cómo cambio mi plan?",
        "¿Qué pasa si digo que no?",
      ],
    };
  },
  getRelationshipsData(): RelationshipsData {
    return {
      relationships: [
        // Exactly 18 characters: the K2.24 ugly-case name, now as a
        // per-relationship display name (PII — never logged).
        relationship("rel-ugly-1", "Lucía Fernanda Gil", "+50255509999", "active", 30),
        // Very long display name; invited 13d23h ago so the countdown shows
        // hours, exercising the boundary rendering.
        relationship(
          "rel-ugly-2",
          "María Guadalupe Hernández de la Cruz",
          "+50255508888",
          "invited",
          13.96,
        ),
      ],
    };
  },
};
