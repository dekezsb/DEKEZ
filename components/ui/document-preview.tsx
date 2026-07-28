import { ExternalLink, FileText } from "lucide-react";

type DocumentPreviewProps = {
  url?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  label: string;
  size?: "sm" | "md";
  showName?: boolean;
};

const sizeClasses = {
  sm: "h-16 w-16",
  md: "h-24 w-32",
};

function fileKind(
  contentType?: string | null,
  fileName?: string | null,
  url?: string | null,
) {
  const source = `${contentType ?? ""} ${fileName ?? ""} ${url ?? ""}`.toLowerCase();

  if (
    contentType?.startsWith("image/")
    || /\.(?:avif|gif|jpe?g|png|webp)(?:\?|$)/i.test(source)
  ) {
    return "image";
  }

  if (contentType === "application/pdf" || /\.pdf(?:\?|$)/i.test(source)) {
    return "pdf";
  }

  return "file";
}

export function DocumentPreview({
  url,
  fileName,
  contentType,
  label,
  size = "md",
  showName = true,
}: DocumentPreviewProps) {
  if (!url) return null;

  const kind = fileKind(contentType, fileName, url);

  return (
    <a
      className="group block min-w-0"
      href={url}
      rel="noreferrer"
      target="_blank"
      title={`Open ${label}`}
    >
      <span
        className={`relative flex overflow-hidden rounded-md border border-[#d7dde5] bg-[#f4f6f8] ${sizeClasses[size]}`}
      >
        {kind === "image" ? (
          <img
            alt={`${label} preview`}
            className="h-full w-full object-cover"
            loading="lazy"
            src={url}
          />
        ) : kind === "pdf" ? (
          <iframe
            aria-hidden="true"
            className="h-[240%] w-[240%] origin-top-left scale-[0.42] pointer-events-none"
            loading="lazy"
            src={`${url}#page=1&toolbar=0&navpanes=0&scrollbar=0`}
            tabIndex={-1}
            title={`${label} PDF preview`}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <FileText className="h-7 w-7 text-[#9a6b12]" />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/65 px-1 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <ExternalLink className="h-3 w-3" />
          Open
        </span>
      </span>
      {showName ? (
        <span className={`mt-1 block truncate text-xs text-gray-600 ${size === "sm" ? "max-w-16" : "max-w-32"}`}>
          {fileName ?? label}
        </span>
      ) : null}
    </a>
  );
}
