import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const GOLD = rgb(0.72, 0.5, 0.12);
const BLACK = rgb(0.05, 0.05, 0.05);
const MUTED = rgb(0.32, 0.36, 0.43);

export type ArchiveAttachment = {
  label: string;
  fileName: string;
  contentType: string | null;
  bytes: Uint8Array;
};

export type ArchiveSection = {
  heading: string;
  rows: Array<[string, string]>;
};

function wrapText(text: string, font: PDFFont, size: number, width: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawHeader(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  title: string,
  subtitle?: string,
) {
  page.drawText("DEKEZ SDN BHD", {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN,
    size: 15,
    font: bold,
    color: BLACK,
  });
  page.drawText("Company Registration No. (New): 202501054747", {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 18,
    size: 8.5,
    font: regular,
    color: MUTED,
  });
  const titleWidth = bold.widthOfTextAtSize(title, 18);
  page.drawText(title, {
    x: PAGE_WIDTH - MARGIN - titleWidth,
    y: PAGE_HEIGHT - MARGIN,
    size: 18,
    font: bold,
    color: GOLD,
  });
  if (subtitle) {
    const subtitleWidth = regular.widthOfTextAtSize(subtitle, 8.5);
    page.drawText(subtitle, {
      x: PAGE_WIDTH - MARGIN - subtitleWidth,
      y: PAGE_HEIGHT - MARGIN - 18,
      size: 8.5,
      font: regular,
      color: MUTED,
    });
  }
  page.drawLine({
    start: { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 34 },
    end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - MARGIN - 34 },
    thickness: 1,
    color: GOLD,
  });
}

function drawSections(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  sections: ArchiveSection[],
) {
  let y = PAGE_HEIGHT - MARGIN - 62;
  const valueX = 210;
  const valueWidth = PAGE_WIDTH - MARGIN - valueX;

  for (const section of sections) {
    page.drawText(section.heading.toUpperCase(), {
      x: MARGIN,
      y,
      size: 10.5,
      font: bold,
      color: GOLD,
    });
    y -= 20;

    for (const [label, value] of section.rows) {
      page.drawText(label, {
        x: MARGIN,
        y,
        size: 9.5,
        font: regular,
        color: MUTED,
      });
      const lines = wrapText(value || "-", regular, 9.5, valueWidth);
      for (const [index, line] of lines.entries()) {
        page.drawText(line, {
          x: valueX,
          y: y - index * 13,
          size: 9.5,
          font: regular,
          color: BLACK,
        });
      }
      y -= Math.max(lines.length * 13, 16);
    }
    y -= 10;
  }
}

async function appendAttachment(
  document: PDFDocument,
  regular: PDFFont,
  bold: PDFFont,
  attachment: ArchiveAttachment,
) {
  const separator = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(separator, regular, bold, "ATTACHMENT", attachment.fileName);
  separator.drawText(attachment.label, {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 88,
    size: 16,
    font: bold,
    color: BLACK,
  });
  separator.drawText("The following page(s) contain the archived source document.", {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 114,
    size: 10,
    font: regular,
    color: MUTED,
  });

  const contentType = attachment.contentType?.toLowerCase() ?? "";
  const extension = attachment.fileName.split(".").at(-1)?.toLowerCase();

  if (contentType.includes("pdf") || extension === "pdf") {
    try {
      const source = await PDFDocument.load(attachment.bytes);
      const pages = await document.copyPages(source, source.getPageIndices());
      for (const page of pages) document.addPage(page);
      return;
    } catch {
      separator.drawText("This PDF could not be rendered into the archive copy.", {
        x: MARGIN,
        y: PAGE_HEIGHT - MARGIN - 144,
        size: 10,
        font: regular,
        color: rgb(0.75, 0.1, 0.1),
      });
      return;
    }
  }

  try {
    let image;
    if (contentType.includes("png") || extension === "png") {
      image = await document.embedPng(attachment.bytes);
    } else if (
      contentType.includes("jpeg") ||
      contentType.includes("jpg") ||
      extension === "jpg" ||
      extension === "jpeg"
    ) {
      image = await document.embedJpg(attachment.bytes);
    } else {
      const sharp = (await import("sharp")).default;
      const converted = await sharp(Buffer.from(attachment.bytes))
        .png()
        .toBuffer();
      image = await document.embedPng(converted);
    }
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const availableWidth = PAGE_WIDTH - MARGIN * 2;
    const availableHeight = PAGE_HEIGHT - MARGIN * 2;
    const scale = Math.min(
      availableWidth / image.width,
      availableHeight / image.height,
      1,
    );
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: (PAGE_WIDTH - width) / 2,
      y: (PAGE_HEIGHT - height) / 2,
      width,
      height,
    });
  } catch {
    separator.drawText("This attachment format could not be rendered.", {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - 144,
      size: 10,
      font: regular,
      color: rgb(0.75, 0.1, 0.1),
    });
  }
}

export async function createArchivePdf(input: {
  title: string;
  subtitle?: string;
  sections: ArchiveSection[];
  attachments?: ArchiveAttachment[];
}) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page, regular, bold, input.title, input.subtitle);
  drawSections(page, regular, bold, input.sections);

  for (const attachment of input.attachments ?? []) {
    await appendAttachment(document, regular, bold, attachment);
  }

  return document.save();
}
