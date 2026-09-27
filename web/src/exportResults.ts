import { buildResultRows, resultsCsv, resultsFilename } from "../../src/resultsExport";
import type { LiveAthlete, LiveState } from "./api";

export { resultsCsv, resultsFilename };

export function downloadResults(state: LiveState, athletes: LiveAthlete[], format: "csv" | "png" | "pdf"): void {
  if (format === "csv") {
    downloadBlob(new Blob([resultsCsv(state, athletes)], { type: "text/csv;charset=utf-8" }), resultsFilename(state, "csv"));
    return;
  }
  const canvas = renderResultsCanvas(state, athletes);
  if (format === "png") {
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, resultsFilename(state, "png"));
    }, "image/png");
    return;
  }
  const jpeg = dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92));
  downloadBlob(buildJpegPdf(canvas.width, canvas.height, jpeg), resultsFilename(state, "pdf"));
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderResultsCanvas(state: LiveState, athletes: LiveAthlete[]): HTMLCanvasElement {
  const rows = buildResultRows(state, athletes);
  const splitCount = state.timingPoints.length;
  const colW = [56, 220, 80, 120, 90, ...Array(splitCount).fill(90), 90, 160];
  const tableW = colW.reduce((sum, width) => sum + width, 0);
  const pad = 40;
  const titleH = 86;
  const rowH = 34;
  const width = tableW + pad * 2;
  const height = pad + titleH + rowH * (rows.length + 1) + pad;
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#14200a";
  ctx.font = "700 28px system-ui, sans-serif";
  ctx.fillText(state.event.name, pad, pad + 28);
  ctx.font = "500 16px system-ui, sans-serif";
  ctx.fillStyle = "#5b675c";
  ctx.fillText(`${state.event.meetName}  ·  SplitMesh results`, pad, pad + 54);

  const headers = ["Pl", "Name", "Gender", "Grade", "Total", ...state.timingPoints.map((point) => point.name), "PR", "PR note"];
  let y = pad + titleH;
  drawRow(ctx, pad, y, colW, headers, true, false);
  rows.forEach((row, index) => {
    y += rowH;
    drawRow(
      ctx,
      pad,
      y,
      colW,
      [row.place, row.name, row.gender, row.grade, row.total, ...row.splits, row.pr, row.prNote],
      false,
      Boolean(row.prNote),
      index % 2 === 1,
    );
  });
  return canvas;
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  colW: number[],
  cells: string[],
  header: boolean,
  pr: boolean,
  zebra = false,
) {
  const height = 34;
  const rowW = colW.reduce((sum, width) => sum + width, 0);
  if (header) ctx.fillStyle = "#1a221c";
  else if (pr) ctx.fillStyle = "#fff6d4";
  else if (zebra) ctx.fillStyle = "#f4f1e8";
  else ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, rowW, height);
  ctx.strokeStyle = "#d7ddd6";
  ctx.strokeRect(x, y, rowW, height);
  ctx.font = header ? "700 13px system-ui, sans-serif" : "500 13px system-ui, sans-serif";
  ctx.fillStyle = header ? "#d7f36a" : pr ? "#8a6a00" : "#14200a";
  let left = x + 8;
  cells.forEach((cell, index) => {
    ctx.fillText(cell, left, y + 22, colW[index]! - 12);
    left += colW[index]!;
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildJpegPdf(imageWidth: number, imageHeight: number, jpeg: Uint8Array): Blob {
  const pageW = 612;
  const pageH = 792;
  const margin = 36;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const scale = Math.min(maxW / imageWidth, maxH / imageHeight, 1);
  const drawW = imageWidth * scale;
  const drawH = imageHeight * scale;
  const x = (pageW - drawW) / 2;
  const y = pageH - margin - drawH;
  const content = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let size = 0;

  function push(bytes: Uint8Array) {
    chunks.push(bytes);
    size += bytes.length;
  }
  function pushStr(text: string) {
    push(encoder.encode(text));
  }
  function startObj(id: number) {
    offsets[id] = size;
    pushStr(`${id} 0 obj\n`);
  }
  function endObj() {
    pushStr("\nendobj\n");
  }

  pushStr("%PDF-1.4\n");
  startObj(1);
  pushStr("<< /Type /Catalog /Pages 2 0 R >>");
  endObj();
  startObj(2);
  pushStr("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  endObj();
  startObj(3);
  pushStr(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  endObj();
  startObj(4);
  pushStr(
    `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  pushStr("\nendstream");
  endObj();
  startObj(5);
  const contentBytes = encoder.encode(content);
  pushStr(`<< /Length ${contentBytes.length} >>\nstream\n`);
  push(contentBytes);
  pushStr("\nendstream");
  endObj();

  const xrefPos = size;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pushStr(xref);
  pushStr(`trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return new Blob([out], { type: "application/pdf" });
}
