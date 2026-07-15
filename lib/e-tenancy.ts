const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export const defaultAgreementTemplate = `TENANCY AGREEMENT

Agreement Date: {{agreement_date}}

This tenancy agreement is made between the landlord/property operator and:

Tenant Name: {{tenant_name}}
IC / Passport: {{tenant_ic_passport}}
Phone: {{tenant_phone}}

Property: {{property_name}}
Address: {{property_address}}
Unit: {{unit_number}}
Room: {{room_number}}

Monthly Rental: {{monthly_rent}}
Deposit: {{deposit_amount}}
Utility Deposit: {{utility_deposit}}

Tenancy Start Date: {{tenancy_start_date}}
Tenancy End Date: {{tenancy_end_date}}
Contract Duration: {{contract_duration_months}} months

The tenant agrees to rent the room stated above and follow all property rules, rental payment requirements, and house regulations.

Tenant Signature:
{{tenant_signature}}
`;

export function addMonths(dateText: string, months: number) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function money(value: number | string | null | undefined) {
  return ringgitFormatter.format(Number(value ?? 0));
}

export function renderAgreementTemplate(
  template: string,
  values: Record<string, string | number | null | undefined>,
) {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => {
    const value = values[key];
    return value === null || value === undefined || value === "" ? "-" : String(value);
  });
}

export function plainTextToHtml(content: string) {
  return content
    .split("\n")
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<br />"))
    .join("");
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createSignedPdfBytes(content: string, tenantName: string, signedAt: string) {
  const clean = `${content}\n\nSigned by: ${tenantName}\nSigned at: ${signedAt}`
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .slice(0, 3000);
  const escaped = clean.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 10 Tf 40 780 Td 14 TL (${escaped.replace(/\n/g, ") Tj T* (")}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
