"use client";

import { AudioLines, CheckCircle2, Lock, Mic2, MonitorSmartphone, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";

type DeviceState = {
  deviceLabel: string;
  touch: boolean;
  secure: boolean;
  microphone: boolean;
  mediaRecorder: boolean;
  webAudio: boolean;
  standalone: boolean;
};

function readDeviceState(): DeviceState {
  const width = window.innerWidth;
  const webkitAudio = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

  return {
    deviceLabel: width <= 620 ? "手機介面" : width <= 1100 ? "平板介面" : "電腦介面",
    touch: window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0,
    secure: window.isSecureContext,
    microphone: Boolean(navigator.mediaDevices?.getUserMedia),
    mediaRecorder: typeof MediaRecorder !== "undefined",
    webAudio: Boolean(window.AudioContext || webkitAudio.webkitAudioContext),
    standalone
  };
}

export function DeviceReadinessPanel() {
  const [state, setState] = useState<DeviceState | null>(null);

  useEffect(() => {
    const sync = () => setState(readDeviceState());
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const recordingReady = Boolean(state?.secure && state.microphone && state.mediaRecorder && state.webAudio);

  return (
    <div className="install-app-panel device-readiness-panel">
      <div className="toolbar">
        <div>
          <h2>目前裝置相容性</h2>
          <p className="muted">自動檢查這台手機、平板或電腦目前可用的操作能力。</p>
        </div>
        <span className={recordingReady ? "tag green" : "tag warn"}>{recordingReady ? "錄音環境就緒" : "管理功能可用"}</span>
      </div>

      <div className="install-status-grid device-capability-grid">
        <span>
          <MonitorSmartphone size={18} />
          <strong>{state?.deviceLabel ?? "讀取中"}</strong>
          {state?.touch ? "觸控操作" : "滑鼠 / 鍵盤操作"}
        </span>
        <span>
          <Lock size={18} />
          <strong>{state?.secure ? "安全連線" : "一般 HTTP"}</strong>
          {state?.secure ? "可使用受保護裝置功能" : "瀏覽與管理可用"}
        </span>
        <span>
          <Mic2 size={18} />
          <strong>{recordingReady ? "可啟動" : "需要 HTTPS"}</strong>
          麥克風與錄音
        </span>
        <span>
          <AudioLines size={18} />
          <strong>{state?.webAudio ? "可用" : "不支援"}</strong>
          Web Audio 播放與分析
        </span>
        <span>
          <CheckCircle2 size={18} />
          <strong>{state?.standalone ? "App 模式" : "瀏覽器模式"}</strong>
          顯示模式
        </span>
      </div>

      {!recordingReady && state && (
        <div className="system-note compact">
          <ShieldAlert size={18} color="var(--warn)" />
          <span>
            目前仍可整理歌曲、上傳檔案、播放、留言與控制 DAW。手機／平板要直接使用麥克風錄音，請改用本機 HTTPS 入口並允許麥克風權限。
          </span>
        </div>
      )}
    </div>
  );
}
