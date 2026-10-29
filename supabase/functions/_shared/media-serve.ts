import { verifyMediaToken } from './media-token.ts';

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export type MediaServeDeps = {
  secret: string;
  now(): number;
  download(key: string): Promise<Uint8Array | null>;
};

/** Serve SOMENTE imagens (fotos/carrossel) com token válido; vídeos nunca passam por aqui. */
export async function handleMediaServe(req: Request, d: MediaServeDeps): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405 });
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const result = await verifyMediaToken(d.secret, token, d.now());
  if (!result.ok) return new Response(null, { status: result.reason === 'expired' ? 410 : 403 });

  const ext = result.key.split('.').pop()?.toLowerCase() ?? '';
  const contentType = IMAGE_TYPES[ext];
  if (!contentType) return new Response(null, { status: 403 });

  const bytes = await d.download(result.key).catch(() => null);
  if (!bytes) return new Response(null, { status: 404 });
  const headers = {
    'Content-Type': contentType,
    'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  return new Response(req.method === 'HEAD' ? null : bytes, { status: 200, headers });
}
