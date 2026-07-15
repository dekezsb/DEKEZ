export type WhatsAppIntent =
  | "get_my_profile"
  | "get_my_room"
  | "get_my_outstanding_rent"
  | "get_my_bills"
  | "get_my_payment_history"
  | "get_my_tenancy_agreement"
  | "get_my_contract_expiry"
  | "get_my_maintenance_tickets"
  | "create_maintenance_ticket"
  | "unknown";

export type ClassifiedTenantMessage = {
  intent: WhatsAppIntent;
  maintenance_description?: string;
  reply_hint?: string;
};

type OpenAIResponsePayload = {
  output_text?: string;
  output?: {
    content?: {
      text?: string;
    }[];
  }[];
};

function classifyFallback(message: string): ClassifiedTenantMessage {
  const text = message.toLowerCase();

  if (/rent|owe|outstanding|hutang|due/.test(text)) {
    return { intent: "get_my_outstanding_rent" };
  }
  if (/bill|water|electric|utility/.test(text)) {
    return { intent: "get_my_bills" };
  }
  if (/payment|paid|history|receipt/.test(text)) {
    return { intent: "get_my_payment_history" };
  }
  if (/contract|agreement|tenancy|expire|finish|end/.test(text)) {
    return { intent: "get_my_contract_expiry" };
  }
  if (/ticket|maintenance status|repair status|job status/.test(text)) {
    return { intent: "get_my_maintenance_tickets" };
  }
  if (/leak|leaking|broken|repair|aircon|air cond|toilet|pipe|light|fan|door|clean|maintenance|rosak/.test(text)) {
    return { intent: "create_maintenance_ticket", maintenance_description: message };
  }
  if (/room|where.*stay|my unit/.test(text)) {
    return { intent: "get_my_room" };
  }

  return { intent: "unknown" };
}

export async function classifyTenantMessage(message: string): Promise<ClassifiedTenantMessage> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return classifyFallback(message);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-5.2",
        input: [
          {
            role: "system",
            content:
              "You classify WhatsApp messages for DEKEZ tenant support. Return only JSON. Choose one safe intent. Do not invent data. Financial changes, contract changes, and owner claims are not allowed.",
          },
          {
            role: "user",
            content: message,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "tenant_whatsapp_intent",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                intent: {
                  type: "string",
                  enum: [
                    "get_my_profile",
                    "get_my_room",
                    "get_my_outstanding_rent",
                    "get_my_bills",
                    "get_my_payment_history",
                    "get_my_tenancy_agreement",
                    "get_my_contract_expiry",
                    "get_my_maintenance_tickets",
                    "create_maintenance_ticket",
                    "unknown",
                  ],
                },
                maintenance_description: { type: "string" },
                reply_hint: { type: "string" },
              },
              required: ["intent", "maintenance_description", "reply_hint"],
            },
          },
        },
      }),
    });

    if (!response.ok) {
      return classifyFallback(message);
    }

    const payload = await response.json() as OpenAIResponsePayload;
    const outputText =
      payload.output_text
      ?? payload.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("")
      ?? "";
    const parsed = JSON.parse(outputText) as ClassifiedTenantMessage;
    return {
      intent: parsed.intent,
      maintenance_description: parsed.maintenance_description || message,
      reply_hint: parsed.reply_hint || "",
    };
  } catch {
    return classifyFallback(message);
  }
}
