type RenderProject = {
  routes: Array<{ muted: boolean; routeType: string; destinationTrackId: string | null }>;
  tracks: Array<{ muted: boolean; polarityInverted: boolean; stereoMode: string; automationLanes: Array<{ enabled: boolean; mode: string }> }>;
};

// Reject rather than silently discard graph processing that the renderer cannot reproduce.
export function assertDawRenderSupported(project: RenderProject) {
  if (project.routes.some(route => !route.muted && (route.routeType !== "output" || route.destinationTrackId))) {
    throw new Error("目前 WAV / Stems 匯出尚未支援 Bus、Send、Cue 或 Sidechain 路由；已停止匯出，避免遺漏混音處理。");
  }
  if (project.tracks.some(track => !track.muted && track.automationLanes.some(lane => lane.enabled && lane.mode !== "off"))) {
    throw new Error("目前 WAV / Stems 匯出尚未支援 Automation；已停止匯出，避免交付與播放不同的設定。");
  }
  if (project.tracks.some(track => !track.muted && (track.polarityInverted || track.stereoMode !== "stereo"))) {
    throw new Error("目前 WAV / Stems 匯出尚未支援極性反轉或非 Stereo 模式；已停止匯出。");
  }
}
