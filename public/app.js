const POLL_MS = 8000;
const FILE_TYPES = new Set([
  "FileUpload",
  "ImagePicker",
  "Signature",
  "Camera",
]);

const state = {
  data: null,
  fingerprint: "",
  loading: true,
  selectedId: null,
  query: "",
  live: true,
  lastUpdated: null,
  lightbox: null,
  booted: false,
};

let pollTimer = null;

function isFileQuestion(type) {
  return FILE_TYPES.has(type);
}

function extractFiles(value) {
  if (!value) return [];
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    return [{ url: value, filename: value.split("/").pop() }];
  }
  if (Array.isArray(value)) return value.flatMap(extractFiles);
  if (typeof value === "object" && typeof value.url === "string") {
    return [
      {
        url: value.url,
        filename: value.filename || value.name,
        contentType: value.contentType || value.type,
      },
    ];
  }
  return [];
}

function hasAnswer(question) {
  const value = question.value;
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function formatQuestionValue(question) {
  const { value, type } = question;
  if (value === null || value === undefined || value === "") return "—";
  if (isFileQuestion(type)) {
    const files = extractFiles(value);
    return files.length
      ? files.map((f) => f.filename || "Archivo").join(", ")
      : "Sin archivo";
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return value.join(", ");
    }
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          return item.label || item.value || item.name || String(item);
        }
        return String(item);
      })
      .join(", ");
  }
  if (typeof value === "object") {
    if (value.pretty) return value.pretty;
    if (value.formatted) return value.formatted;
    if (value.number != null) {
      return `${value.countryCode ? `+${value.countryCode} ` : ""}${value.number}`;
    }
    if (value.label) return value.label;
    if (value.value != null) return String(value.value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value);
}

function getQuestionByHint(questions, hints) {
  return questions.find((q) =>
    hints.some((hint) => q.name.toLowerCase().includes(hint.toLowerCase())),
  );
}

function cleanLabel(name) {
  return name.replace(/^\d+[a-z]?\.\s*/i, "").replace(/<\/?p>/gi, "").trim();
}

function cleanLonaLabel(name) {
  return cleanLabel(name)
    .replace(/\s*[—\-–]\s*Lona\s*\d+/gi, "")
    .replace(/\s*\(\s*Lona\s*\d+\s*\)/gi, "")
    .trim();
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

function submissionFiles(sub) {
  return sub.questions.flatMap((q) => {
    if (!isFileQuestion(q.type)) return [];
    return extractFiles(q.value).map((file) => ({
      ...file,
      questionName: cleanLabel(q.name),
    }));
  });
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

function dataFingerprint(payload) {
  const responses = payload?.responses || [];
  return [
    payload?.totalResponses ?? 0,
    payload?.error || "",
    ...responses.map(
      (r) => `${r.submissionId}:${r.lastUpdatedAt || r.submissionTime}`,
    ),
  ].join("|");
}

function downloadHref(file) {
  const params = new URLSearchParams({
    url: file.url,
    filename: file.filename || "imagen",
  });
  return `/api/download?${params.toString()}`;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderFieldRows(questions, { stripLonaLabel = false } = {}) {
  return questions
    .map((question, index) => {
      const files = isFileQuestion(question.type)
        ? extractFiles(question.value)
        : [];
      const label = stripLonaLabel
        ? cleanLonaLabel(question.name)
        : cleanLabel(question.name);
      return `<div class="field">
        <dt>${escapeHtml(label)}</dt>
        <dd>
          ${
            files.length
              ? `<ul class="file-links">${files
                  .map(
                    (file, i) => `<li>
                    <button type="button" data-lightbox='${escapeHtml(
                      JSON.stringify({
                        url: file.url,
                        filename: file.filename || "",
                        label,
                      }),
                    )}'>${escapeHtml(file.filename || `Archivo ${i + 1}`)}</button>
                    <a href="${downloadHref(file)}">Descargar</a>
                  </li>`,
                  )
                  .join("")}</ul>`
              : escapeHtml(formatQuestionValue(question))
          }
        </dd>
      </div>`;
    })
    .join("");
}

function renderGroupedAnswers(questions) {
  const { general, lonas } = groupQuestions(questions);
  return `
    <section class="fields-section">
      <div class="section-head"><h3>Respuestas generales</h3></div>
      <dl class="fields">${renderFieldRows(general)}</dl>
    </section>
    ${lonas
      .map(
        (group, index) => `
      <section class="fields-section lona-section ${index % 2 === 1 ? "lona-alt" : ""}">
        <div class="section-head lona-head">
          <h3>Lona ${group.number}</h3>
          <p>Especificaciones independientes de esta lona.</p>
        </div>
        <dl class="fields">${renderFieldRows(group.questions, {
          stripLonaLabel: true,
        })}</dl>
      </section>`,
      )
      .join("")}
  `;
}

async function downloadSubmissionPdf(sub) {
  const title = submissionTitle(sub);
  const res = await fetch(`/api/pdf/${encodeURIComponent(sub.submissionId)}`);
  if (!res.ok) {
    let message = "No se pudo generar el PDF";
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `solicitud-${safeFilename(title)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function updateLiveMeta() {
  const total = document.getElementById("stat-total");
  const updated = document.getElementById("stat-updated");
  if (total) total.textContent = String(state.data?.totalResponses ?? 0);
  if (updated) {
    updated.textContent = state.lastUpdated
      ? formatDate(state.lastUpdated)
      : "—";
  }
}

async function load(isInitial = false) {
  if (isInitial) state.loading = true;
  try {
    const res = await fetch("/api/submissions", { cache: "no-store" });
    const json = await res.json();
    const nextFingerprint = dataFingerprint(json);
    const changed = nextFingerprint !== state.fingerprint;

    state.data = json;
    state.fingerprint = nextFingerprint;
    state.lastUpdated = json.fetchedAt || new Date().toISOString();

    if (
      !state.selectedId ||
      !json.responses.some((r) => r.submissionId === state.selectedId)
    ) {
      state.selectedId = json.responses[0]?.submissionId || null;
    }

    state.loading = false;

    if (isInitial || changed || !state.booted) {
      render();
    } else {
      updateLiveMeta();
    }
  } catch {
    state.data = {
      responses: [],
      totalResponses: 0,
      error: "No se pudo conectar con el servidor.",
      configured: false,
    };
    state.fingerprint = dataFingerprint(state.data);
    state.loading = false;
    render();
  } finally {
    if (state.live) {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(() => load(false), POLL_MS);
    }
  }
}

function filteredList() {
  const list = state.data?.responses || [];
  const q = state.query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((sub) => {
    const haystack = [
      submissionTitle(sub),
      ...sub.questions.map(
        (question) => `${question.name} ${formatQuestionValue(question)}`,
      ),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function bindEvents(root) {
  const search = document.getElementById("search");
  if (search) {
    search.addEventListener("input", (e) => {
      state.query = e.target.value;
      render({ keepSearchFocus: true });
    });
  }

  root.querySelectorAll("[data-action='toggle-live']").forEach((el) => {
    el.addEventListener("click", () => {
      state.live = !state.live;
      if (state.live) load(false);
      else clearTimeout(pollTimer);
      render();
    });
  });

  root.querySelectorAll("[data-action='download-pdf']").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = el.getAttribute("data-id");
      const sub = (state.data?.responses || []).find(
        (item) => item.submissionId === id,
      );
      if (!sub) return;
      const original = el.textContent;
      el.disabled = true;
      el.textContent = "Generando PDF…";
      try {
        await downloadSubmissionPdf(sub);
      } catch (error) {
        console.error(error);
        alert("No se pudo generar el PDF. Intenta de nuevo.");
      } finally {
        el.disabled = false;
        el.textContent = original || "Descargar PDF";
      }
    });
  });

  root.querySelectorAll("[data-select]").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedId = el.getAttribute("data-select");
      render();
    });
  });

  root.querySelectorAll("[data-lightbox]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      state.lightbox = JSON.parse(el.getAttribute("data-lightbox"));
      render();
    });
  });

  root.querySelectorAll("[data-action='close-lightbox']").forEach((el) => {
    el.addEventListener("click", () => {
      state.lightbox = null;
      render();
    });
  });

  root.querySelectorAll("[data-stop]").forEach((el) => {
    el.addEventListener("click", (e) => e.stopPropagation());
  });
}

function render(options = {}) {
  const root = document.getElementById("app");
  const filtered = filteredList();
  const selected =
    filtered.find((s) => s.submissionId === state.selectedId) ||
    filtered[0] ||
    null;
  const selectedImages = selected ? submissionFiles(selected) : [];

  root.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">Mercadotecnia · Lonas</p>
        <h1>Panel de <span>solicitudes</span></h1>
        <p class="subtitle">Respuestas del formulario de diseño y producción, en tiempo real.</p>
      </div>
      <div class="top-meta">
        <button type="button" class="live-pill ${state.live ? "on" : "off"}" data-action="toggle-live">
          <span class="dot"></span>${state.live ? "En vivo" : "Pausado"}
        </button>
        <div class="stat">
          <strong id="stat-total">${state.data?.totalResponses ?? 0}</strong>
          <span>solicitudes</span>
        </div>
        <div class="stat muted">
          <strong id="stat-updated">${state.lastUpdated ? escapeHtml(formatDate(state.lastUpdated)) : "—"}</strong>
          <span>última actualización</span>
        </div>
      </div>
    </header>

    ${
      state.data?.error
        ? `<div class="banner"><strong>${
            state.data.error.includes("FILLOUT_API_KEY")
              ? "Configuración requerida."
              : "No se pudieron cargar las respuestas."
          }</strong> ${escapeHtml(state.data.error)}
          ${
            state.data.error.includes("FILLOUT_API_KEY")
              ? `<div class="banner-steps"><ol>
                  <li>En Hostinger, agrega la variable <code>FILLOUT_API_KEY</code>.</li>
                  <li>También agrega <code>FILLOUT_FORM_ID=9LnZ4jfJXnus</code>.</li>
                  <li>Vuelve a desplegar la app.</li>
                </ol></div>`
              : ""
          }
        </div>`
        : ""
    }

    <div class="layout">
      <aside class="list-panel">
        <div class="search-row">
          <input id="search" value="${escapeHtml(state.query)}" placeholder="Buscar negocio, ejecutivo, marca…" aria-label="Buscar solicitudes" />
        </div>
        ${
          state.loading && !state.data
            ? `<p class="empty">Cargando respuestas…</p>`
            : filtered.length === 0
              ? `<p class="empty">${
                  state.data?.error
                    ? "Aún no hay datos conectados."
                    : "No hay solicitudes que coincidan."
                }</p>`
              : `<ul class="submission-list">
                  ${filtered
                    .map((sub) => {
                      const files = submissionFiles(sub);
                      const { lonas } = groupQuestions(sub.questions);
                      const active =
                        selected?.submissionId === sub.submissionId;
                      return `<li>
                        <button type="button" class="submission-item ${active ? "active" : ""}" data-select="${sub.submissionId}">
                          <div class="item-top">
                            <h2>${escapeHtml(submissionTitle(sub))}</h2>
                            <div class="item-badges">
                              ${lonas.length > 1 ? `<span class="badge badge-lona">${lonas.length} lonas</span>` : ""}
                              ${files.length ? `<span class="badge">${files.length} img</span>` : ""}
                            </div>
                          </div>
                          <p>${escapeHtml(formatDate(sub.submissionTime))}</p>
                        </button>
                      </li>`;
                    })
                    .join("")}
                </ul>`
        }
      </aside>

      <main class="detail-panel">
        ${
          !selected
            ? `<div class="empty-detail">
                <h2>Selecciona una solicitud</h2>
                <p>Aquí verás todos los campos y podrás abrir o descargar las imágenes adjuntas.</p>
              </div>`
            : `
              <div class="detail-header">
                <div class="detail-header-copy">
                  <p class="eyebrow">Detalle</p>
                  <h2>${escapeHtml(submissionTitle(selected))}</h2>
                  <p class="meta">Enviada el ${escapeHtml(formatDate(selected.submissionTime))} · ID <code>${escapeHtml(selected.submissionId)}</code></p>
                </div>
                <button type="button" class="pdf-btn" data-action="download-pdf" data-id="${escapeHtml(selected.submissionId)}">
                  Descargar PDF
                </button>
              </div>

              ${
                selectedImages.length
                  ? `<section class="images-section">
                      <div class="section-head">
                        <h3>Imágenes adjuntas</h3>
                        <p>Haz clic para ampliar o descarga el archivo original.</p>
                      </div>
                      <div class="image-grid">
                        ${selectedImages
                          .map(
                            (file) => `
                          <article class="image-card">
                            <button type="button" class="thumb-btn" data-lightbox='${escapeHtml(
                              JSON.stringify({
                                url: file.url,
                                filename: file.filename || "",
                                label: file.questionName,
                              }),
                            )}'>
                              <img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.questionName)}" loading="lazy" />
                            </button>
                            <div class="image-meta">
                              <strong>${escapeHtml(file.questionName)}</strong>
                              <span>${escapeHtml(file.filename || "Archivo")}</span>
                              <div class="image-actions">
                                <button type="button" data-lightbox='${escapeHtml(
                                  JSON.stringify({
                                    url: file.url,
                                    filename: file.filename || "",
                                    label: file.questionName,
                                  }),
                                )}'>Ver</button>
                                <a href="${downloadHref(file)}">Descargar</a>
                              </div>
                            </div>
                          </article>`,
                          )
                          .join("")}
                      </div>
                    </section>`
                  : ""
              }

              ${renderGroupedAnswers(selected.questions)}
            `
        }
      </main>
    </div>

    ${
      state.lightbox
        ? `<div class="lightbox" data-action="close-lightbox">
            <div class="lightbox-inner" data-stop>
              <div class="lightbox-bar">
                <div>
                  <strong>${escapeHtml(state.lightbox.label)}</strong>
                  <span>${escapeHtml(state.lightbox.filename || "Imagen")}</span>
                </div>
                <div class="lightbox-actions">
                  <a href="${downloadHref(state.lightbox)}">Descargar</a>
                  <button type="button" data-action="close-lightbox">Cerrar</button>
                </div>
              </div>
              <img src="${escapeHtml(state.lightbox.url)}" alt="${escapeHtml(state.lightbox.label)}" />
            </div>
          </div>`
        : ""
    }
  `;

  bindEvents(root);

  if (options.keepSearchFocus) {
    const again = document.getElementById("search");
    if (again) {
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }
  }

  state.booted = true;
  root.classList.add("is-booted");
}

load(true);
