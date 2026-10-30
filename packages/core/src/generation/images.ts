import sharp from 'sharp';

export interface OptimizedImage {
  data: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
}

// Resize to a web-friendly width and convert to WebP before the image ever reaches WordPress.
export async function optimizeImage(input: Uint8Array, maxWidth = 1600): Promise<OptimizedImage> {
  const { data, info } = await sharp(input, { density: 144 })
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { data, mimeType: 'image/webp', width: info.width, height: info.height };
}
