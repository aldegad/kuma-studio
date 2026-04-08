import { deflateSync } from "node:zlib";

import { assert, describe, it } from "vitest";

import { decodePng, diffRgbaImages, encodePng } from "./png-utils.mjs";

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

function applyFilter(filterType, scanline, previousScanline, bytesPerPixel) {
  const filtered = Buffer.alloc(scanline.length);

  for (let index = 0; index < scanline.length; index += 1) {
    const left = index >= bytesPerPixel ? scanline[index - bytesPerPixel] : 0;
    const up = previousScanline?.[index] ?? 0;
    const upperLeft = index >= bytesPerPixel ? previousScanline?.[index - bytesPerPixel] ?? 0 : 0;
    const value = scanline[index];

    switch (filterType) {
      case 0:
        filtered[index] = value;
        break;
      case 1:
        filtered[index] = (value - left + 256) & 0xff;
        break;
      case 2:
        filtered[index] = (value - up + 256) & 0xff;
        break;
      case 3:
        filtered[index] = (value - Math.floor((left + up) / 2) + 256) & 0xff;
        break;
      case 4:
        filtered[index] = (value - paethPredictor(left, up, upperLeft) + 256) & 0xff;
        break;
      default:
        throw new Error(`Unsupported filter ${filterType}`);
    }
  }

  return filtered;
}

function createFilteredRgbaPng({ width, height, rows, filters }) {
  const bytesPerPixel = 4;
  const raw = [];
  let previousScanline = null;

  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const scanline = Buffer.from(rows[rowIndex]);
    const filterType = filters[rowIndex];
    raw.push(Buffer.from([filterType]));
    raw.push(applyFilter(filterType, scanline, previousScanline, bytesPerPixel));
    previousScanline = scanline;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    createChunk("IHDR", ihdr),
    createChunk("IDAT", deflateSync(Buffer.concat(raw))),
    createChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("png-utils", () => {
  it("encodes and decodes RGBA PNG data", () => {
    const data = new Uint8Array([
      10, 20, 30, 255,
      40, 50, 60, 255,
    ]);

    const buffer = encodePng({
      width: 2,
      height: 1,
      data,
    });
    const decoded = decodePng(buffer);

    assert.strictEqual(decoded.width, 2);
    assert.strictEqual(decoded.height, 1);
    assert.deepEqual(Array.from(decoded.data), Array.from(data));
  });

  for (const filterType of [1, 2, 3, 4]) {
    it(`decodes PNG scanlines filtered with filter ${filterType}`, () => {
      const rows = [
        Buffer.from([
          10, 20, 30, 255,
          40, 50, 60, 255,
        ]),
        Buffer.from([
          70, 80, 90, 255,
          100, 110, 120, 255,
        ]),
      ];

      const buffer = createFilteredRgbaPng({
        width: 2,
        height: 2,
        rows,
        filters: [0, filterType],
      });
      const decoded = decodePng(buffer);

      assert.deepEqual(Array.from(decoded.data), Array.from(Buffer.concat(rows)));
    });
  }

  it("computes changed bounds and paints a red diff box", () => {
    const before = {
      width: 2,
      height: 2,
      data: new Uint8Array([
        255, 255, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
      ]),
    };
    const after = {
      width: 2,
      height: 2,
      data: new Uint8Array([
        255, 255, 255, 255,
        0, 0, 0, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
      ]),
    };

    const diff = diffRgbaImages(before, after);

    assert.strictEqual(diff.changedPixels, 1);
    assert.deepEqual(diff.changedBounds, { x: 1, y: 0, width: 1, height: 1 });
    assert.deepEqual(Array.from(diff.data.slice(4, 8)), [255, 0, 0, 255]);
  });
});
