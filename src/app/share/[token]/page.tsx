import { notFound } from "next/navigation";

import { fileTypeLabel } from "@/lib/music";
import { pitchPackInclude, toPitchPackDto } from "@/lib/pitch";
import { prisma } from "@/lib/prisma";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;
  const pack = await prisma.pitchPack.findUnique({
    where: { token },
    include: pitchPackInclude
  });

  if (!pack) notFound();

  const dto = toPitchPackDto(pack);

  return (
    <>
      <header className="page-header">
        <div className="stack">
          <span className="eyebrow">私密分享包</span>
          <h1>{dto.title}</h1>
          {dto.description && <p className="subtle">{dto.description}</p>}
        </div>
      </header>

      <section className="stack section">
        {dto.songs.map((song) => {
          const primaryLyrics = song.lyricsVersions.find((version) => version.isPrimary) ?? song.lyricsVersions[0];
          const playableFiles = song.audioFiles.filter((file) => file.storageProvider === "local_upload" && file.filePath);
          return (
            <article className="panel pad stack" key={song.id}>
              <div className="toolbar">
                <div>
                  <h2>{song.title}</h2>
                  <p className="muted">
                    {song.genre ?? "曲風待填"} · {song.bpm ?? "--"} BPM · {song.musicalKey ?? "調性待填"}
                  </p>
                </div>
                <span className="tag green">{song.statusLabel}</span>
              </div>

              {song.summary && <p>{song.summary}</p>}

              <div className="small-list">
                {playableFiles.map((file) => (
                  <div className="share-audio-row" key={file.id}>
                    <div>
                      <strong>{file.fileName}</strong>
                      <p className="muted">{fileTypeLabel(file.fileType)}</p>
                    </div>
                    <audio controls src={`/api/share/${dto.token}/files/${file.id}`} />
                    {dto.allowDownload && (
                      <a className="button" href={`/api/share/${dto.token}/files/${file.id}?download=1`} target="_blank">
                        下載
                      </a>
                    )}
                  </div>
                ))}
              </div>

              {dto.showLyrics && primaryLyrics && (
                <div className="share-copy">
                  <h3>歌詞摘要</h3>
                  <p>{primaryLyrics.content.slice(0, 420)}</p>
                </div>
              )}

              {dto.showCredits && song.credits.length > 0 && (
                <div className="tag-row">
                  {song.credits.map((credit) => (
                    <span className="tag" key={credit.id}>
                      {credit.contributor.name} · {credit.role}
                    </span>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </section>

      {dto.showContact && dto.contactInfo && (
        <section className="section">
          <div className="panel pad">
            <h2>聯絡資訊</h2>
            <p className="subtle">{dto.contactInfo}</p>
          </div>
        </section>
      )}
    </>
  );
}
