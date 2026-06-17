import { NextRequest, NextResponse } from "next/server";

const AIHOT_ENDPOINT = "https://aihot.virxact.com/api/public/items";
const AIHOT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ai-ai-de-ai/0.1.0";

export async function GET(request: NextRequest) {
  const modeParam = request.nextUrl.searchParams.get("mode");
  const mode = modeParam === "all" ? "all" : "selected";
  const upstreamUrl = new URL(AIHOT_ENDPOINT);

  upstreamUrl.searchParams.set("mode", mode);
  upstreamUrl.searchParams.set("take", request.nextUrl.searchParams.get("take") ?? "50");

  const response = await fetch(upstreamUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": AIHOT_USER_AGENT,
    },
    next: {
      revalidate: 300,
    },
  });

  const payload = await response.json().catch(() => ({
    error: "Invalid JSON response from AI HOT.",
  }));

  return NextResponse.json(payload, {
    status: response.status,
    headers: {
      "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
    },
  });
}
