import { PhotonImage, SamplingFilter, resize } from "@cf-wasm/photon/workerd";

export interface Env {
  IMAGES_BUCKET: R2Bucket;
  ALLOWED_ORIGINS?: string;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MIN_WIDTH = 50;
const MAX_WIDTH = 2048;

const CACHE_VERSION = "v2"

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // const cache = caches.default;
    // const cacheUrl = url.toString() + (url.search ? "&" : "?") + "_cv=" + CACHE_VERSION;
    // const cacheKey = new Request(cacheUrl, request);
    // const cached = await cache.match(cacheKey);
    // if (cached) return cached;

    const key = url.pathname.slice(1);
    const object = await env.IMAGES_BUCKET.get(key);
    if (!object) {
      return new Response("Image not found", { status: 404 });
    }

    const isVideo = key.startsWith("videos/");
    if (isVideo) {
      const response = new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType || "video/mp4",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
        },
      });
      return response;
    }

    const imageData = await object.arrayBuffer();
    if (imageData.byteLength > MAX_IMAGE_SIZE) {
      return new Response("Image too large", { status: 413 });
    }

    const referer = request.headers.get("Referer") || "";
    const origins = (env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
    const isAllowed = referer === "" || origins.some(o => referer.startsWith(o.trim()));
    if (!isAllowed) {
      return new Response("Forbidden", { status: 403 });
    }

    const width = url.searchParams.get("width");

    if (!width) {
      const response = new Response(new Blob([imageData], { type: object.httpMetadata?.contentType || "image/webp" }), {
        headers: {
          "Content-Type": object.httpMetadata?.contentType || "image/webp",
          "Content-Length": String(imageData.byteLength),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
        },
      });
      // ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    const inputBytes = new Uint8Array(imageData);
    const inputImage = PhotonImage.new_from_byteslice(inputBytes);

    let outputImage: PhotonImage | null = null;
    try {
      const targetWidth = Math.max(MIN_WIDTH, Math.min(parseInt(width) || 0, MAX_WIDTH));

      if (targetWidth >= inputImage.get_width()) {
        outputImage = inputImage;
      } else {
        const scale = targetWidth / inputImage.get_width();
        const targetHeight = Math.floor(inputImage.get_height() * scale);
        outputImage = resize(inputImage, targetWidth, targetHeight, SamplingFilter.Lanczos3);
      }

      const outputBytes = outputImage.get_bytes_webp();

      const response = new Response(new Blob([outputBytes], { type: "image/webp" }), {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(outputBytes.byteLength),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
        },
      });

      return response;
    } catch (err) {
      console.error("Photon resize failed:", err);
      return new Response("Image processing failed", { status: 500 });
    } finally {
      inputImage.free();
      if (outputImage && outputImage !== inputImage) outputImage.free();
    }
  },
} satisfies ExportedHandler<Env>;
