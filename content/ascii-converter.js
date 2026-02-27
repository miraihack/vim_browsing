import { ASCII_RAMP, CHAR_ASPECT_RATIO, ASCII_MAX_WIDTH, IMAGE_MIN_SIZE } from '../shared/constants.js';
import browserAPI from '../shared/browser-api.js';

/**
 * Convert an image to ASCII art lines.
 *
 * Strategy order:
 *  1. Draw the original DOM <img> element directly to canvas (same-origin images)
 *  2. Ask background script to fetch the image as a data URL (bypasses CORS)
 *     then draw the data URL image to canvas
 *
 * Returns Promise<string[] | null>.
 */
export async function imageToAscii(src, artWidth, artHeight, domElement) {
  // Strategy 1: DOM element direct draw (fast, no re-fetch, works for same-origin)
  if (domElement && (domElement.naturalWidth > 0 || domElement.width > 0)) {
    const lines = tryConvert(domElement, artWidth, artHeight);
    if (lines) return lines;
  }

  // Strategy 2: data:/blob: URLs — load directly (no CORS issue)
  if (src.startsWith('data:') || src.startsWith('blob:')) {
    try {
      const lines = await loadAndConvert(src, artWidth, artHeight);
      if (lines) return lines;
    } catch { /* fall through */ }
    return null;
  }

  // Strategy 3: Fetch via background script to bypass CORS
  try {
    const dataUrl = await fetchViaBackground(src);
    if (dataUrl) {
      const lines = await loadAndConvert(dataUrl, artWidth, artHeight);
      if (lines) return lines;
    }
  } catch { /* fall through */ }

  return null;
}

/** Ask the background script to fetch the image and return a data URL. */
function fetchViaBackground(url) {
  return new Promise((resolve) => {
    try {
      browserAPI.runtime.sendMessage({ type: 'FETCH_IMAGE', url })
        .then((response) => resolve(response?.dataUrl || null))
        .catch(() => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/** Load an image from a URL (typically a data URL) and convert to ASCII. */
function loadAndConvert(src, artWidth, artHeight) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(tryConvert(img, artWidth, artHeight));
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Try to convert an image element to ASCII. Returns string[] | null. */
function tryConvert(img, artWidth, artHeight) {
  try {
    return convertImageToAscii(img, artWidth, artHeight);
  } catch {
    return null;
  }
}

/**
 * Core conversion.
 * If artWidth/artHeight are provided (from CSS size), use them directly.
 * Otherwise fall back to natural size with aspect-ratio correction.
 */
function convertImageToAscii(img, artWidth, artHeight) {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (natW < 1 || natH < 1) return null;
  if (natW < IMAGE_MIN_SIZE && natH < IMAGE_MIN_SIZE) return null;

  let outW, outH;

  if (artWidth > 0 && artHeight > 0) {
    outW = Math.min(artWidth, ASCII_MAX_WIDTH);
    outH = artHeight;
  } else {
    // Fallback: scale to a readable width, apply aspect ratio correction
    outW = Math.min(Math.max(20, Math.round(natW / 6)), ASCII_MAX_WIDTH);
    outH = Math.round((natH / natW) * outW * CHAR_ASPECT_RATIO);
  }

  if (outW < 1) outW = 1;
  if (outH < 1) outH = 1;

  // Allow large images — cap at 150 rows
  const MAX_ART_HEIGHT = 150;
  if (outH > MAX_ART_HEIGHT) {
    const scale = MAX_ART_HEIGHT / outH;
    outH = MAX_ART_HEIGHT;
    outW = Math.max(1, Math.round(outW * scale));
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = outW;
  canvas.height = outH;
  ctx.drawImage(img, 0, 0, outW, outH);

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, outW, outH);
  } catch {
    return null; // tainted canvas
  }

  const pixels = imageData.data;
  const ramp = ASCII_RAMP;
  const rampLen = ramp.length;
  const lines = [];

  for (let y = 0; y < outH; y++) {
    let line = '';
    for (let x = 0; x < outW; x++) {
      const idx = (y * outW + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];

      if (a < 128) {
        line += ' ';
      } else {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        line += ramp[Math.floor((lum / 255) * (rampLen - 1))];
      }
    }
    lines.push(line);
  }

  return lines;
}

/**
 * Process all image blocks in-place, adding asciiLines to each.
 */
export async function convertAllImages(blocks) {
  const imageBlocks = blocks.filter(b => b.type === 'image' && b.src);
  const promises = imageBlocks.map(async (block) => {
    const lines = await imageToAscii(
      block.src,
      block.artWidth || 0,
      block.artHeight || 0,
      block.domElement || null,
    );
    if (lines) {
      block.asciiLines = lines;
    }
  });
  await Promise.all(promises);
}
