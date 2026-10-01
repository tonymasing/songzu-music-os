"use client";

import { useEffect } from "react";

export function PwaRuntime() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") return;

    // Development HTML, RSC payloads and chunks must come from the same live build.
    const workerUrl = process.env.NODE_ENV === "development" ? "/sw.js?runtime=development" : "/sw.js";

    navigator.serviceWorker
      .register(workerUrl, { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        // PWA registration is an enhancement; the app should keep working without it.
      });
  }, []);

  return null;
}
