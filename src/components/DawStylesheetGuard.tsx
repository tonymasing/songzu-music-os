"use client";

import { useEffect } from "react";
import { installDawStyleRecovery } from "@/lib/daw-style-recovery";

export function DawStylesheetGuard() {
  // Reinstall the observer when Fast Refresh replaces its implementation.
  useEffect(installDawStyleRecovery, [installDawStyleRecovery]);
  return null;
}
