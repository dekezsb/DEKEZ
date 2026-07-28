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
const TOP_Y = PAGE_HEIGHT - 62;
const BOTTOM_Y = 54;
const BODY_SIZE = 9.5;
const BODY_LINE_HEIGHT = 13.5;

type DrawState = {
  document: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
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
      if (font.widthOfTextAtSize(candidateFragment, size) > maxWidth && fragment) {
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
      color: options.color ?? rgb(0.08, 0.08, 0.08),
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
    });
  }

  drawLines(state, lines, {
    font,
    size,
    lineHeight: options.lineHeight,
    indent: indent + bulletIndent,
  });
  state.y -= options.after ?? 5;
}

async function embedSignature(
  document: PDFDocument,
  signatureBytes?: Uint8Array | null,
): Promise<PDFImage | null> {
  if (!signatureBytes?.length) {
    return null;
  }

  try {
    return await document.embedPng(signatureBytes);
  } catch {
    try {
      return await document.embedJpg(signatureBytes);
    } catch {
      return null;
    }
  }
}

export async function createSignedAgreementPdf({
  content,
  signerName,
  signedAt,
  signatureBytes,
}: {
  content: string;
  signerName: string;
  signedAt: string;
  signatureBytes?: Uint8Array | null;
}) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const signature = await embedSignature(document, signatureBytes);
  const state: DrawState = {
    document,
    page: document.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    regular,
    bold,
    y: TOP_Y,
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      state.y -= 5;
      continue;
    }

    if (line === "***") {
      ensureSpace(state, 14);
      state.page.drawLine({
        start: { x: MARGIN_X, y: state.y },
        end: { x: PAGE_WIDTH - MARGIN_X, y: state.y },
        thickness: 0.75,
        color: rgb(0.45, 0.36, 0.18),
      });
      state.y -= 14;
      continue;
    }

    if (line.startsWith("# ")) {
      state.y -= 4;
      drawParagraph(state, line.slice(2), {
        font: bold,
        size: 18,
        lineHeight: 22,
        after: 10,
      });
      continue;
    }

    if (line.startsWith("## ")) {
      state.y -= 4;
      drawParagraph(state, line.slice(3), {
        font: bold,
        size: 12,
        lineHeight: 16,
        after: 7,
      });
      continue;
    }

    if (line.startsWith("### ")) {
      drawParagraph(state, line.slice(4), {
        font: bold,
        size: 10.5,
        lineHeight: 14,
        after: 5,
      });
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

  ensureSpace(state, 110);
  state.y -= 12;
  if (signature) {
    const scaled = signature.scaleToFit(160, 55);
    state.page.drawImage(signature, {
      x: MARGIN_X,
      y: state.y - scaled.height,
      width: scaled.width,
      height: scaled.height,
    });
    state.y -= scaled.height + 8;
  }
  state.page.drawLine({
    start: { x: MARGIN_X, y: state.y },
    end: { x: MARGIN_X + 210, y: state.y },
    thickness: 0.75,
  });
  state.y -= 16;
  drawParagraph(state, `Signed digitally by ${signerName}`, {
    font: bold,
    after: 2,
  });
  drawParagraph(
    state,
    `Signed at ${new Intl.DateTimeFormat("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      dateStyle: "long",
      timeStyle: "medium",
    }).format(new Date(signedAt))}`,
    { size: 8.5, after: 0 },
  );

  const pages = document.getPages();
  pages.forEach((page, index) => {
    page.drawText("DEKEZ SDN BHD - TENANCY AGREEMENT", {
      x: MARGIN_X,
      y: PAGE_HEIGHT - 30,
      size: 8,
      font: bold,
      color: rgb(0.45, 0.36, 0.18),
    });
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    page.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN_X - regular.widthOfTextAtSize(pageLabel, 8),
      y: 28,
      size: 8,
      font: regular,
      color: rgb(0.35, 0.35, 0.35),
    });
  });

  document.setTitle("DEKEZ Tenancy Agreement");
  document.setAuthor("DEKEZ SDN BHD");
  document.setCreator("DEKEZ Rental Management System");
  document.setProducer("DEKEZ Rental Management System");

  return document.save();
}
