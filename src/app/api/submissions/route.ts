import { NextResponse } from "next/server";
import { fetchAllSubmissions } from "@/lib/fillout";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchAllSubmissions();
    return NextResponse.json({
      ...data,
      fetchedAt: new Date().toISOString(),
      configured: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido";
    const missingKey = message.includes("FILLOUT_API_KEY");

    return NextResponse.json(
      {
        error: message,
        configured: !missingKey,
        responses: [],
        totalResponses: 0,
        pageCount: 0,
        fetchedAt: new Date().toISOString(),
      },
      { status: missingKey ? 503 : 502 },
    );
  }
}
