function filenamePart(
  value: string | null | undefined,
  fallback: string,
) {
  const normalized = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return normalized || fallback;
}

function compactDate(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}${match[2]}${match[1]}` : "UNDATED";
}

export function agreementPdfName(input: {
  tenantName: string | null | undefined;
  propertyCode: string | null | undefined;
  roomNumber: string | null | undefined;
  termStartDate: string | null | undefined;
}) {
  const room = filenamePart(input.roomNumber, "ROOM")
    .replace(/^ROOM_?/, "")
    .replace(/^R/, "");

  return [
    filenamePart(input.tenantName, "TENANT"),
    `${filenamePart(input.propertyCode, "PROPERTY")}R${room}`,
    compactDate(input.termStartDate),
  ].join("_") + ".pdf";
}
