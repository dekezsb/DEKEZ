import { getWhatsAppConfig } from "./config";

export async function sendWhatsAppText(to: string, body: string) {
  const config = getWhatsAppConfig();

  if (!config.accessToken || !config.phoneNumberId) {
    throw new Error("Missing WhatsApp access token or phone number id.");
  }

  const response = await fetch(
    `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body,
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WhatsApp send failed: ${text}`);
  }

  return response.json() as Promise<{ messages?: { id?: string }[] }>;
}

export async function getWhatsAppMediaUrl(mediaId: string) {
  const config = getWhatsAppConfig();

  if (!config.accessToken) {
    throw new Error("Missing WhatsApp access token.");
  }

  const response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load WhatsApp media url: ${await response.text()}`);
  }

  const payload = await response.json() as { url?: string; mime_type?: string };
  return payload;
}

export async function downloadWhatsAppMedia(mediaId: string) {
  const config = getWhatsAppConfig();
  const media = await getWhatsAppMediaUrl(mediaId);

  if (!config.accessToken || !media.url) {
    throw new Error("Missing WhatsApp media url.");
  }

  const response = await fetch(media.url, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Could not download WhatsApp media: ${await response.text()}`);
  }

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? media.mime_type ?? "application/octet-stream",
  };
}
