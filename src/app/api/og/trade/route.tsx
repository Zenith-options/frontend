import { ImageResponse } from "next/og";
import { ShareCardImage, CARD_SIZE } from "../../../../lib/share/cardImage";
import { getSigningSecret, verifyShareId, ShareConfigError } from "../../../../lib/share/payload";

export const runtime = "edge";

// Local font files (see ./fonts/NOTICE.md), bundled with the edge
// function via `new URL(..., import.meta.url)`. Loaded once per isolate.
//
// A missing or unreadable font must not take the route down: that font is
// skipped (the renderer falls back to its default font) and a single warning
// names the path. The flag keeps it to one warning per isolate, not one per request.
let warnedMissingFont = false;

async function loadFont(url: URL): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  } catch (err) {
    if (!warnedMissingFont) {
      warnedMissingFont = true;
      console.warn(`[og/trade] font file could not be loaded (${url.pathname}): ${String(err)}; using the default font`);
    }
    return null;
  }
}

const fonts = Promise.all([
  loadFont(new URL("./fonts/fraunces-latin-600-normal.woff", import.meta.url)),
  loadFont(new URL("./fonts/ibm-plex-sans-latin-500-normal.woff", import.meta.url)),
  loadFont(new URL("./fonts/jetbrains-mono-latin-600-normal.woff", import.meta.url)),
]);

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  let secret: string;
  try {
    secret = getSigningSecret();
  } catch (err) {
    if (err instanceof ShareConfigError) return new Response("Sharing is not configured", { status: 503, headers: NO_STORE });
    throw err;
  }
  const card = await verifyShareId(id, secret);
  if (!card) return new Response("Invalid or tampered share link", { status: 400, headers: NO_STORE });

  const [fraunces, plex, mono] = await fonts;
  const available = [
    fraunces && ({ name: "Fraunces", data: fraunces, weight: 600, style: "normal" } as const),
    plex && ({ name: "Plex", data: plex, weight: 500, style: "normal" } as const),
    mono && ({ name: "Mono", data: mono, weight: 600, style: "normal" } as const),
  ].filter((font): font is NonNullable<typeof font> => Boolean(font));
  return new ImageResponse(<ShareCardImage card={card} />, {
    ...CARD_SIZE,
    // Omitted entirely when no font loaded, so the renderer uses its default font.
    ...(available.length > 0 ? { fonts: [...available] } : {}),
    // A signed id fully determines the image, so it can be cached hard.
    // Kept to a week at the CDN (not "immutable") so rotating the signing
    // secret actually retires old cards within a bounded time.
    headers: { "cache-control": "public, max-age=86400, s-maxage=604800" },
  });
}
