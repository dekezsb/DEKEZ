import masterAgreementWording from "./master-agreement-wording.json";

export const STANDARD_AGREEMENT_NAME = "DEKEZ Master Tenancy Agreement";
export const STANDARD_AGREEMENT_VERSION = 5;

const majorHeadings = new Set([
  "BACKGROUND",
  "SIGNATURES",
  "ATTACHMENTS",
  "END OF AGREEMENT",
]);

const minorHeadings = new Set([
  "BETWEEN",
  "AND",
  "PROPERTY-SPECIFIC SCHEDULE",
  "TENANT'S ACKNOWLEDGEMENT",
  "SIGNED FOR AND ON BEHALF OF THE LANDLORD",
  "SIGNED BY THE TENANT",
  "WITNESS",
  "EMERGENCY CONTACT",
]);

function normalizeTypography(value: string) {
  return value
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'")
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replaceAll("\u2013", "-")
    .replaceAll("\u2014", "-")
    .replaceAll("\u00a0", " ");
}

function formatMasterAgreementLine(rawLine: string) {
  const line = normalizeTypography(rawLine);

  if (line === "TENANCY AGREEMENT") {
    return "# TENANCY AGREEMENT";
  }
  if (/^\d+\.\s+[A-Z]/.test(line) || majorHeadings.has(line)) {
    return `## ${line}`;
  }
  if (/^SCHEDULE \d+$/.test(line) || minorHeadings.has(line)) {
    return `### ${line}`;
  }
  return line;
}

const formattedWording = masterAgreementWording.lines
  .map(formatMasterAgreementLine)
  .join("\n")
  .replace("{{landlord_signature}}", "[LANDLORD_SIGNATURE]")
  .replace(
    "{{tenant_document_appendix}}",
    "[TENANT_DOCUMENT_APPENDIX]",
  );

export const standardAgreementTemplate = formattedWording.includes(
  "[TENANT_DOCUMENT_APPENDIX]",
)
  ? formattedWording
  : formattedWording.replace(
      "\n## END OF AGREEMENT",
      "\n[TENANT_DOCUMENT_APPENDIX]\n\n## END OF AGREEMENT",
    );
