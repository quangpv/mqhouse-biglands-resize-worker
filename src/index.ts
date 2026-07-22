import { PhotonImage, SamplingFilter, resize } from "@cf-wasm/photon/workerd";

export interface Env {
  IMAGES_BUCKET: R2Bucket;
  ALLOWED_ORIGINS?: string;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MIN_WIDTH = 50;
const MAX_WIDTH = 2048;
const WEBP_QUALITY = 80;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const key = url.pathname.slice(1);
    const object = await env.IMAGES_BUCKET.get(key);
    if (!object) {
      return new Response("Image not found", { status: 404 });
    }

    const inputBytes = new Uint8Array(await object.arrayBuffer());
    if (inputBytes.length > MAX_IMAGE_SIZE) {
      return new Response("Image too large", { status: 413 });
    }

    const referer = request.headers.get("Referer") || "";
    const origins = (env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
    const isAllowed = referer === "" || origins.some(o => referer.startsWith(o.trim()));
    if (!isAllowed) {
      return new Response("Forbidden", { status: 403 });
    }

    const inputImage = PhotonImage.new_from_byteslice(inputBytes);

    const width = url.searchParams.get("width");
    let outputImage: PhotonImage;

    if (width) {
      const targetWidth = Math.max(MIN_WIDTH, Math.min(parseInt(width) || 0, MAX_WIDTH));
      if (targetWidth >= inputImage.get_width()) {
        outputImage = inputImage;
      } else {
        const scale = targetWidth / inputImage.get_width();
        const targetHeight = Math.floor(inputImage.get_height() * scale);
        outputImage = resize(inputImage, targetWidth, targetHeight, SamplingFilter.Lanczos3);
      }
    } else {
      outputImage = inputImage;
    }

    const outputBytes = outputImage.get_bytes_webp();

    inputImage.free();
    if (outputImage !== inputImage) outputImage.free();

    const response = new Response(outputBytes, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
} satisfies ExportedHandler<Env>;
