const FORM_ID = process.env.FILLOUT_FORM_ID || "9LnZ4jfJXnus";
const FILLOUT_API_BASE =
  process.env.FILLOUT_API_BASE || "https://api.fillout.com/v1/api";

const FILE_TYPES = new Set([
  "FileUpload",
  "ImagePicker",
  "Signature",
  "Camera",
]);

function isFileQuestion(type) {
  return FILE_TYPES.has(type);
}

function extractFiles(value) {
  if (!value) return [];

  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    return [{ url: value, filename: value.split("/").pop() }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractFiles(item));
  }

  if (typeof value === "object") {
    if (typeof value.url === "string") {
      return [
        {
          url: value.url,
          filename: value.filename || value.name,
          contentType: value.contentType || value.type,
        },
      ];
    }
  }

  return [];
}

function formatQuestionValue(question) {
  const { value, type } = question;

  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (isFileQuestion(type)) {
    const files = extractFiles(value);
    if (!files.length) return "Sin archivo";
    return files.map((f) => f.filename || "Archivo").join(", ");
  }

  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return value.join(", ");
    }
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          if (typeof item.label === "string") return item.label;
          if (typeof item.value === "string") return item.value;
          if (typeof item.name === "string") return item.name;
        }
        return String(item);
      })
      .join(", ");
  }

  if (typeof value === "object") {
    if (typeof value.pretty === "string") return value.pretty;
    if (typeof value.formatted === "string") return value.formatted;
    if (typeof value.number === "string" || typeof value.number === "number") {
      const code = value.countryCode ? `+${value.countryCode} ` : "";
      return `${code}${value.number}`;
    }
    if (typeof value.label === "string") return value.label;
    if (typeof value.value === "string" || typeof value.value === "number") {
      return String(value.value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
  }

  return String(value);
}

function getQuestionByHint(questions, hints) {
  const normalized = hints.map((h) => h.toLowerCase());
  return questions.find((q) => {
    const name = q.name.toLowerCase();
    return normalized.some((hint) => name.includes(hint));
  });
}

async function fetchAllSubmissions() {
  const apiKey = process.env.FILLOUT_API_KEY?.trim();
  if (
    !apiKey ||
    apiKey.includes("pega_aqui") ||
    apiKey.includes("tu_api_key")
  ) {
    throw new Error(
      "Falta FILLOUT_API_KEY. Configura la variable de entorno en Hostinger.",
    );
  }

  const limit = 150;
  let offset = 0;
  let pageCount = 1;
  let totalResponses = 0;
  const responses = [];

  while (offset < pageCount * limit || offset === 0) {
    const url = new URL(`${FILLOUT_API_BASE}/forms/${FORM_ID}/submissions`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("sort", "desc");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Fillout respondió ${res.status}: ${body || res.statusText}`,
      );
    }

    const data = await res.json();
    totalResponses = data.totalResponses;
    pageCount = Math.max(data.pageCount || 1, 1);
    responses.push(...(data.responses || []));

    if (!data.responses?.length || responses.length >= totalResponses) {
      break;
    }
    offset += limit;
  }

  return { responses, totalResponses, pageCount };
}

module.exports = {
  FORM_ID,
  FILLOUT_API_BASE,
  isFileQuestion,
  extractFiles,
  formatQuestionValue,
  getQuestionByHint,
  fetchAllSubmissions,
};
