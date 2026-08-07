"use client";

import { useEffect, useMemo, useState } from "react";
import type { FilloutFile, FilloutSubmission } from "@/lib/fillout";
import {
  extractFiles,
  formatQuestionValue,
  getQuestionByHint,
  isFileQuestion,
} from "@/lib/fillout";

type ApiResponse = {
  responses: FilloutSubmission[];
  totalResponses: number;
  fetchedAt?: string;
  configured?: boolean;
  error?: string;
};

const POLL_MS = 5000;

function cleanLabel(name: string) {
  return name.replace(/^\d+\.\s*/, "").replace(/<\/?p>/gi, "").trim();
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function submissionTitle(sub: FilloutSubmission) {
  const negocio = getQuestionByHint(sub.questions, [
    "nombre comercial",
    "punto de venta",
  ]);
  const ejecutivo = getQuestionByHint(sub.questions, [
    "ejecutivo de ventas",
  ]);
  const negocioVal = negocio ? formatQuestionValue(negocio) : "";
  if (negocioVal && negocioVal !== "—") return negocioVal;
  const ejecutivoVal = ejecutivo ? formatQuestionValue(ejecutivo) : "";
  if (ejecutivoVal && ejecutivoVal !== "—") return ejecutivoVal;
  return `Solicitud ${sub.submissionId.slice(0, 8)}`;
}

function submissionFiles(sub: FilloutSubmission) {
  return sub.questions.flatMap((q) => {
    if (!isFileQuestion(q.type)) return [];
    return extractFiles(q.value).map((file) => ({
      ...file,
      questionName: cleanLabel(q.name),
    }));
  });
}

function downloadHref(file: FilloutFile) {
  const params = new URLSearchParams({
    url: file.url,
    filename: file.filename || "imagen",
  });
  return `/api/download?${params.toString()}`;
}

export default function Dashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lightbox, setLightbox] = useState<{
    url: string;
    filename?: string;
    label: string;
  } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [live, setLive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load(isInitial = false) {
      if (isInitial) setLoading(true);
      try {
        const res = await fetch("/api/submissions", { cache: "no-store" });
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        setData(json);
        setLastUpdated(json.fetchedAt || new Date().toISOString());
        setSelectedId((prev) => {
          if (prev && json.responses.some((r) => r.submissionId === prev)) {
            return prev;
          }
          return json.responses[0]?.submissionId ?? null;
        });
      } catch {
        if (!cancelled) {
          setData({
            responses: [],
            totalResponses: 0,
            error: "No se pudo conectar con el servidor local.",
            configured: false,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
        if (!cancelled && live) {
          timer = setTimeout(() => load(false), POLL_MS);
        }
      }
    }

    load(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [live]);

  const filtered = useMemo(() => {
    const list = data?.responses || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((sub) => {
      const haystack = [
        submissionTitle(sub),
        ...sub.questions.map((question) =>
          `${question.name} ${formatQuestionValue(question)}`,
        ),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [data, query]);

  const selected =
    filtered.find((s) => s.submissionId === selectedId) ||
    filtered[0] ||
    null;

  const selectedImages = selected ? submissionFiles(selected) : [];

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Mercadotecnia · Lonas</p>
          <h1>Panel de solicitudes</h1>
          <p className="subtitle">
            Respuestas del formulario de diseño y producción, en tiempo real.
          </p>
        </div>
        <div className="top-meta">
          <button
            type="button"
            className={`live-pill ${live ? "on" : "off"}`}
            onClick={() => setLive((v) => !v)}
          >
            <span className="dot" />
            {live ? "En vivo" : "Pausado"}
          </button>
          <div className="stat">
            <strong>{data?.totalResponses ?? 0}</strong>
            <span>solicitudes</span>
          </div>
          <div className="stat muted">
            <strong>
              {lastUpdated ? formatDate(lastUpdated) : "—"}
            </strong>
            <span>última actualización</span>
          </div>
        </div>
      </header>

      {data?.error && (
        <div className="banner">
          <strong>
            {data.error.includes("FILLOUT_API_KEY")
              ? "Configuración requerida."
              : "No se pudieron cargar las respuestas."}
          </strong>{" "}
          {data.error}
          {data.error.includes("FILLOUT_API_KEY") && (
            <div className="banner-steps">
              <ol>
                <li>
                  Entra a{" "}
                  <a
                    href="https://build.fillout.com/home/settings/developer"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Fillout → Settings → Developer
                  </a>{" "}
                  y copia tu API key.
                </li>
                <li>
                  Abre <code>.env.local</code> en esta carpeta y pega:
                  <pre>{`FILLOUT_API_KEY=tu_api_key_aqui
FILLOUT_FORM_ID=9LnZ4jfJXnus`}</pre>
                </li>
                <li>
                  Reinicia el servidor con <code>npm run dev</code>.
                </li>
              </ol>
            </div>
          )}
        </div>
      )}

      <div className="layout">
        <aside className="list-panel">
          <div className="search-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar negocio, ejecutivo, marca…"
              aria-label="Buscar solicitudes"
            />
          </div>

          {loading && !data ? (
            <p className="empty">Cargando respuestas…</p>
          ) : filtered.length === 0 ? (
            <p className="empty">
              {data?.error
                ? "Aún no hay datos conectados."
                : "No hay solicitudes que coincidan."}
            </p>
          ) : (
            <ul className="submission-list">
              {filtered.map((sub) => {
                const files = submissionFiles(sub);
                const active = selected?.submissionId === sub.submissionId;
                return (
                  <li key={sub.submissionId}>
                    <button
                      type="button"
                      className={`submission-item ${active ? "active" : ""}`}
                      onClick={() => setSelectedId(sub.submissionId)}
                    >
                      <div className="item-top">
                        <h2>{submissionTitle(sub)}</h2>
                        {files.length > 0 && (
                          <span className="badge">{files.length} img</span>
                        )}
                      </div>
                      <p>{formatDate(sub.submissionTime)}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="detail-panel">
          {!selected ? (
            <div className="empty-detail">
              <h2>Selecciona una solicitud</h2>
              <p>
                Aquí verás todos los campos y podrás abrir o descargar las
                imágenes adjuntas.
              </p>
            </div>
          ) : (
            <>
              <div className="detail-header">
                <div>
                  <p className="eyebrow">Detalle</p>
                  <h2>{submissionTitle(selected)}</h2>
                  <p className="meta">
                    Enviada el {formatDate(selected.submissionTime)} · ID{" "}
                    <code>{selected.submissionId}</code>
                  </p>
                </div>
              </div>

              {selectedImages.length > 0 && (
                <section className="images-section">
                  <div className="section-head">
                    <h3>Imágenes adjuntas</h3>
                    <p>Haz clic para ampliar o descarga el archivo original.</p>
                  </div>
                  <div className="image-grid">
                    {selectedImages.map((file, index) => (
                      <article
                        key={`${file.url}-${index}`}
                        className="image-card"
                      >
                        <button
                          type="button"
                          className="thumb-btn"
                          onClick={() =>
                            setLightbox({
                              url: file.url,
                              filename: file.filename,
                              label: file.questionName,
                            })
                          }
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={file.url}
                            alt={file.questionName}
                            loading="lazy"
                          />
                        </button>
                        <div className="image-meta">
                          <strong>{file.questionName}</strong>
                          <span>{file.filename || "Archivo"}</span>
                          <div className="image-actions">
                            <button
                              type="button"
                              onClick={() =>
                                setLightbox({
                                  url: file.url,
                                  filename: file.filename,
                                  label: file.questionName,
                                })
                              }
                            >
                              Ver
                            </button>
                            <a
                              href={downloadHref(file)}
                              download={file.filename || "imagen"}
                            >
                              Descargar
                            </a>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <section className="fields-section">
                <div className="section-head">
                  <h3>Respuestas</h3>
                </div>
                <dl className="fields">
                  {selected.questions.map((question) => {
                    const files = isFileQuestion(question.type)
                      ? extractFiles(question.value)
                      : [];
                    return (
                      <div key={question.id} className="field">
                        <dt>{cleanLabel(question.name)}</dt>
                        <dd>
                          {files.length > 0 ? (
                            <ul className="file-links">
                              {files.map((file, i) => (
                                <li key={`${file.url}-${i}`}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setLightbox({
                                        url: file.url,
                                        filename: file.filename,
                                        label: cleanLabel(question.name),
                                      })
                                    }
                                  >
                                    {file.filename || `Archivo ${i + 1}`}
                                  </button>
                                  <a href={downloadHref(file)}>Descargar</a>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            formatQuestionValue(question)
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            </>
          )}
        </main>
      </div>

      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <div
            className="lightbox-inner"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lightbox-bar">
              <div>
                <strong>{lightbox.label}</strong>
                <span>{lightbox.filename || "Imagen"}</span>
              </div>
              <div className="lightbox-actions">
                <a
                  href={downloadHref({
                    url: lightbox.url,
                    filename: lightbox.filename,
                  })}
                >
                  Descargar
                </a>
                <button type="button" onClick={() => setLightbox(null)}>
                  Cerrar
                </button>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.label} />
          </div>
        </div>
      )}
    </div>
  );
}
