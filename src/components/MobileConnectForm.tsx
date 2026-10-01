"use client";

import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";

const deviceKeyStorage = "songzu.mobile.webDeviceKey";

function deviceIdentity() {
  let deviceKey = window.localStorage.getItem(deviceKeyStorage) || "";
  if (!deviceKey) {
    deviceKey = window.crypto.randomUUID();
    window.localStorage.setItem(deviceKeyStorage, deviceKey);
  }
  const userAgent = navigator.userAgent || "";
  const platform = /iphone|ipad/i.test(userAgent) ? "ios-web" : /android/i.test(userAgent) ? "android-web" : "mobile-web";
  const family = platform.startsWith("ios") ? "iPhone / iPad" : platform.startsWith("android") ? "Android" : "行動瀏覽器";
  return { deviceKey, platform, name: `${family} · ${deviceKey.slice(-4).toUpperCase()}` };
}

export function MobileConnectForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pair() {
    const normalized = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(normalized)) {
      setError("請輸入 Mac 顯示的 6 位數配對碼。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mobile/pairing/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized, ...deviceIdentity() })
      });
      const body = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !body.token) throw new Error(body.error || "主機沒有接受這次配對。");
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/mobile/pairing/session";
      for (const [name, value] of Object.entries({ token: body.token, returnTo: "/?mobileApp=1" })) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
    } catch (pairError) {
      setError(pairError instanceof Error ? pairError.message : "無法完成裝置配對。");
      setBusy(false);
    }
  }

  return (
    <div className="mobile-connect-form">
      <label htmlFor="mobile-pair-code"><KeyRound size={16} />6 位數配對碼</label>
      <input
        id="mobile-pair-code"
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/[^0-9 ]/g, "").slice(0, 7))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000 000"
      />
      <button className="button primary" type="button" onClick={() => void pair()} disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}
        {busy ? "正在配對" : "安全連接"}
      </button>
      {error && <p className="mobile-connect-error" role="alert">{error}</p>}
    </div>
  );
}
