import { existsSync } from "node:fs";

import PDFDocument from "pdfkit";

import {
  autoScoreSheetSections,
  autoScoreSheetTokens,
  buildAutoScoreStrummingVariant,
  type AutoScoreResult,
  type AutoScoreStrumStroke
} from "@/lib/auto-score";

const CJK_FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/System/Library/Fonts/STHeiti Light.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc"
];

function chunkItems<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

function cjkFontPath() {
  return CJK_FONT_CANDIDATES.find((candidate) => existsSync(candidate));
}

function strumStrokeLabel(stroke: AutoScoreStrumStroke) {
  return stroke === "down" ? "↓" : stroke === "up" ? "↑" : stroke === "mute" ? "×" : "-";
}

type ChordSheetPdfOptions = {
  title?: string;
  artist?: string;
};

export async function autoScoreToChordSheetPdf(
  result: AutoScoreResult,
  fallbackTitle: string,
  options: ChordSheetPdfOptions = {}
) {
  const identity = result.verification?.officialMetadata;
  const title = identity?.title ?? options.title ?? fallbackTitle;
  const artist = identity?.artist ?? options.artist ?? "未填寫歌手";
  const key = identity?.key ?? result.musicalKey;
  const bpm = result.verification?.recordingGrid?.bpm ?? result.bpm;
  const meter = result.verification?.recordingGrid?.meter ?? result.timeSignature;
  const sections = autoScoreSheetSections(result);
  const measureCount = sections.reduce((total, section) => total + section.measures.length, 0);
  const revision = result.review?.revision ?? 1;
  const finalizedAtMs = result.review?.finalizedAt
    ? Date.parse(result.review.finalizedAt)
    : Number.NaN;
  // PDFKit otherwise injects the wall-clock creation time, which makes the
  // owner-private export hash change between catalog lookup and download.
  // A locked score already has an authoritative finalization timestamp; draft
  // exports use a fixed epoch so the same current result always has one PDF.
  const documentTimestamp = new Date(
    Number.isFinite(finalizedAtMs) ? finalizedAtMs : Date.UTC(2000, 0, 1)
  );
  const insertedMeasureCount = result.sheetArrangement?.insertions.length ?? 0;
  const deletedMeasureCount = result.sheetArrangement?.deletions?.length ?? 0;
  const isFinalized = result.review?.status === "finalized" && result.review.verificationMethod === "manual";
  const scoreLabel = isFinalized ? "完整吉他譜" : "吉他和弦譜 · 校對草稿";
  const footerLabel = isFinalized ? `人工確認正式譜 v${revision}` : `待人工校對 · 草稿 v${revision}`;
  const cjkFont = cjkFontPath();
  if (!cjkFont) throw new Error("找不到可輸出中文吉他譜的 macOS Unicode 字型");
  const margin = 42;
  const footerY = 774;
  const contentBottom = 752;
  const measureRowHeight = 34;
  const pageWidth = 595.28;
  const contentWidth = pageWidth - margin * 2;
  const doc = new PDFDocument({
    size: "A4",
    font: cjkFont,
    margins: { top: margin, right: margin, bottom: 56, left: margin },
    info: {
      Title: `${artist} - ${title} - ${scoreLabel}`,
      Author: "頌祖音樂 OS",
      Subject: isFinalized ? "人工確認的完整吉他和弦譜" : "尚待人工校對的吉他和弦草稿",
      CreationDate: documentTimestamp,
      ModDate: documentTimestamp
    },
    bufferPages: true
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.registerFont("SongzuCJK", cjkFont);
  const cjk = "SongzuCJK";
  const ink = "#20252d";
  const muted = "#707783";
  const chordBlue = "#315f92";
  const titleBlue = "#353e78";
  const line = "#d9dde3";
  let pageNumber = 1;
  let y = margin;

  const drawFooter = () => {
    doc.save();
    doc.moveTo(margin, footerY - 9).lineTo(pageWidth - margin, footerY - 9).lineWidth(0.45).strokeColor(line).stroke();
    doc.font(cjk).fontSize(7.5).fillColor(muted).text(`頌祖音樂 OS · ${footerLabel}`, margin, footerY, { width: contentWidth / 2 });
    doc.font(cjk).text(`Page ${pageNumber}`, pageWidth - margin - 80, footerY, { width: 80, align: "right" });
    doc.restore();
  };

  const drawContinuationHeader = () => {
    doc.font(cjk).fontSize(13).fillColor(titleBlue).text(title, margin, margin, { width: contentWidth * 0.62 });
    doc.font(cjk).fontSize(8).fillColor(muted).text(`${artist} · ${key} · ${bpm} BPM · ${meter}`, pageWidth - margin - 205, margin + 2, { width: 205, align: "right" });
    doc.moveTo(margin, margin + 23).lineTo(pageWidth - margin, margin + 23).lineWidth(0.6).strokeColor(line).stroke();
    y = margin + 35;
  };

  const addPage = () => {
    drawFooter();
    doc.addPage();
    pageNumber += 1;
    drawContinuationHeader();
  };

  const drawStrummingPattern = (
    pattern: NonNullable<AutoScoreResult["strummingGuide"]>["patterns"][number]
  ) => {
    const subdivision = result.strummingGuide?.defaultSubdivision ?? pattern.subdivision;
    const variant = buildAutoScoreStrummingVariant(pattern, subdivision);
    const labelWidth = 88;
    const gridX = margin + labelWidth;
    const gridWidth = contentWidth - labelWidth;
    const groupGap = 3;
    const groupWidth = (gridWidth - groupGap * (variant.groups.length - 1)) / variant.groups.length;
    const rowHeight = 32;

    doc.font(cjk).fontSize(7.6).fillColor(ink).text(pattern.label, margin, y + 5, { width: labelWidth - 8 });
    doc.font(cjk).fontSize(6).fillColor(muted).text(variant.shortLabel, margin, y + 18, { width: labelWidth - 8 });

    variant.groups.forEach((group, groupIndex) => {
      const groupX = gridX + groupIndex * (groupWidth + groupGap);
      doc.roundedRect(groupX, y, groupWidth, 28, 2).fillAndStroke("#f7f9fc", "#bdc7d5");
      doc.font(cjk).fontSize(5.8).fillColor(muted).text(group.label, groupX + 2, y + 2, {
        width: groupWidth - 4,
        align: "center",
        lineBreak: false
      });
      const cellWidth = groupWidth / Math.max(1, group.cells.length);
      group.cells.forEach((cell, cellIndex) => {
        const cellX = groupX + cellIndex * cellWidth;
        if (cellIndex > 0) {
          doc.moveTo(cellX, y + 10).lineTo(cellX, y + 27).lineWidth(0.3).strokeColor("#dbe0e8").stroke();
        }
        if (cell.accent) {
          doc.moveTo(cellX + 2, y + 10).lineTo(cellX + cellWidth - 2, y + 10).lineWidth(1.1).strokeColor(titleBlue).stroke();
        }
        doc.font(cjk).fontSize(4.8).fillColor(muted).text(cell.count, cellX, y + 11, {
          width: cellWidth,
          align: "center",
          lineBreak: false
        });
        doc.font(cjk).fontSize(8.2).fillColor(chordBlue).text(strumStrokeLabel(cell.stroke), cellX, y + 18, {
          width: cellWidth,
          align: "center",
          lineBreak: false
        });
      });
    });
    y += rowHeight;
  };

  doc.font(cjk).fontSize(9.5).fillColor(ink).text(`歌手：${artist}`, margin, y + 8, { width: 165 });
  doc.font(cjk).fontSize(8).fillColor(muted).text(scoreLabel, margin, y - 4, { width: 165 });
  doc.font(cjk).fontSize(25).fillColor(titleBlue).text(title, margin + 140, y, { width: contentWidth - 280, align: "center" });
  doc.font(cjk).fontSize(9).fillColor(ink).text(`調性：${key}`, pageWidth - margin - 150, y - 2, { width: 150, align: "right" });
  doc.font(cjk).text(`速度：${bpm} BPM　拍號：${meter}`, pageWidth - margin - 150, y + 14, { width: 150, align: "right" });
  const arrangementSummary = [
    insertedMeasureCount ? `+${insertedMeasureCount}` : "",
    deletedMeasureCount ? `-${deletedMeasureCount}` : ""
  ].filter(Boolean).join(" / ");
  doc.font(cjk).fontSize(8).fillColor(muted).text(`${isFinalized ? "正式譜" : "校對草稿"} v${revision} · ${measureCount} 小節${arrangementSummary ? ` · 人工編排 ${arrangementSummary}` : ""}`, pageWidth - margin - 170, y + 31, { width: 170, align: "right" });
  y += 58;
  doc.moveTo(margin, y).lineTo(pageWidth - margin, y).lineWidth(0.8).strokeColor(line).stroke();
  y += 11;

  doc.font(cjk).fontSize(8).fillColor(muted).text("記譜：每格一拍，_ 代表延續前一拍，| 代表小節線。", margin, y, { width: contentWidth });
  y += 16;
  if (result.strummingGuide?.patterns.length) {
    doc.font(cjk).fontSize(8.3).fillColor(ink).text("參考刷法 · 每拍獨立分界", margin, y, { width: contentWidth });
    y += 14;
    result.strummingGuide.patterns.slice(0, 2).forEach(drawStrummingPattern);
    y += 5;
  }

  for (const section of sections) {
    const rows = chunkItems(section.measures, 4);
    if (y + 24 + measureRowHeight > contentBottom) addPage();
    doc.font(cjk).fontSize(11).fillColor(ink).text(`[${section.label}]`, margin, y, { width: 140 });
    doc.font(cjk).fontSize(7.5).fillColor(muted).text(
      section.firstMeasure === section.lastMeasure ? `第 ${section.firstMeasure} 小節` : `${section.firstMeasure}-${section.lastMeasure} 小節`,
      pageWidth - margin - 110,
      y + 2,
      { width: 110, align: "right" }
    );
    y += 20;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      if (y + measureRowHeight > contentBottom) {
        addPage();
        doc.font(cjk).fontSize(10).fillColor(ink).text(`[${section.label} · 續]`, margin, y, { width: 160 });
        y += 19;
      }
      const row = rows[rowIndex];
      const barWidth = contentWidth / 4;
      doc.moveTo(margin, y + 32).lineTo(pageWidth - margin, y + 32).lineWidth(0.35).strokeColor("#e5e7eb").stroke();
      for (let index = 0; index < row.length; index += 1) {
        const measure = row[index];
        const x = margin + index * barWidth;
        const notation = `| ${autoScoreSheetTokens(measure.beats).join(" ")} |`;
        const notationWidth = barWidth - 8;
        const notationBaseSize = 11.2;
        doc.font(cjk).fontSize(notationBaseSize);
        const measuredWidth = doc.widthOfString(notation);
        const notationSize = Math.max(
          7.2,
          Math.min(notationBaseSize, notationBaseSize * (notationWidth / Math.max(1, measuredWidth)))
        );
        doc.font(cjk).fontSize(6.8).fillColor(measure.inserted ? titleBlue : muted).text(
          measure.inserted ? `${measure.number} · ARR.` : String(measure.number),
          x + 4,
          y,
          { width: barWidth - 8, height: 9 }
        );
        doc.font(cjk).fontSize(notationSize).fillColor(chordBlue).text(notation, x + 4, y + 12, {
          width: notationWidth,
          lineBreak: false,
          ellipsis: false
        });
      }
      y += measureRowHeight;
    }
    y += 6;
  }

  drawFooter();
  doc.end();
  return completed;
}
