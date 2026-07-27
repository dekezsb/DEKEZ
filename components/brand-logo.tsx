import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  priority?: boolean;
  size?: number;
};

export function BrandLogo({
  className,
  priority = false,
  size = 72,
}: BrandLogoProps) {
  return (
    <Image
      alt="DEKEZ"
      className={cn("shrink-0 object-contain", className)}
      height={size}
      priority={priority}
      src="/dekez-logo.jpg"
      width={size}
    />
  );
}
