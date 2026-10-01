import Link from "next/link";

import { buildMetadataMatrix, metadataFields } from "@/lib/metadata";
import type { SongDto } from "@/lib/music";

const statusLabels = {
  complete: "完成",
  missing: "缺少",
  suggested: "建議補強"
};

export function MetadataMatrixWorkspace({ songs }: { songs: SongDto[] }) {
  const rows = buildMetadataMatrix(songs);
  const totalMissing = rows.reduce((sum, row) => sum + row.missingCount, 0);
  const totalSuggested = rows.reduce((sum, row) => sum + row.suggestedCount, 0);
  const totalComplete = rows.reduce((sum, row) => sum + row.completeCount, 0);
  const mostBlocked = rows.slice().sort((a, b) => b.missingCount - a.missingCount).slice(0, 4);
  const releaseCriticalFields = ["masterQuality", "cover", "credits", "split", "isrc", "upc", "releaseCopy", "shortVideo"];
  const criticalMissing = rows.reduce(
    (sum, row) => sum + row.cells.filter((cell) => releaseCriticalFields.includes(cell.key) && cell.status === "missing").length,
    0
  );

  return (
    <>
      <header className="dashboard-hero">
        <div className="stack">
          <span className="eyebrow">發行資料矩陣</span>
          <h1>發行缺口雷達。</h1>
          <p className="subtle">Master、核心 Metadata 與分潤會共用管理總控台的自動門檻，不再各頁分開計算。</p>
        </div>
        <div className="command-panel">
          <div>
            <span className="muted">發行資料完成度</span>
            <strong>{totalComplete + totalMissing + totalSuggested ? Math.round((totalComplete / (totalComplete + totalMissing + totalSuggested)) * 100) : 0}%</strong>
          </div>
          <div className="progress">
            <span style={{ width: `${totalComplete + totalMissing + totalSuggested ? Math.round((totalComplete / (totalComplete + totalMissing + totalSuggested)) * 100) : 0}%` }} />
          </div>
          <div className="command-grid">
            <span>缺少 {totalMissing}</span>
            <span>補強 {totalSuggested}</span>
            <span>發行關鍵 {criticalMissing}</span>
            <span>作品 {songs.length}</span>
          </div>
        </div>
      </header>

      <section className="grid-3 section">
        <div className="panel metric">
          <span>作品數</span>
          <strong>{songs.length}</strong>
        </div>
        <div className="panel metric">
          <span>缺少欄位</span>
          <strong>{totalMissing}</strong>
        </div>
        <div className="panel metric">
          <span>建議補強</span>
          <strong>{totalSuggested}</strong>
        </div>
      </section>

      <section className="section">
        <div className="panel pad stack">
          <div className="toolbar">
            <div>
              <h2>優先補齊</h2>
              <p className="muted">先處理缺口最多、會直接阻擋發行的歌曲。</p>
            </div>
          </div>
          <div className="recent-grid">
            {mostBlocked.map((row) => (
              <Link className="recent-card" href={`/songs/${row.song.id}`} key={row.song.id}>
                <span className="tag warn">{row.missingCount} 缺少</span>
                <strong>{row.song.title}</strong>
                <span className="muted">{row.song.readinessLabel} · {row.song.readiness}%</span>
                <div className="tag-row">
                  {row.cells
                    .filter((cell) => cell.status !== "complete")
                    .slice(0, 4)
                    .map((cell) => (
                      <span className={cell.status === "missing" ? "tag danger" : "tag warn"} key={cell.key}>
                        {cell.label}
                      </span>
                    ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="matrix-scroll panel">
          <table className="table matrix-table">
            <thead>
              <tr>
                <th>歌曲</th>
                {metadataFields.map((field) => (
                  <th key={field.key}>{field.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.song.id}>
                  <td>
                    <Link className="song-title" href={`/songs/${row.song.id}`}>
                      <span>{row.song.title}</span>
                      <span className="muted">
                        {row.song.readinessLabel} · {row.song.readiness}%
                      </span>
                    </Link>
                  </td>
                  {row.cells.map((cell) => (
                    <td key={cell.key}>
                      <Link className={`matrix-cell ${cell.status}`} href={`/songs/${row.song.id}`}>
                        <span>{statusLabels[cell.status]}</span>
                        <small>{cell.note}</small>
                      </Link>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
