import { NextRequest, NextResponse } from "next/server";

const AIHOT_ENDPOINT = "https://aihot.virxact.com/api/public/items";
const AIHOT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 ai-ai-de-ai/0.1.0";
const AIHOT_TIMEOUT_MS = 15_000;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get("q")?.trim();
  const modeParam = request.nextUrl.searchParams.get("mode");
  const mode = modeParam === "all" ? "all" : "selected";
  const upstreamUrl = new URL(AIHOT_ENDPOINT);

  if (keyword) {
    upstreamUrl.searchParams.set("q", keyword);
  } else {
    upstreamUrl.searchParams.set("mode", mode);
  }

  upstreamUrl.searchParams.set("take", request.nextUrl.searchParams.get("take") ?? "50");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AIHOT_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": AIHOT_USER_AGENT,
      },
      next: {
        revalidate: 300,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: isAbortError(error)
          ? "AI HOT request timed out."
          : "AI HOT request failed.",
      },
      { status: isAbortError(error) ? 504 : 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }

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
