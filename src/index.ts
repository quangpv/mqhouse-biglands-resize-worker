import { PhotonImage, SamplingFilter, resize } from "@cf-wasm/photon/workerd";

export interface Env {
  R2_PUBLIC_URL: string;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB safety limit

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const originalUrl = `${env.R2_PUBLIC_URL}${url.pathname}`;
    const width = url.searchParams.get("width");

    // Edge cache
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    // Fetch original from R2
    const srcResponse = await fetch(originalUrl);
    if (!srcResponse.ok) {
      return new Response("Image not found", { status: 404 });
    }

    const contentLength = parseInt(srcResponse.headers.get("Content-Length") || "0");
    if (contentLength > MAX_IMAGE_SIZE) {
      return new Response("Image too large", { status: 413 });
    }

    const inputBytes = new Uint8Array(await srcResponse.arrayBuffer());
    const inputImage = PhotonImage.new_from_byteslice(inputBytes);

    let outputImage: PhotonImage;

    if (width) {
      const targetWidth = parseInt(width);
      const scale = targetWidth / inputImage.get_width();
      const targetHeight = Math.floor(inputImage.get_height() * scale);
      outputImage = resize(inputImage, targetWidth, targetHeight, SamplingFilter.Lanczos3);
    } else {
      outputImage = inputImage;
    }

    const outputBytes = outputImage.get_bytes_webp();

    inputImage.free();
    if (width) outputImage.free();

    const response = new Response(outputBytes, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
} satisfies ExportedHandler<Env>;
