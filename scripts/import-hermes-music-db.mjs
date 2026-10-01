const baseUrl = (process.env.SONGZU_MUSIC_OS_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

try {
  const response = await fetch(`${baseUrl}/api/music-references`, { method: "POST" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  process.stdout.write(`${JSON.stringify(payload.report, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`匯入失敗：${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(`請先啟動頌祖音樂 OS，再重新執行 npm run references:import。\n`);
  process.exitCode = 1;
}
