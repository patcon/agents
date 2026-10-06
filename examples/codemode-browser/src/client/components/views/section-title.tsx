import type { ReactNode } from "react";
import { Text } from "@cloudflare/kumo";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" variant="secondary" bold>
      {children}
    </Text>
  );
}
