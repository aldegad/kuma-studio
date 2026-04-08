import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC32_POLYNOMIAL = 0xedb88320;
const crcTable = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? (value >>> 1) ^ CRC32_POLYNOMIAL : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function paethPredictor(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);

  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  if (upDistance <= upperLeftDistance) {
    return up;
  }
  return upperLeft;
}

function unfilterScanline(filterType, scanline, previousScanline, bytesPerPixel) {
  const output = Buffer.alloc(scanline.length);

  for (let index = 0; index < scanline.length; index += 1) {
    const left = index >= bytesPerPixel ? output[index - bytesPerPixel] : 0;
    const up = previousScanline?.[index] ?? 0;
    const upperLeft = index >= bytesPerPixel ? previousScanline?.[index - bytesPerPixel] ?? 0 : 0;
    const raw = scanline[index];

    switch (filterType) {
      case 0:
        output[index] = raw;
        break;
      case 1:
        output[index] = (raw + left) & 0xff;
        break;
      case 2:
        output[index] = (raw + up) & 0xff;
        break;
      case 3:
        output[index] = (raw + Math.floor((left + up) / 2)) & 0xff;
        break;
      case 4:
        output[index] = (raw + paethPredictor(left, up, upperLeft)) & 0xff;
        break;
      default:
        throw new Error(`Unsupported PNG filter type: ${filterType}`);
    }
  }

  return output;
}

function readPixel(image, x, y) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return [0, 0, 0, 0];
  }

  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset],
    image.data[offset + 1],
    image.data[offset + 2],
    image.data[offset + 3],
  ];
}

function writePixel(image, x, y, rgba) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return;
  }

  const offset = (y * image.width + x) * 4;
  image.data[offset] = rgba[0];
  image.data[offset + 1] = rgba[1];
  image.data[offset + 2] = rgba[2];
  image.data[offset + 3] = rgba[3];
}

function imagesEqual(left, right) {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2] && left[3] === right[3];
}

function drawRectOutline(image, bounds, rgba, thickness = 2) {
  if (!bounds) {
    return;
  }

  const xStart = bounds.x;
  const yStart = bounds.y;
  const xEnd = bounds.x + bounds.width - 1;
  const yEnd = bounds.y + bounds.height - 1;

  for (let layer = 0; layer < thickness; layer += 1) {
    const top = yStart - layer;
    const bottom = yEnd + layer;
    const left = xStart - layer;
    const right = xEnd + layer;

    for (let x = left; x <= right; x += 1) {
      writePixel(image, x, top, rgba);
      writePixel(image, x, bottom, rgba);
    }

    for (let y = top; y <= bottom; y += 1) {
      writePixel(image, left, y, rgba);
      writePixel(image, right, y, rgba);
    }
  }
}

function colorTypeToChannelCount(colorType) {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new Error(`Unsupported PNG color type: ${colorType}`);
  }
}

export function encodePng({ width, height, data }) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error("PNG width and height must be positive integers.");
  }

  if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) {
    throw new Error("PNG data must be a Uint8Array or Buffer.");
  }

  if (data.length !== width * height * 4) {
    throw new Error("RGBA PNG data length does not match the provided dimensions.");
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (1 + width * 4);
    raw[rawOffset] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, rawOffset + 1);
  }

  const idat = deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk("IHDR", ihdr),
    createChunk("IDAT", idat),
    createChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function decodePng(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (source.length < PNG_SIGNATURE.length || !source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG signature.");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 8 <= source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;

    if (crcEnd > source.length) {
      throw new Error("Truncated PNG chunk payload.");
    }

    const data = source.subarray(dataStart, dataEnd);
    offset = crcEnd;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const compressionMethod = data[10];
      const filterMethod = data[11];
      const interlaceMethod = data[12];

      if (bitDepth !== 8) {
        throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
      }
      if (compressionMethod !== 0 || filterMethod !== 0) {
        throw new Error("Unsupported PNG compression or filter method.");
      }
      if (interlaceMethod !== 0) {
        throw new Error("Interlaced PNGs are not supported.");
      }
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (width < 1 || height < 1 || idatChunks.length === 0) {
    throw new Error("PNG missing image data.");
  }

  const channelCount = colorTypeToChannelCount(colorType);
  const bytesPerPixel = channelCount;
  const rowLength = width * channelCount;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const expectedLength = height * (1 + rowLength);
  if (inflated.length < expectedLength) {
    throw new Error("PNG image data is shorter than expected.");
  }

  const rgba = new Uint8Array(width * height * 4);
  let inflatedOffset = 0;
  let previousScanline = null;

  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[inflatedOffset];
    const filteredScanline = inflated.subarray(inflatedOffset + 1, inflatedOffset + 1 + rowLength);
    const scanline = unfilterScanline(filterType, filteredScanline, previousScanline, bytesPerPixel);
    previousScanline = scanline;
    inflatedOffset += 1 + rowLength;

    for (let x = 0; x < width; x += 1) {
      const sourceOffset = x * channelCount;
      const targetOffset = (y * width + x) * 4;

      if (colorType === 0) {
        const value = scanline[sourceOffset];
        rgba[targetOffset] = value;
        rgba[targetOffset + 1] = value;
        rgba[targetOffset + 2] = value;
        rgba[targetOffset + 3] = 255;
      } else if (colorType === 2) {
        rgba[targetOffset] = scanline[sourceOffset];
        rgba[targetOffset + 1] = scanline[sourceOffset + 1];
        rgba[targetOffset + 2] = scanline[sourceOffset + 2];
        rgba[targetOffset + 3] = 255;
      } else if (colorType === 4) {
        const value = scanline[sourceOffset];
        rgba[targetOffset] = value;
        rgba[targetOffset + 1] = value;
        rgba[targetOffset + 2] = value;
        rgba[targetOffset + 3] = scanline[sourceOffset + 1];
      } else {
        rgba[targetOffset] = scanline[sourceOffset];
        rgba[targetOffset + 1] = scanline[sourceOffset + 1];
        rgba[targetOffset + 2] = scanline[sourceOffset + 2];
        rgba[targetOffset + 3] = scanline[sourceOffset + 3];
      }
    }
  }

  return {
    width,
    height,
    data: rgba,
    bitDepth,
    colorType,
  };
}

export function diffRgbaImages(before, after) {
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const output = {
    width,
    height,
    data: new Uint8Array(width * height * 4),
  };
  let changedPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const beforePixel = readPixel(before, x, y);
      const afterPixel = readPixel(after, x, y);
      const basePixel = afterPixel[3] > 0 || x < after.width || y < after.height ? afterPixel : beforePixel;
      writePixel(output, x, y, basePixel);

      if (!imagesEqual(beforePixel, afterPixel)) {
        changedPixels += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const changedBounds =
    changedPixels > 0
      ? {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        }
      : null;

  if (changedBounds) {
    drawRectOutline(output, changedBounds, [255, 0, 0, 255], 2);
  }

  return {
    ...output,
    changedPixels,
    changedBounds,
  };
}
