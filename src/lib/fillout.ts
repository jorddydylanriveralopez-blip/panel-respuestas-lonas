export const FORM_ID = process.env.FILLOUT_FORM_ID || "9LnZ4jfJXnus";
export const FILLOUT_API_BASE =
  process.env.FILLOUT_API_BASE || "https://api.fillout.com/v1/api";

export type FilloutFile = {
  url: string;
  filename?: string;
  contentType?: string;
};

export type FilloutQuestion = {
  id: string;
  name: string;
  type: string;
  value: unknown;
};

export type FilloutSubmission = {
  submissionId: string;
  submissionTime: string;
  lastUpdatedAt?: string;
  questions: FilloutQuestion[];
};

export type SubmissionsPayload = {
  responses: FilloutSubmission[];
  totalResponses: number;
  pageCount: number;
};

const FILE_TYPES = new Set([
  "FileUpload",
  "ImagePicker",
  "Signature",
  "Camera",
]);

export function isFileQuestion(type: string) {
  return FILE_TYPES.has(type);
}

export function extractFiles(value: unknown): FilloutFile[] {
  if (!value) return [];

  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    return [{ url: value, filename: value.split("/").pop() }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractFiles(item));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === "string") {
      return [
        {
          url: obj.url,
          filename:
            typeof obj.filename === "string"
              ? obj.filename
              : typeof obj.name === "string"
                ? obj.name
                : undefined,
          contentType:
            typeof obj.contentType === "string"
              ? obj.contentType
              : typeof obj.type === "string"
                ? obj.type
                : undefined,
        },
      ];
    }
  }

  return [];
}

export function formatQuestionValue(question: FilloutQuestion): string {
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
          const obj = item as Record<string, unknown>;
          if (typeof obj.label === "string") return obj.label;
          if (typeof obj.value === "string") return obj.value;
          if (typeof obj.name === "string") return obj.name;
        }
        return String(item);
      })
      .join(", ");
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.pretty === "string") return obj.pretty;
    if (typeof obj.formatted === "string") return obj.formatted;
    if (typeof obj.number === "string" || typeof obj.number === "number") {
      const code = obj.countryCode ? `+${obj.countryCode} ` : "";
      return `${code}${obj.number}`;
    }
    if (typeof obj.label === "string") return obj.label;
    if (typeof obj.value === "string" || typeof obj.value === "number") {
      return String(obj.value);
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

export function getQuestionByHint(
  questions: FilloutQuestion[],
  hints: string[],
): FilloutQuestion | undefined {
  const normalized = hints.map((h) => h.toLowerCase());
  return questions.find((q) => {
    const name = q.name.toLowerCase();
    return normalized.some((hint) => name.includes(hint));
  });
}

export async function fetchAllSubmissions(): Promise<SubmissionsPayload> {
  const apiKey = process.env.FILLOUT_API_KEY?.trim();
  if (
    !apiKey ||
    apiKey.includes("pega_aqui") ||
    apiKey.includes("tu_api_key")
  ) {
    throw new Error(
      "Falta FILLOUT_API_KEY. Crea un archivo .env.local con tu API key de Fillout.",
    );
  }

  const limit = 150;
  let offset = 0;
  let pageCount = 1;
  let totalResponses = 0;
  const responses: FilloutSubmission[] = [];

  while (offset < pageCount * limit || offset === 0) {
    const url = new URL(
      `${FILLOUT_API_BASE}/forms/${FORM_ID}/submissions`,
    );
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("sort", "desc");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Fillout respondió ${res.status}: ${body || res.statusText}`,
      );
    }

    const data = (await res.json()) as SubmissionsPayload;
    totalResponses = data.totalResponses;
    pageCount = Math.max(data.pageCount, 1);
    responses.push(...(data.responses || []));

    if (!data.responses?.length || responses.length >= totalResponses) {
      break;
    }
    offset += limit;
  }

  return { responses, totalResponses, pageCount };
}
