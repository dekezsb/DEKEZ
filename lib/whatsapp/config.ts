export function getWhatsAppConfig() {
  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.META_APP_SECRET,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0",
  };
}

// Meta's WhatsApp Cloud API only allows free-form text messages inside a
// 24-hour customer service window (i.e. the tenant messaged us recently).
// A cold, business-initiated reminder outside that window MUST use a
// pre-approved message template, or Meta will reject the send. Configure
// these once a template has been approved in WhatsApp Manager.
export function getWhatsAppReminderTemplateConfig() {
  return {
    templateName: process.env.WHATSAPP_REMINDER_TEMPLATE_NAME || null,
    templateLanguage: process.env.WHATSAPP_REMINDER_TEMPLATE_LANG || "en",
  };
}

export function normalizePhoneNumber(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  if (digits.startsWith("0")) {
    return `60${digits.slice(1)}`;
  }

  return digits;
}

export function phoneMatches(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizePhoneNumber(left);
  const normalizedRight = normalizePhoneNumber(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return (
    normalizedLeft === normalizedRight
    || normalizedLeft.endsWith(normalizedRight)
    || normalizedRight.endsWith(normalizedLeft)
  );
}
