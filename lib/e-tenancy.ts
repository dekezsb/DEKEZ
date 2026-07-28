import {
  formatMalaysiaDate,
} from "@/lib/date-format";
import { standardAgreementTemplate } from "@/lib/tenancy/standard-agreement";

const ringgitFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
});

export const defaultAgreementTemplate = standardAgreementTemplate;

export function addMonths(dateText: string, months: number) {
  const [year, month, day] = dateText.split("-").map(Number);
  const targetMonthStart = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = targetMonthStart.getUTCFullYear();
  const targetMonth = targetMonthStart.getUTCMonth();
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const date = new Date(
    Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)),
  );

  return date.toISOString().slice(0, 10);
}

export function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calculateTermEndDate(startDate: string, durationMonths: number) {
  return addDays(addMonths(startDate, durationMonths), -1);
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
  const output: string[] = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      output.push("</ul>");
      listOpen = false;
    }
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      closeList();
      output.push('<div class="h-3"></div>');
      continue;
    }

    if (line === "***") {
      closeList();
      output.push("<hr />");
      continue;
    }

    if (line === "[TENANT_DOCUMENT_APPENDIX]") {
      closeList();
      output.push("<h2>13. IC Appendix</h2>");
      output.push(
        "<p>Tenant identity and supporting documents are attached to the printable PDF.</p>",
      );
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      output.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      output.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      output.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith("- ")) {
      if (!listOpen) {
        output.push("<ul>");
        listOpen = true;
      }
      const item = line.slice(2);
      if (item.startsWith("[INCLUDED] ")) {
        output.push(
          `<li><strong class="text-emerald-700">&#10003; Included</strong> - ${escapeHtml(
            item.slice("[INCLUDED] ".length),
          )}</li>`,
        );
      } else if (item.startsWith("[NOT INCLUDED] ")) {
        output.push(
          `<li><strong class="text-red-600">&#10007; Not Included</strong> - ${escapeHtml(
            item.slice("[NOT INCLUDED] ".length),
          )}</li>`,
        );
      } else {
        output.push(`<li>${escapeHtml(item)}</li>`);
      }
      continue;
    }

    closeList();
    output.push(`<p>${escapeHtml(line)}</p>`);
  }

  closeList();
  return output.join("");
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
