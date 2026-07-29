import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 54;
const TOP_Y = PAGE_HEIGHT - 86;
const BOTTOM_Y = 56;
const BODY_SIZE = 9.5;
const BODY_LINE_HEIGHT = 13.5;
const GOLD = rgb(0.68, 0.48, 0.16);
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.36, 0.39, 0.43);
const INCLUDED = rgb(0.05, 0.48, 0.3);
const NOT_INCLUDED = rgb(0.78, 0.12, 0.12);

type DrawState = {
  document: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
};

type AgreementPdfInput = {
  content: string;
  signerName?: string | null;
  signedAt?: string | null;
  tenantSignatureBytes?: Uint8Array | null;
  appendixDocuments?: AgreementAppendixDocument[];
};

export type AgreementAppendixDocument = {
  documentType: string;
  label: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
};

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }

    if (line) {
      lines.push(line);
    }

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }

    let fragment = "";
    for (const character of word) {
      const candidateFragment = `${fragment}${character}`;
      if (
        font.widthOfTextAtSize(candidateFragment, size) > maxWidth &&
        fragment
      ) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = candidateFragment;
      }
    }
    line = fragment;
  }

  if (line) {
    lines.push(line);
  }

  return lines.length ? lines : [""];
}

function addPage(state: DrawState) {
  state.page = state.document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  state.y = TOP_Y;
}

function ensureSpace(state: DrawState, height: number) {
  if (state.y - height < BOTTOM_Y) {
    addPage(state);
  }
}

function drawLines(
  state: DrawState,
  lines: string[],
  options: {
    font?: PDFFont;
    size?: number;
    lineHeight?: number;
    indent?: number;
    color?: ReturnType<typeof rgb>;
  } = {},
) {
  const font = options.font ?? state.regular;
  const size = options.size ?? BODY_SIZE;
  const lineHeight = options.lineHeight ?? BODY_LINE_HEIGHT;
  const indent = options.indent ?? 0;

  ensureSpace(state, lines.length * lineHeight);
  for (const line of lines) {
    state.page.drawText(line, {
      x: MARGIN_X + indent,
      y: state.y,
      size,
      font,
      color: options.color ?? INK,
    });
    state.y -= lineHeight;
  }
}

function drawParagraph(
  state: DrawState,
  text: string,
  options: {
    font?: PDFFont;
    size?: number;
    lineHeight?: number;
    indent?: number;
    bullet?: boolean;
    after?: number;
    color?: ReturnType<typeof rgb>;
  } = {},
) {
  const font = options.font ?? state.regular;
  const size = options.size ?? BODY_SIZE;
  const indent = options.indent ?? 0;
  const bulletIndent = options.bullet ? 12 : 0;
  const availableWidth = PAGE_WIDTH - MARGIN_X * 2 - indent - bulletIndent;
  const lines = wrapText(text, font, size, availableWidth);

  if (options.bullet) {
    ensureSpace(state, lines.length * (options.lineHeight ?? BODY_LINE_HEIGHT));
    state.page.drawText("-", {
      x: MARGIN_X + indent,
      y: state.y,
      size,
      font: state.bold,
      color: options.color ?? INK,
    });
  }

  drawLines(state, lines, {
    font,
    size,
    lineHeight: options.lineHeight,
    indent: indent + bulletIndent,
    color: options.color,
  });
  state.y -= options.after ?? 5;
}

async function readPublicAsset(filename: string) {
  try {
    return await readFile(path.join(process.cwd(), "public", filename));
  } catch {
    return null;
  }
}

async function embedImage(
  document: PDFDocument,
  imageBytes?: Uint8Array | null,
): Promise<PDFImage | null> {
  if (!imageBytes?.length) {
    return null;
  }

  try {
    return await document.embedPng(imageBytes);
  } catch {
    try {
      return await document.embedJpg(imageBytes);
    } catch {
      return null;
    }
  }
}

export function prepareAgreementPdfContent(content: string) {
  let normalized = content
    .replace(
      /Company No:\s*202501054747/gi,
      "Company Registration No. (New): 202501054747",
    )
    .replace(
      /Company Registration (?:Number|No\.?)\s*(?:\(New\))?\s*:\s*202501054747/gi,
      "Company Registration No. (New): 202501054747",
    );

  // Older stored agreements used both Markdown and plain-text section styles.
  normalized = normalized
    .replace(
      /\n+### WITNESS\b[\s\S]*?(?=\n+(?:\[TENANT_DOCUMENT_APPENDIX\]|## |### ))/gi,
      "\n\n",
    )
    .replace(
      /\n+WITNESS\s*\n[\s\S]*?(?=\n+ATTACHMENTS\b)/gi,
      "\n\n",
    )
    .replace(
      /\n+## SCHEDULE \d+\s*-\s*EMERGENCY CONTACT\b[\s\S]*?(?=\n+## )/gi,
      "\n\n",
    )
    .replace(
      /\n+### EMERGENCY CONTACT\b[\s\S]*?(?=\n+(?:## |ATTACHMENTS\b))/gi,
      "\n\n",
    )
    .replace(
      /\n+EMERGENCY CONTACT\s*\n[\s\S]*?(?=\n+ATTACHMENTS\b)/gi,
      "\n\n",
    );

  const signatureMatch = normalized.match(
    /^## (?:\d+\.\s+)?SIGNATURES\s*$/m,
  );
  const signatureIndex = signatureMatch?.index ?? -1;
  if (signatureIndex === -1) {
    return normalized;
  }

  const beforeSignatures = normalized.slice(0, signatureIndex);
  let signatureSection = normalized.slice(signatureIndex);
  const tenantSignatureIndex = signatureSection.indexOf(
    "For and on behalf of the Tenant:",
  );
  const landlordSection =
    tenantSignatureIndex === -1
      ? signatureSection
      : signatureSection.slice(0, tenantSignatureIndex);

  if (
    !landlordSection.includes(
      "Company Registration No. (New): 202501054747",
    )
  ) {
    signatureSection = signatureSection.replace(
      "Company Name: DEKEZ SDN BHD",
      "Company Name: DEKEZ SDN BHD\nCompany Registration No. (New): 202501054747",
    );
  }

  return `${beforeSignatures}${signatureSection}`;
}

function drawDocumentTitle(state: DrawState, title: string) {
  ensureSpace(state, 48);
  const size = 18;
  const width = state.bold.widthOfTextAtSize(title, size);
  state.page.drawText(title, {
    x: Math.max(MARGIN_X, (PAGE_WIDTH - width) / 2),
    y: state.y,
    size,
    font: state.bold,
    color: INK,
  });
  state.y -= 27;
  state.page.drawLine({
    start: { x: MARGIN_X + 105, y: state.y },
    end: { x: PAGE_WIDTH - MARGIN_X - 105, y: state.y },
    thickness: 1.5,
    color: GOLD,
  });
  state.y -= 17;
}

function drawSectionHeading(state: DrawState, heading: string) {
  ensureSpace(state, 30);
  state.y -= 3;
  state.page.drawText(heading, {
    x: MARGIN_X,
    y: state.y,
    size: 11.5,
    font: state.bold,
    color: rgb(0.14, 0.12, 0.08),
  });
  state.y -= 7;
  state.page.drawLine({
    start: { x: MARGIN_X, y: state.y },
    end: { x: PAGE_WIDTH - MARGIN_X, y: state.y },
    thickness: 0.75,
    color: GOLD,
  });
  state.y -= 14;
}

function drawFacilityStatus(
  state: DrawState,
  label: string,
  included: boolean,
) {
  const color = included ? INCLUDED : NOT_INCLUDED;
  const text = `${included ? "Included" : "Not Included"} - ${label}`;
  const indent = 22;
  const lines = wrapText(
    text,
    state.regular,
    BODY_SIZE,
    PAGE_WIDTH - MARGIN_X * 2 - indent,
  );
  ensureSpace(state, lines.length * BODY_LINE_HEIGHT + 4);
  const iconX = MARGIN_X + 4;
  const iconY = state.y + 3;

  if (included) {
    state.page.drawLine({
      start: { x: iconX, y: iconY - 4 },
      end: { x: iconX + 4, y: iconY - 8 },
      thickness: 1.5,
      color,
    });
    state.page.drawLine({
      start: { x: iconX + 4, y: iconY - 8 },
      end: { x: iconX + 11, y: iconY + 1 },
      thickness: 1.5,
      color,
    });
  } else {
    state.page.drawLine({
      start: { x: iconX, y: iconY },
      end: { x: iconX + 10, y: iconY - 10 },
      thickness: 1.4,
      color,
    });
    state.page.drawLine({
      start: { x: iconX + 10, y: iconY },
      end: { x: iconX, y: iconY - 10 },
      thickness: 1.4,
      color,
    });
  }

  drawLines(state, lines, { indent, color });
  state.y -= 3;
}

function drawLandlordSignature(
  state: DrawState,
  authorisedSignature: PDFImage | null,
  companyChop: PDFImage | null,
) {
  ensureSpace(state, 145);
  const top = state.y;

  if (authorisedSignature) {
    const scaled = authorisedSignature.scaleToFit(215, 62);
    state.page.drawImage(authorisedSignature, {
      x: MARGIN_X,
      y: top - scaled.height,
      width: scaled.width,
      height: scaled.height,
    });
  }

  if (companyChop) {
    const scaled = companyChop.scaleToFit(88, 88);
    state.page.drawImage(companyChop, {
      x: MARGIN_X + 282,
      y: top - scaled.height - 2,
      width: scaled.width,
      height: scaled.height,
    });
  }

  const lineY = top - 103;
  state.page.drawLine({
    start: { x: MARGIN_X, y: lineY },
    end: { x: MARGIN_X + 210, y: lineY },
    thickness: 0.8,
    color: INK,
  });
  state.page.drawText("Authorised Signature", {
    x: MARGIN_X,
    y: lineY - 13,
    size: 8.5,
    font: state.bold,
    color: MUTED,
  });
  state.page.drawText("Company Chop", {
    x: MARGIN_X + 282,
    y: lineY - 13,
    size: 8.5,
    font: state.bold,
    color: MUTED,
  });
  state.y = lineY - 29;
}

function drawTenantSignature(
  state: DrawState,
  tenantSignature: PDFImage | null,
  signerName: string,
  signedAt?: string | null,
) {
  ensureSpace(state, 175);
  const top = state.y;

  if (tenantSignature) {
    const scaled = tenantSignature.scaleToFit(220, 92);
    state.page.drawImage(tenantSignature, {
      x: MARGIN_X,
      y: top - scaled.height,
      width: scaled.width,
      height: scaled.height,
    });
  }

  const lineY = top - 112;
  state.page.drawLine({
    start: { x: MARGIN_X, y: lineY },
    end: { x: MARGIN_X + 210, y: lineY },
    thickness: 0.8,
    color: INK,
  });
  state.y = lineY - 15;
  drawParagraph(state, `Signed digitally by ${signerName}`, {
    font: state.bold,
    after: 2,
  });

  if (signedAt) {
    drawParagraph(
      state,
      `Signed at ${new Intl.DateTimeFormat("en-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        dateStyle: "long",
        timeStyle: "medium",
      }).format(new Date(signedAt))}`,
      { size: 8.5, color: MUTED, after: 0 },
    );
  }
}

function drawPendingTenantSignature(state: DrawState) {
  ensureSpace(state, 150);
  state.y -= 112;
  state.page.drawLine({
    start: { x: MARGIN_X, y: state.y },
    end: { x: MARGIN_X + 210, y: state.y },
    thickness: 0.8,
    color: INK,
  });
  state.y -= 15;
  drawParagraph(state, "Pending tenant signature", {
    size: 8.5,
    color: MUTED,
    after: 4,
  });
}

function drawAppendixPageHeading(
  state: DrawState,
  document: AgreementAppendixDocument,
  pageNumber?: { current: number; total: number },
) {
  drawSectionHeading(state, "ATTACHMENT - TENANT DOCUMENTS");
  const pageLabel = pageNumber
    ? ` - Page ${pageNumber.current} of ${pageNumber.total}`
    : "";
  drawParagraph(state, `${document.label}${pageLabel}`, {
    font: state.bold,
    size: 10.5,
    after: 2,
  });
  drawParagraph(state, document.fileName, {
    size: 8,
    color: MUTED,
    after: 10,
  });
}

function drawFittedAppendixImage(
  state: DrawState,
  image: PDFImage,
) {
  const availableWidth = PAGE_WIDTH - MARGIN_X * 2;
  const availableHeight = state.y - BOTTOM_Y - 12;
  const scale = Math.min(
    availableWidth / image.width,
    availableHeight / image.height,
    1,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  state.page.drawImage(image, {
    x: (PAGE_WIDTH - width) / 2,
    y: BOTTOM_Y + Math.max(0, (availableHeight - height) / 2),
    width,
    height,
  });
}

async function appendAgreementDocuments(
  state: DrawState,
  documents: AgreementAppendixDocument[],
) {
  for (const appendixDocument of documents) {
    if (appendixDocument.contentType === "application/pdf") {
      try {
        const pages = await state.document.embedPdf(appendixDocument.bytes);
        for (const [index, page] of pages.entries()) {
          addPage(state);
          drawAppendixPageHeading(state, appendixDocument, {
            current: index + 1,
            total: pages.length,
          });
          const availableWidth = PAGE_WIDTH - MARGIN_X * 2;
          const availableHeight = state.y - BOTTOM_Y - 12;
          const scale = Math.min(
            availableWidth / page.width,
            availableHeight / page.height,
          );
          const width = page.width * scale;
          const height = page.height * scale;
          state.page.drawPage(page, {
            x: (PAGE_WIDTH - width) / 2,
            y: BOTTOM_Y + Math.max(0, (availableHeight - height) / 2),
            width,
            height,
          });
        }
        continue;
      } catch {
        // Fall through to the unavailable-preview page below.
      }
    }

    const image = await embedImage(state.document, appendixDocument.bytes);
    addPage(state);
    drawAppendixPageHeading(state, appendixDocument);

    if (image) {
      drawFittedAppendixImage(state, image);
    } else {
      drawParagraph(
        state,
        "This uploaded file is retained with the tenant record, but a printable preview is not available.",
        { color: MUTED },
      );
    }
  }
}

function addPageFurniture(
  document: PDFDocument,
  regular: PDFFont,
  bold: PDFFont,
  logo: PDFImage | null,
) {
  const pages = document.getPages();

  pages.forEach((page, index) => {
    if (logo) {
      const scaled = logo.scaleToFit(29, 29);
      page.drawImage(logo, {
        x: MARGIN_X,
        y: PAGE_HEIGHT - 50,
        width: scaled.width,
        height: scaled.height,
      });
    }

    page.drawText("DEKEZ SDN BHD", {
      x: MARGIN_X + 38,
      y: PAGE_HEIGHT - 32,
      size: 9.5,
      font: bold,
      color: INK,
    });
    page.drawText("Company Registration No. (New): 202501054747", {
      x: MARGIN_X + 38,
      y: PAGE_HEIGHT - 44,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
    page.drawText("TENANCY AGREEMENT", {
      x:
        PAGE_WIDTH -
        MARGIN_X -
        bold.widthOfTextAtSize("TENANCY AGREEMENT", 9),
      y: PAGE_HEIGHT - 35,
      size: 9,
      font: bold,
      color: GOLD,
    });
    page.drawLine({
      start: { x: MARGIN_X, y: PAGE_HEIGHT - 58 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 58 },
      thickness: 0.9,
      color: GOLD,
    });

    page.drawText("Confidential tenancy record", {
      x: MARGIN_X,
      y: 28,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    page.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN_X - regular.widthOfTextAtSize(pageLabel, 8),
      y: 28,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });
}

export async function createAgreementPdf({
  content,
  signerName,
  signedAt,
  tenantSignatureBytes,
  appendixDocuments = [],
}: AgreementPdfInput) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const [
    tenantSignature,
    authorisedSignature,
    companyChop,
    logo,
  ] = await Promise.all([
    embedImage(document, tenantSignatureBytes),
    readPublicAsset("dekez-authorised-signature.png").then((bytes) =>
      embedImage(document, bytes),
    ),
    readPublicAsset("dekez-company-chop.png").then((bytes) =>
      embedImage(document, bytes),
    ),
    readPublicAsset("dekez-logo.jpg").then((bytes) =>
      embedImage(document, bytes),
    ),
  ]);
  const state: DrawState = {
    document,
    page: document.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    regular,
    bold,
    y: TOP_Y,
  };
  const preparedContent = prepareAgreementPdfContent(content);
  let skipTemplateAppendix = false;
  let appendedDocuments = false;
  const contentLines = preparedContent.split("\n");

  for (const [lineIndex, rawLine] of contentLines.entries()) {
    const line = rawLine.trim();

    if (line === "[TENANT_DOCUMENT_APPENDIX]") {
      appendedDocuments = true;
      if (appendixDocuments.length) {
        await appendAgreementDocuments(state, appendixDocuments);
      }
      const nextLine = contentLines
        .slice(lineIndex + 1)
        .map((candidate) => candidate.trim())
        .find(Boolean);
      if (nextLine && nextLine !== "## END OF AGREEMENT") {
        addPage(state);
      }
      continue;
    }

    if (line === "## END OF AGREEMENT") {
      continue;
    }

    if (line === "## APPENDIX") {
      skipTemplateAppendix = true;
      continue;
    }

    if (skipTemplateAppendix) {
      continue;
    }

    if (!line) {
      state.y -= 5;
      continue;
    }

    if (line === "[LANDLORD_SIGNATURE]") {
      drawLandlordSignature(state, authorisedSignature, companyChop);
      continue;
    }

    if (line === "[Pending tenant signature]") {
      drawPendingTenantSignature(state);
      continue;
    }

    if (line.startsWith("Signed digitally by ")) {
      drawTenantSignature(
        state,
        tenantSignature,
        signerName || line.slice("Signed digitally by ".length),
        signedAt,
      );
      continue;
    }

    if (line === "***") {
      ensureSpace(state, 14);
      state.page.drawLine({
        start: { x: MARGIN_X, y: state.y },
        end: { x: PAGE_WIDTH - MARGIN_X, y: state.y },
        thickness: 0.75,
        color: GOLD,
      });
      state.y -= 14;
      continue;
    }

    if (line.startsWith("# ")) {
      drawDocumentTitle(state, line.slice(2));
      continue;
    }

    if (line.startsWith("## ")) {
      if (
        /^## (?:\d+\.\s+)?SIGNATURES$/.test(line) ||
        line === "## ATTACHMENTS"
      ) {
        addPage(state);
      }
      drawSectionHeading(state, line.slice(3));
      continue;
    }

    if (line.startsWith("### ")) {
      if (/^### SCHEDULE \d+$/.test(line)) {
        addPage(state);
      }
      drawParagraph(state, line.slice(4), {
        font: bold,
        size: 10.5,
        lineHeight: 14,
        after: 5,
        color: rgb(0.16, 0.14, 0.1),
      });
      continue;
    }

    if (line.startsWith("- [INCLUDED] ")) {
      drawFacilityStatus(
        state,
        line.slice("- [INCLUDED] ".length),
        true,
      );
      continue;
    }

    if (line.startsWith("- [NOT INCLUDED] ")) {
      drawFacilityStatus(
        state,
        line.slice("- [NOT INCLUDED] ".length),
        false,
      );
      continue;
    }

    if (line.startsWith("- ")) {
      drawParagraph(state, line.slice(2), {
        bullet: true,
        indent: 4,
        after: 3,
      });
      continue;
    }

    drawParagraph(state, line);
  }

  if (!appendedDocuments) {
    await appendAgreementDocuments(state, appendixDocuments);
  }
  addPageFurniture(document, regular, bold, logo);
  document.setTitle("DEKEZ Tenancy Agreement");
  document.setSubject("Room tenancy agreement");
  document.setAuthor("DEKEZ SDN BHD");
  document.setCreator("DEKEZ Rental Management System");
  document.setProducer("DEKEZ Rental Management System");

  return document.save();
}

export async function createSignedAgreementPdf({
  content,
  signerName,
  signedAt,
  signatureBytes,
  appendixDocuments,
}: {
  content: string;
  signerName: string;
  signedAt: string;
  signatureBytes?: Uint8Array | null;
  appendixDocuments?: AgreementAppendixDocument[];
}) {
  return createAgreementPdf({
    content,
    signerName,
    signedAt,
    tenantSignatureBytes: signatureBytes,
    appendixDocuments,
  });
}
