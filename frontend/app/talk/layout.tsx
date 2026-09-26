import type { ReactNode } from "react";

import { BackendBanner } from "@/components/layout/BackendBanner";

export default function TalkLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <BackendBanner />
    </>
  );
}
