const path = require("path");
const PDFDocument = require("pdfkit");
const {
  formatQuestionValue,
  isFileQuestion,
  extractFiles,
  getQuestionByHint,
} = require("./fillout");

const FONT_REGULAR = path.join(
  __dirname,
  "..",
  "assets",
  "fonts",
  "NotoSans-Regular.ttf",
);
const FONT_BOLD = path.join(
  __dirname,
  "..",
  "assets",
  "fonts",
  "NotoSans-Bold.ttf",
);

function cleanLabel(name) {
  return String(name)
    .replace(/^\d+[a-z]?\.\s*/i, "")
    .replace(/<\/?p>/gi, "")
    .trim();
}

function cleanLonaLabel(name) {
  return cleanLabel(name)
    .replace(/\s*[—\-–]\s*Lona\s*\d+/gi, "")
    .replace(/\s*\(\s*Lona\s*\d+\s*\)/gi, "")
    .trim();
}

function hasAnswer(question) {
  const value = question.value;
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function groupQuestions(questions) {
  const general = [];
  const byLona = new Map();

  for (const question of questions) {
    const match = question.name.match(/Lona\s*(\d+)/i);
    if (match) {
      const number = Number(match[1]);
      if (!byLona.has(number)) byLona.set(number, []);
      byLona.get(number).push(question);
    } else {
      general.push(question);
    }
  }

  const lonas = [...byLona.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, items]) => ({
      number,
      questions: items.filter(hasAnswer),
    }))
    .filter((group) => group.questions.length > 0);

  return { general, lonas };
}

function submissionTitle(sub) {
  const negocio = getQuestionByHint(sub.questions, [
    "nombre comercial",
    "punto de venta",
  ]);
  const ejecutivo = getQuestionByHint(sub.questions, ["ejecutivo de ventas"]);
  const negocioVal = negocio ? formatQuestionValue(negocio) : "";
  if (negocioVal && negocioVal !== "—") return negocioVal;
  const ejecutivoVal = ejecutivo ? formatQuestionValue(ejecutivo) : "";
  if (ejecutivoVal && ejecutivoVal !== "—") return ejecutivoVal;
  return `Solicitud ${sub.submissionId.slice(0, 8)}`;
}

function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function safeFilename(name) {
  return String(name || "solicitud")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

async function fetchImageBuffer(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("image") && !url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i)) {
      // still try
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

function drawRoundRect(doc, x, y, w, h, r, fill) {
  doc.save();
  doc.path(
    `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`,
  );
  if (fill) doc.fill(fill);
  doc.restore();
}

function ensureSpace(doc, needed = 80) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
    return true;
  }
  return false;
}

function drawSectionTitle(doc, title, color = "#007f84") {
  ensureSpace(doc, 36);
  doc.moveDown(0.4);
  doc.font(FONT_BOLD).fontSize(12).fillColor(color).text(title);
  doc
    .moveTo(doc.page.margins.left, doc.y + 2)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
    .strokeColor("#d7e4f0")
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.5);
}

function drawFieldRow(doc, label, value, options = {}) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const labelW = width * 0.4;
  const valueW = width * 0.6;
  const padding = 8;

  doc.font(FONT_BOLD).fontSize(8.5);
  const labelHeight = doc.heightOfString(label, { width: labelW - padding * 2 });
  doc.font(FONT_REGULAR).fontSize(9.5);
  const valueHeight = doc.heightOfString(value || "—", {
    width: valueW - padding * 2,
  });
  const rowH = Math.max(labelHeight, valueHeight) + padding * 2;

  ensureSpace(doc, rowH + 4);
  const y = doc.y;
  const bg = options.alt ? "#f8fbfd" : "#ffffff";

  doc.save();
  doc.rect(left, y, width, rowH).fill(bg);
  doc.rect(left, y, 3, rowH).fill(options.accent || "#00a8a8");
  doc
    .moveTo(left, y + rowH)
    .lineTo(left + width, y + rowH)
    .strokeColor("#e8f0f6")
    .lineWidth(0.8)
    .stroke();
  doc.restore();

  doc
    .font(FONT_BOLD)
    .fontSize(8.5)
    .fillColor("#6b7f96")
    .text(label, left + padding + 4, y + padding, {
      width: labelW - padding * 2 - 4,
    });
  doc
    .font(FONT_REGULAR)
    .fontSize(9.5)
    .fillColor("#10233a")
    .text(value || "—", left + labelW + padding, y + padding, {
      width: valueW - padding * 2,
    });

  doc.y = y + rowH;
}

function fieldValue(question) {
  if (isFileQuestion(question.type)) {
    const files = extractFiles(question.value);
    return files.length
      ? files.map((f) => f.filename || "Archivo").join(", ")
      : "Sin archivo";
  }
  return formatQuestionValue(question);
}

async function buildSubmissionPdf(sub) {
  const title = submissionTitle(sub);
  const { general, lonas } = groupQuestions(sub.questions);
  const cantidad = getQuestionByHint(sub.questions, ["cantidad de lonas"]);
  const ejecutivo = getQuestionByHint(sub.questions, ["ejecutivo de ventas"]);
  const yaavser = getQuestionByHint(sub.questions, [
    "nombre completo del yaavser",
  ]);

  const imageQuestions = sub.questions.filter(
    (q) => isFileQuestion(q.type) && extractFiles(q.value).length,
  );
  const images = [];
  for (const q of imageQuestions) {
    for (const file of extractFiles(q.value)) {
      const buffer = await fetchImageBuffer(file.url);
      images.push({
        buffer,
        label: cleanLabel(q.name),
        filename: file.filename || "Archivo",
      });
    }
  }

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 36, bottom: 42, left: 40, right: 40 },
    info: {
      Title: `Solicitud ${title}`,
      Author: "YAAVS Mercadotecnia",
    },
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  // Header band
  doc.save();
  doc.rect(0, 0, doc.page.width, 118).fill("#f3fafb");
  doc.rect(0, 0, 8, 118).fill("#00a8a8");
  doc.restore();

  doc
    .font(FONT_BOLD)
    .fontSize(10)
    .fillColor("#007f84")
    .text("YAAVS MERCADOTECNIA", left, 28, { continued: false });
  doc
    .font(FONT_REGULAR)
    .fontSize(9)
    .fillColor("#6b7f96")
    .text("Solicitud de diseño y producción de lona");

  doc
    .font(FONT_BOLD)
    .fontSize(20)
    .fillColor("#10233a")
    .text(title, left, 58, { width: pageWidth - 20 });

  doc.y = 128;

  const chips = [
    ["Enviada", formatDate(sub.submissionTime)],
    ["Lonas", cantidad ? formatQuestionValue(cantidad) : String(lonas.length || 1)],
    ["Ejecutivo", ejecutivo ? formatQuestionValue(ejecutivo) : "—"],
    ["YAAVSER", yaavser ? formatQuestionValue(yaavser) : "—"],
  ];

  let chipX = left;
  const chipY = doc.y;
  for (const [label, value] of chips) {
    const text = `${label}: ${value}`;
    doc.font(FONT_REGULAR).fontSize(8);
    const w = Math.min(doc.widthOfString(text) + 16, pageWidth / 2 - 8);
    if (chipX + w > left + pageWidth) {
      chipX = left;
      doc.y = chipY + 24;
    }
    const y = doc.y;
    drawRoundRect(doc, chipX, y, w, 20, 8, "#ffffff");
    doc
      .roundedRect(chipX, y, w, 20, 8)
      .strokeColor("#d7e4f0")
      .lineWidth(0.8)
      .stroke();
    doc
      .font(FONT_REGULAR)
      .fontSize(8)
      .fillColor("#3d526a")
      .text(text, chipX + 8, y + 6, { width: w - 16, lineBreak: false });
    chipX += w + 8;
  }
  doc.y = Math.max(doc.y, chipY) + 28;

  if (images.length) {
    drawSectionTitle(doc, "Imágenes adjuntas");
    let col = 0;
    let rowTop = doc.y;
    const gap = 12;
    const cardW = (pageWidth - gap) / 2;
    const imgH = 120;

    for (const image of images) {
      ensureSpace(doc, imgH + 48);
      if (col === 0) rowTop = doc.y;
      const x = left + col * (cardW + gap);
      const y = rowTop;

      doc
        .roundedRect(x, y, cardW, imgH + 36, 10)
        .fillAndStroke("#ffffff", "#d7e4f0");
      doc.save();
      doc.rect(x, y, cardW, imgH).fill("#f3f8fc");
      doc.restore();

      if (image.buffer) {
        try {
          doc.image(image.buffer, x + 8, y + 8, {
            fit: [cardW - 16, imgH - 16],
            align: "center",
            valign: "center",
          });
        } catch {
          doc
            .font(FONT_REGULAR)
            .fontSize(9)
            .fillColor("#6b7f96")
            .text("Sin vista previa", x, y + imgH / 2 - 6, {
              width: cardW,
              align: "center",
            });
        }
      } else {
        doc
          .font(FONT_REGULAR)
          .fontSize(9)
          .fillColor("#6b7f96")
          .text("Sin vista previa", x, y + imgH / 2 - 6, {
            width: cardW,
            align: "center",
          });
      }

      doc
        .font(FONT_BOLD)
        .fontSize(8)
        .fillColor("#10233a")
        .text(image.label, x + 8, y + imgH + 6, { width: cardW - 16 });
      doc
        .font(FONT_REGULAR)
        .fontSize(7.5)
        .fillColor("#6b7f96")
        .text(image.filename, x + 8, y + imgH + 18, { width: cardW - 16 });

      col += 1;
      if (col === 2) {
        col = 0;
        doc.y = rowTop + imgH + 48;
      }
    }
    if (col === 1) doc.y = rowTop + imgH + 48;
  }

  drawSectionTitle(doc, "Información general");
  general.forEach((question, index) => {
    drawFieldRow(doc, cleanLabel(question.name), fieldValue(question), {
      alt: index % 2 === 1,
      accent: index % 2 === 1 ? "#ff6b2c" : "#00a8a8",
    });
  });

  lonas.forEach((group, groupIndex) => {
    drawSectionTitle(
      doc,
      `Lona ${group.number} — Especificaciones`,
      groupIndex % 2 === 1 ? "#c2410c" : "#007f84",
    );
    group.questions.forEach((question, index) => {
      drawFieldRow(doc, cleanLonaLabel(question.name), fieldValue(question), {
        alt: index % 2 === 1,
        accent: groupIndex % 2 === 1 ? "#ff6b2c" : "#00a8a8",
      });
    });
  });

  ensureSpace(doc, 40);
  doc.moveDown(1);
  doc
    .font(FONT_REGULAR)
    .fontSize(8)
    .fillColor("#6b7f96")
    .text(`ID: ${sub.submissionId}`, { continued: false });
  doc.text(`Generado: ${formatDate(new Date().toISOString())}`);

  doc.end();
  const buffer = await done;
  return {
    buffer,
    filename: `solicitud-${safeFilename(title)}.pdf`,
  };
}

module.exports = {
  buildSubmissionPdf,
  submissionTitle,
};
