import NextLink from "next/link";
import type { ComponentProps } from "react";

type AppLinkProps = ComponentProps<typeof NextLink>;

export function Link({ prefetch = false, ...props }: AppLinkProps) {
  return <NextLink prefetch={prefetch} {...props} />;
}
