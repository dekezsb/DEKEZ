import { formatMalaysiaDate } from "@/lib/date-format";

const ones = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const tens = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function underThousand(value: number) {
  const parts: string[] = [];
  let remaining = value;

  if (remaining >= 100) {
    parts.push(`${ones[Math.floor(remaining / 100)]} Hundred`);
    remaining %= 100;
  }
  if (remaining >= 20) {
    parts.push(tens[Math.floor(remaining / 10)]);
    remaining %= 10;
  }
  if (remaining > 0) {
    parts.push(ones[remaining]);
  }

  return parts.join(" ");
}

function wholeNumberWords(value: number) {
  if (value === 0) return "Zero";

  const groups = [
    { size: 1_000_000_000, label: "Billion" },
    { size: 1_000_000, label: "Million" },
    { size: 1_000, label: "Thousand" },
  ];
  const parts: string[] = [];
  let remaining = Math.floor(value);

  for (const group of groups) {
    if (remaining >= group.size) {
      parts.push(
        `${underThousand(Math.floor(remaining / group.size))} ${group.label}`,
      );
      remaining %= group.size;
    }
  }
  if (remaining > 0) {
    parts.push(underThousand(remaining));
  }

  return parts.join(" ");
}

export function ringgitInWords(value: number) {
  const normalized = Math.max(0, Math.round(value * 100));
  const ringgit = Math.floor(normalized / 100);
  const sen = normalized % 100;
  const senText = sen ? ` And Sen ${wholeNumberWords(sen)}` : "";
  return `Ringgit Malaysia ${wholeNumberWords(ringgit)}${senText} Only`;
}

export function invoiceMonth(dateText: string) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).format(new Date(`${dateText.slice(0, 10)}T00:00:00+08:00`));
}

export function invoiceDate(dateText: string) {
  return formatMalaysiaDate(dateText.slice(0, 10));
}
