import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const buildDir = path.join(root, 'build');
const iconsetDir = path.join(buildDir, 'icon.iconset');

fs.mkdirSync(buildDir, { recursive: true });
fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });

const iconsetSizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

const renderedPngs = new Map();
const sourcePng = getRenderedPng(1024);
fs.writeFileSync(path.join(buildDir, 'icon.png'), sourcePng);
normalizePng(path.join(buildDir, 'icon.png'));
for (const [fileName, size] of iconsetSizes) {
  const iconPath = path.join(iconsetDir, fileName);
  fs.writeFileSync(iconPath, size === 1024 ? fs.readFileSync(path.join(buildDir, 'icon.png')) : getRenderedPng(size));
  normalizePng(iconPath);
}

const icnsPngs = [16, 32, 64, 128, 256, 512, 1024].map((size) => [
  size,
  fs.readFileSync(path.join(iconsetDir, iconFileNameForSize(size))),
]);
fs.writeFileSync(path.join(buildDir, 'icon.icns'), encodeIcns(icnsPngs));

const icoPngs = [16, 32, 48, 64, 128, 256].map((size) => getRenderedPng(size));
fs.writeFileSync(path.join(buildDir, 'icon.ico'), encodeIco(icoPngs, [16, 32, 48, 64, 128, 256]));

function getRenderedPng(size) {
  if (!renderedPngs.has(size)) {
    renderedPngs.set(size, renderIconPng(size));
  }
  return renderedPngs.get(size);
}

function iconFileNameForSize(size) {
  switch (size) {
    case 16:
      return 'icon_16x16.png';
    case 32:
      return 'icon_32x32.png';
    case 64:
      return 'icon_32x32@2x.png';
    case 128:
      return 'icon_128x128.png';
    case 256:
      return 'icon_256x256.png';
    case 512:
      return 'icon_512x512.png';
    case 1024:
      return 'icon_512x512@2x.png';
    default:
      throw new Error(`Unsupported ICNS size: ${size}`);
  }
}

function normalizePng(filePath) {
  if (process.platform !== 'darwin') return;

  const normalizedPath = `${filePath}.normalized.png`;
  execFileSync('sips', ['-s', 'format', 'png', filePath, '--out', normalizedPath], {
    stdio: 'ignore',
  });
  fs.renameSync(normalizedPath, filePath);
}

function renderIconPng(size) {
  const scale = size <= 64 ? 4 : 2;
  const canvasSize = size * scale;
  const pixels = new Uint8ClampedArray(canvasSize * canvasSize * 4);

  for (let y = 0; y < canvasSize; y += 1) {
    for (let x = 0; x < canvasSize; x += 1) {
      const nx = x / canvasSize;
      const ny = y / canvasSize;
      const i = (y * canvasSize + x) * 4;
      const alpha = roundedRectAlpha(nx, ny, 0.094, 0.094, 0.812, 0.812, 0.19);
      if (alpha <= 0) {
        continue;
      }

      const t = Math.max(0, Math.min(1, (nx * 0.48 + ny * 0.52 - 0.08) / 0.84));
      const [r1, g1, b1] = [37, 99, 235];
      const [r2, g2, b2] = t < 0.56 ? [20, 184, 166] : [139, 92, 246];
      const localT = t < 0.56 ? t / 0.56 : (t - 0.56) / 0.44;
      const [sr, sg, sb] = t < 0.56 ? [r1, g1, b1] : [20, 184, 166];
      pixels[i] = sr + (r2 - sr) * localT;
      pixels[i + 1] = sg + (g2 - sg) * localT;
      pixels[i + 2] = sb + (b2 - sb) * localT;
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }

  strokePolyline(pixels, canvasSize, [
    [0.242, 0.746],
    [0.242, 0.259],
    [0.5, 0.395],
    [0.758, 0.259],
    [0.758, 0.746],
  ], 0.102, [255, 255, 255, 255]);
  strokePolyline(pixels, canvasSize, [
    [0.371, 0.682],
    [0.371, 0.552],
    [0.5, 0.639],
    [0.629, 0.552],
    [0.629, 0.682],
  ], 0.053, [255, 255, 255, 235]);

  const downsampled = scale > 1 ? downsample(pixels, canvasSize, size, scale) : pixels;
  return encodePng(size, size, downsampled);
}

function roundedRectAlpha(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  if (x < left || x > right || y < top || y > bottom) {
    return 0;
  }

  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const d = Math.hypot(x - cx, y - cy);
  const edge = radius - d;
  return Math.max(0, Math.min(1, edge * 180));
}

function strokePolyline(pixels, size, points, width, color) {
  const mask = new Float32Array(size * size);
  for (let i = 0; i < points.length - 1; i += 1) {
    strokeSegmentMask(mask, size, points[i], points[i + 1], width);
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = mask[y * size + x];
      if (alpha > 0) {
        blendPixel(pixels, size, x, y, color, alpha);
      }
    }
  }
}

function strokeSegmentMask(mask, size, a, b, width) {
  const ax = a[0] * size;
  const ay = a[1] * size;
  const bx = b[0] * size;
  const by = b[1] * size;
  const radius = (width * size) / 2;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 2));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + radius + 2));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - radius - 2));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by) + radius + 2));
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const px = ax + t * dx;
      const py = ay + t * dy;
      const dist = Math.hypot(x - px, y - py);
      const alpha = Math.max(0, Math.min(1, radius - dist + 1));
      if (alpha > 0) {
        const i = y * size + x;
        mask[i] = Math.max(mask[i], alpha);
      }
    }
  }
}

function blendPixel(pixels, size, x, y, color, alpha) {
  const i = (y * size + x) * 4;
  const srcA = (color[3] / 255) * alpha;
  const dstA = pixels[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) {
    return;
  }
  pixels[i] = (color[0] * srcA + pixels[i] * dstA * (1 - srcA)) / outA;
  pixels[i + 1] = (color[1] * srcA + pixels[i + 1] * dstA * (1 - srcA)) / outA;
  pixels[i + 2] = (color[2] * srcA + pixels[i + 2] * dstA * (1 - srcA)) / outA;
  pixels[i + 3] = outA * 255;
}

function downsample(source, sourceSize, targetSize, scale) {
  const target = new Uint8ClampedArray(targetSize * targetSize * 4);
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const i = ((y * scale + sy) * sourceSize + (x * scale + sx)) * 4;
          sums[0] += source[i];
          sums[1] += source[i + 1];
          sums[2] += source[i + 2];
          sums[3] += source[i + 3];
        }
      }
      const j = (y * targetSize + x) * 4;
      const area = scale * scale;
      target[j] = sums[0] / area;
      target[j + 1] = sums[1] / area;
      target[j + 2] = sums[2] / area;
      target[j + 3] = sums[3] / area;
    }
  }
  return target;
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  return Buffer.concat([u32(data.length), typeBuffer, data, u32(crc)]);
}

function encodeIco(pngs, sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (let i = 0; i < pngs.length; i += 1) {
    const entry = Buffer.alloc(16);
    entry[0] = sizes[i] === 256 ? 0 : sizes[i];
    entry[1] = sizes[i] === 256 ? 0 : sizes[i];
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(pngs[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += pngs[i].length;
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

function encodeIcns(entries) {
  const typeBySize = new Map([
    [16, 'icp4'],
    [32, 'icp5'],
    [64, 'icp6'],
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
    [1024, 'ic10'],
  ]);
  const blocks = entries.map(([size, png]) => {
    const type = typeBySize.get(size);
    if (!type) {
      throw new Error(`Unsupported ICNS size: ${size}`);
    }
    return Buffer.concat([Buffer.from(type), u32(8 + png.length), png]);
  });
  const length = 8 + blocks.reduce((sum, block) => sum + block.length, 0);
  return Buffer.concat([Buffer.from('icns'), u32(length), ...blocks]);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
