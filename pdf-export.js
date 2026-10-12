"use strict";
// Builds an A4 PDF, one page per day, laid out like the original "My Daily Tracker"
// worksheet. Needs vendor/pdf-lib.min.js (global PDFLib), loaded on demand by app.js.
//
// Coordinates are PDF points with the origin at the bottom-left. Positions and colours
// were measured from the original worksheet.

(function () {
  const PAGE_W = 595.28, PAGE_H = 841.89;
  const L = 26, R = 563;                       // table left/right edges
  const COLS = [26, 67, 230, 420, 563];        // time | nutrition | activities | how I feel
  const SCALE_X = [64, 110, 161, 213, 264, 316, 367, 419, 470, 518];
  const BOTTOM = 32;                           // lowest y content may use
  const TABLE_BOTTOM_TARGET = 253;             // the original's table ends here on a one-page day
  const PAD = 4;
  const BODY = 8, SMALL = 6.5, LABEL = 8.5;

  let C; // colours, filled once PDFLib is available

  function wrap(text, font, size, width) {
    const out = [];
    for (const para of String(text || "").split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        let w = word;
        // break words longer than the cell
        while (font.widthOfTextAtSize(w, size) > width) {
          let i = w.length - 1;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
          if (line) { out.push(line); line = ""; }
          out.push(w.slice(0, i)); w = w.slice(i);
        }
        const trial = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(trial, size) <= width) line = trial;
        else { out.push(line); line = w; }
      }
      out.push(line);
    }
    while (out.length && !out[out.length - 1]) out.pop();
    return out;
  }

  // Standard PDF fonts only cover Western European characters. Drop emoji and swap
  // anything else the font can't draw for "?" rather than failing the whole export.
  function makeSafe(font) {
    const ok = new Map();
    const swaps = { "→": "->", "←": "<-", "↑": "^", "↓": "v", "⇒": "=>", "≥": ">=", "≤": "<=", "≠": "!=", "✓": "", "✔": "", "−": "-" };
    return (s) => [...String(s || "").replace(/\p{Extended_Pictographic}️?/gu, "")
      .replace(/[→←↑↓⇒≥≤≠✓✔−]/g, (c) => swaps[c]).replace(/\t/g, " ").replace(/\r/g, "")]
      .map((ch) => {
        if (ch === "\n") return ch;
        if (!ok.has(ch)) { try { font.widthOfTextAtSize(ch, 10); ok.set(ch, true); } catch { ok.set(ch, false); } }
        return ok.get(ch) ? ch : "?";
      }).join("");
  }

  function spaced(page, text, { x, y, size, font, color, spacing = 0.8, center = false }) {
    let w = 0;
    for (const ch of text) w += font.widthOfTextAtSize(ch, size) + spacing;
    w -= spacing;
    let cx = center ? x - w / 2 : x;
    for (const ch of text) {
      page.drawText(ch, { x: cx, y, size, font, color });
      cx += font.widthOfTextAtSize(ch, size) + spacing;
    }
  }

  function face(page, cx, cy, happy) {
    const { rgb } = PDFLib;
    const ink = rgb(0.2, 0.2, 0.2);
    page.drawCircle({ x: cx, y: cy, size: 4.6, borderColor: ink, borderWidth: 0.6 });
    page.drawCircle({ x: cx - 1.5, y: cy + 1.2, size: 0.5, color: ink });
    page.drawCircle({ x: cx + 1.5, y: cy + 1.2, size: 0.5, color: ink });
    // drawSvgPath uses SVG's y-down coordinates relative to (x, y)
    const path = happy ? "M -2 0.6 Q 0 2.6 2 0.6" : "M -2 2.2 Q 0 0.4 2 2.2";
    page.drawSvgPath(path, { x: cx, y: cy, borderColor: ink, borderWidth: 0.6 });
  }

  function scale(page, f, y, label, value) {
    const { rgb } = PDFLib;
    page.drawText(label, { x: L + 2, y: y + 20, size: LABEL, font: f.bold, color: C.ink });
    // dotted line with arrowheads
    page.drawLine({ start: { x: L + 2, y }, end: { x: R - 1, y }, thickness: 0.7, color: C.grey, dashArray: [0.8, 1.6] });
    page.drawSvgPath("M 0 0 L 4 -2.2 L 4 2.2 Z", { x: L, y, color: C.grey });
    page.drawSvgPath("M 0 0 L -4 -2.2 L -4 2.2 Z", { x: R + 1, y, color: C.grey });
    SCALE_X.forEach((x, i) => {
      const n = String(i + 1);
      const w = f.reg.widthOfTextAtSize(n, 9);
      page.drawRectangle({ x: x - w / 2 - 1.5, y: y - 1.5, width: w + 3, height: 10, color: rgb(1, 1, 1) });
      page.drawText(n, { x: x - w / 2, y: y + 0.5, size: 9, font: f.reg, color: C.ink });
      if (value === i + 1) {
        page.drawEllipse({ x, y: y + 3.6, xScale: w / 2 + 6, yScale: 8.5, borderColor: C.navy, borderWidth: 1.2 });
      }
    });
    face(page, SCALE_X[0], y - 13, false);
    face(page, SCALE_X[9], y - 13, true);
  }

  function header(page, f, iso, entry, fmt, cont) {
    const { rgb } = PDFLib;
    page.drawRectangle({ x: 0, y: PAGE_H - 36, width: 164, height: 20, color: C.banner });
    const day = fmt.weekday(iso).toUpperCase() + (cont ? " (CONT.)" : "");
    spaced(page, day, { x: 82, y: PAGE_H - 29.5, size: 9, font: f.bold, color: rgb(1, 1, 1), center: true, spacing: 0.5 });
    page.drawLine({ start: { x: 58, y: PAGE_H }, end: { x: 58, y: PAGE_H - 9 }, thickness: 1.2, color: C.banner });

    page.drawText("Date:", { x: 396, y: PAGE_H - 29, size: 9, font: f.reg, color: C.ink });
    page.drawLine({ start: { x: 434, y: PAGE_H - 31 }, end: { x: 552, y: PAGE_H - 31 }, thickness: 0.6, color: C.ink });
    page.drawText(fmt.date(iso), { x: 438, y: PAGE_H - 29, size: 9, font: f.reg, color: C.ink });
    if (!cont && entry.water) {
      const t = `Water: ${entry.water} glass${entry.water === 1 ? "" : "es"}`;
      page.drawText(t, { x: 552 - f.reg.widthOfTextAtSize(t, 8), y: PAGE_H - 43, size: 8, font: f.reg, color: C.ink });
    }
  }

  function tableHeader(page, f, top) {
    const h = 27;
    const fills = [C.timeHead, C.mint, C.yellow, C.blue];
    const labels = ["TIME", "NUTRITION", "REST/MOVEMENT/ACTIVITIES", "HOW I FEEL"];
    for (let i = 0; i < labels.length; i++) {
      page.drawRectangle({ x: COLS[i], y: top - h, width: COLS[i + 1] - COLS[i], height: h, color: fills[i], borderColor: C.ink, borderWidth: 0.7 });
      spaced(page, labels[i], { x: (COLS[i] + COLS[i + 1]) / 2, y: top - h / 2 - 2.8, size: 7.5, font: f.bold, color: C.ink, center: true, spacing: i === 2 ? 0.5 : 0.8 });
    }
    return top - h;
  }

  // Lays out one time slot: returns the wrapped lines per column and the row height.
  function measureSlot(slot, f, safe) {
    const width = (i) => COLS[i + 1] - COLS[i] - PAD * 2;
    const cols = [
      wrap(safe(slot.time).toUpperCase(), f.reg, SMALL, width(0)),
      wrap(safe(slot.nutrition), f.reg, BODY, width(1)),
      wrap(safe(slot.activity), f.reg, BODY, width(2)),
      wrap(safe(slot.feel), f.reg, BODY, width(3)),
    ];
    const meal = safe(slot.meal).toUpperCase();
    const row = { cols, meal, lead: meal ? 10 : 0 }; // lead leaves room for the BREAKFAST / SNACK label
    row.h = Math.max(34, rowHeight(row));
    return row;
  }

  const lineHeight = (i) => (i === 0 ? SMALL : BODY) * 1.25;
  function rowHeight(row) {
    return Math.max(...row.cols.map((c, i) => (i === 1 ? row.lead : 0) + c.length * lineHeight(i))) + PAD * 2 + 2;
  }

  // Splits a row that is taller than `avail` into the part that fits and the rest.
  function splitRow(row, avail) {
    const head = { ...row, cols: [], h: avail };
    const rest = { cols: [], meal: "", lead: 0 };
    row.cols.forEach((c, i) => {
      const n = Math.max(0, Math.floor((avail - PAD * 2 - 2 - (i === 1 ? row.lead : 0)) / lineHeight(i)));
      head.cols.push(c.slice(0, n));
      rest.cols.push(i === 0 ? [] : c.slice(n));
    });
    rest.h = rowHeight(rest);
    return [head, rest];
  }

  function drawSlot(page, f, row, top, h) {
    page.drawRectangle({ x: L, y: top - h, width: R - L, height: h, color: PDFLib.rgb(1, 1, 1) });
    for (let i = 0; i < COLS.length - 1; i++) {
      page.drawRectangle({ x: COLS[i], y: top - h, width: COLS[i + 1] - COLS[i], height: h, borderColor: C.ink, borderWidth: 0.7 });
    }
    const lineH = BODY * 1.25;
    row.cols[0].forEach((ln, j) => page.drawText(ln, { x: COLS[0] + PAD, y: top - PAD - SMALL - j * SMALL * 1.25, size: SMALL, font: f.reg, color: C.ink }));
    if (row.meal) spaced(page, row.meal, { x: COLS[1] + PAD, y: top - PAD - SMALL, size: SMALL, font: f.reg, color: C.ink, spacing: 0.3 });
    for (let i = 1; i < COLS.length - 1; i++) {
      const start = top - PAD - BODY - (i === 1 ? row.lead : 0);
      row.cols[i].forEach((ln, j) => page.drawText(ln, { x: COLS[i] + PAD, y: start - j * lineH, size: BODY, font: f.reg, color: C.text }));
    }
  }

  function measureReview(entry, f, safe) {
    const qs = [
      ["Things that worked well?", entry.worked],
      ["Things that didn't work well?", entry.didnt],
      ["My main focus for tomorrow is:", entry.focus],
    ].map(([q, a]) => ({ q, lines: wrap(safe(a), f.reg, BODY, R - L - 4) }));
    const h = 16 + qs.reduce((s, x) => s + 12 + Math.max(2, x.lines.length) * BODY * 1.3 + 8, 0);
    return { qs, h };
  }

  function drawReview(page, f, rev, top) {
    let y = top;
    page.drawText("REVIEW", { x: L, y: y - 9, size: 9, font: f.bold, color: C.ink });
    y -= 16;
    for (const { q, lines } of rev.qs) {
      page.drawText(q, { x: L + 1, y: y - 9, size: 7.5, font: f.bold, color: C.ink });
      y -= 12;
      lines.forEach((ln, j) => page.drawText(ln, { x: L + 1, y: y - BODY - j * BODY * 1.3, size: BODY, font: f.reg, color: C.text }));
      y -= Math.max(2, lines.length) * BODY * 1.3 + 8;
    }
  }

  function addDay(doc, f, iso, entry, fmt) {
    const safe = makeSafe(f.reg);
    let page = doc.addPage([PAGE_W, PAGE_H]);
    header(page, f, iso, entry, fmt, false);
    scale(page, f, PAGE_H - 89, "Rate how you feel at the beginning of the day", entry.morning);
    let y = tableHeader(page, f, PAGE_H - 119);

    const rows = entry.slots.map((s) => measureSlot(s, f, safe));
    const rev = measureReview(entry, f, safe);
    const tail = 78 + rev.h; // end-of-day scale + review

    // If everything fits on one page, stretch the rows so the table reaches the
    // same depth as the printed worksheet.
    const total = rows.reduce((s, r) => s + r.h, 0);
    const room = y - TABLE_BOTTOM_TARGET;
    if (rows.length && total < room && TABLE_BOTTOM_TARGET - tail >= BOTTOM) {
      const extra = (room - total) / rows.length;
      rows.forEach((r) => { r.h += extra; });
    }

    const newTablePage = () => {
      page = doc.addPage([PAGE_W, PAGE_H]);
      header(page, f, iso, entry, fmt, true);
      y = tableHeader(page, f, PAGE_H - 60);
    };
    const fullPage = PAGE_H - 60 - 27 - BOTTOM;
    const queue = [...rows];
    while (queue.length) {
      const row = queue.shift();
      if (y - row.h >= BOTTOM) { drawSlot(page, f, row, y, row.h); y -= row.h; continue; }
      // Doesn't fit: move to a fresh page, unless the row is taller than a page
      // anyway, in which case fill what's left here and carry the rest over.
      if (row.h <= fullPage || y - BOTTOM < 60) { newTablePage(); queue.unshift(row); continue; }
      const [head, rest] = splitRow(row, y - BOTTOM);
      drawSlot(page, f, head, y, head.h);
      newTablePage();
      queue.unshift(rest);
    }

    if (y - tail < BOTTOM) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      header(page, f, iso, entry, fmt, true);
      y = PAGE_H - 60;
    }
    scale(page, f, y - 40, "Rate how you feel at the end of the day", entry.evening);
    drawReview(page, f, rev, y - 70);
  }

  window.buildTrackerPdf = async function (days, fmt) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    C = {
      ink: rgb(0.13, 0.13, 0.13),
      text: rgb(0.2, 0.2, 0.22),
      grey: rgb(0.45, 0.45, 0.45),
      banner: rgb(64 / 255, 86 / 255, 159 / 255),
      navy: rgb(43 / 255, 57 / 255, 144 / 255),
      timeHead: rgb(229 / 255, 225 / 255, 225 / 255),
      mint: rgb(220 / 255, 238 / 255, 223 / 255),
      yellow: rgb(242 / 255, 242 / 255, 215 / 255),
      blue: rgb(222 / 255, 233 / 255, 246 / 255),
    };
    const doc = await PDFDocument.create();
    doc.setTitle("My Daily Tracker");
    doc.setCreator("My Daily Tracker app");
    const f = {
      reg: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
    for (const { iso, entry } of days) addDay(doc, f, iso, entry, fmt);
    return doc.save();
  };
})();
