import type {
  ImageProvider,
  ImageRequest,
  ImageResult,
  ModelSpec,
  TextProvider,
  TextRequest,
  TextResult,
} from './types';

// Deterministic stand-in for local development and tests (AI_FAKE=true). The caller supplies the
// text, because only the caller knows the output format its prompt asks for.
export class FakeProvider implements TextProvider, ImageProvider {
  constructor(private readonly respond: (request: TextRequest) => string) {}

  async generateText(model: ModelSpec, _credential: unknown, request: TextRequest): Promise<TextResult> {
    const text = this.respond(request);
    return {
      text,
      servedBy: `fake:${model.id}`,
      usage: {
        inputTokens: Math.ceil((request.system.length + request.prompt.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      },
    };
  }

  async generateImage(_model: ModelSpec, _credential: unknown, request: ImageRequest): Promise<ImageResult> {
    const [width, height] = request.size.split('x').map(Number) as [number, number];
    const hue = [...request.prompt].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
    const label = escapeXml(request.prompt.slice(0, 60));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,35%)"/>
</linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="50%" font-family="sans-serif" font-size="${Math.round(width / 28)}" fill="white" text-anchor="middle">${label}</text>
</svg>`;
    return { data: new TextEncoder().encode(svg), mimeType: 'image/svg+xml' };
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
