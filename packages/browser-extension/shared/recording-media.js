/*
 * Recording utilities shared by Kuma Picker capture flows.
 *
 * The WebM duration repair logic is adapted from the MIT-licensed
 * fix-webm-duration package by Yuri Sitnikov:
 * https://github.com/yusitnikov/fix-webm-duration
 */
(function (name, definition) {
  if (typeof define === "function" && define.amd) {
    define(definition);
  } else if (typeof module !== "undefined" && module.exports) {
    module.exports = definition();
  } else {
    globalThis.KumaPickerExtensionRecordingMedia = definition();
  }
})("KumaPickerExtensionRecordingMedia", function () {
  const WEBM_MIME_TYPE = "video/webm";
  const ID_SEGMENT = [0x18, 0x53, 0x80, 0x67];
  const ID_INFO = [0x15, 0x49, 0xa9, 0x66];
  const ID_TIMECODE_SCALE = [0x2a, 0xd7, 0xb1];
  const ID_DURATION = [0x44, 0x89];
  const ID_CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
  const ID_CLUSTER_TIMECODE = [0xe7];
  const ID_SIMPLE_BLOCK = [0xa3];
  const ID_BLOCK_GROUP = [0xa0];
  const ID_BLOCK = [0xa1];
  const ID_BLOCK_DURATION = [0x9b];
  const DEFAULT_TIMECODE_SCALE_NS = 1_000_000;

  function buildMimeTypeCandidates({ includeAudio = false } = {}) {
    return includeAudio
      ? [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          WEBM_MIME_TYPE,
        ]
      : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", WEBM_MIME_TYPE];
  }

  function selectSupportedMimeType(options = {}) {
    if (typeof MediaRecorder?.isTypeSupported !== "function") {
      return "";
    }

    const candidates = buildMimeTypeCandidates(options);
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
  }

  function isWebmMimeType(mimeType) {
    const candidate = typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
    return candidate.startsWith(WEBM_MIME_TYPE);
  }

  async function readBlobAsUint8Array(blob) {
    if (!blob || typeof blob.arrayBuffer !== "function") {
      return new Uint8Array();
    }

    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  function concatUint8Arrays(parts) {
    const normalized = Array.isArray(parts) ? parts.filter((part) => part instanceof Uint8Array) : [];
    const total = normalized.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of normalized) {
      merged.set(part, offset);
      offset += part.length;
    }
    return merged;
  }

  function startsWithId(bytes, offset, idBytes) {
    if (!(bytes instanceof Uint8Array) || !Array.isArray(idBytes)) {
      return false;
    }
    if (offset < 0 || offset + idBytes.length > bytes.length) {
      return false;
    }
    for (let index = 0; index < idBytes.length; index += 1) {
      if (bytes[offset + index] !== idBytes[index]) {
        return false;
      }
    }
    return true;
  }

  function readVintLength(firstByte) {
    for (let length = 1; length <= 8; length += 1) {
      const mask = 1 << (8 - length);
      if (firstByte & mask) {
        return length;
      }
    }
    return 0;
  }

  function readElementId(bytes, offset) {
    if (!(bytes instanceof Uint8Array) || offset >= bytes.length) {
      return null;
    }
    const length = readVintLength(bytes[offset]);
    if (length === 0 || offset + length > bytes.length) {
      return null;
    }
    const raw = bytes.slice(offset, offset + length);
    return {
      raw,
      start: offset,
      end: offset + length,
    };
  }

  function readElementSize(bytes, offset) {
    if (!(bytes instanceof Uint8Array) || offset >= bytes.length) {
      return null;
    }
    const length = readVintLength(bytes[offset]);
    if (length === 0 || offset + length > bytes.length) {
      return null;
    }
    const mask = (1 << (8 - length)) - 1;
    let value = bytes[offset] & mask;
    let allOnes = value === mask;
    for (let index = 1; index < length; index += 1) {
      value = (value * 256) + bytes[offset + index];
      allOnes = allOnes && bytes[offset + index] === 0xff;
    }
    return {
      length,
      value,
      unknown: allOnes,
      start: offset,
      end: offset + length,
      raw: bytes.slice(offset, offset + length),
    };
  }

  function parseElement(bytes, offset, limit = bytes.length) {
    if (!(bytes instanceof Uint8Array) || offset >= limit) {
      return null;
    }
    const id = readElementId(bytes, offset);
    if (!id) {
      return null;
    }
    const size = readElementSize(bytes, id.end);
    if (!size) {
      return null;
    }
    const dataStart = size.end;
    const dataEnd = size.unknown ? limit : Math.min(limit, dataStart + size.value);
    if (dataEnd > limit || dataStart > dataEnd) {
      return null;
    }
    return {
      idBytes: id.raw,
      sizeBytes: size.raw,
      sizeLength: size.length,
      sizeUnknown: size.unknown,
      sizeValue: size.value,
      start: offset,
      idEnd: id.end,
      sizeEnd: size.end,
      dataStart,
      dataEnd,
      end: dataEnd,
      raw: bytes.slice(offset, dataEnd),
      data: bytes.slice(dataStart, dataEnd),
    };
  }

  function parseChildren(bytes, start, end) {
    const items = [];
    let cursor = start;
    while (cursor < end) {
      const element = parseElement(bytes, cursor, end);
      if (!element || element.end <= cursor) {
        break;
      }
      items.push(element);
      cursor = element.end;
    }
    return items;
  }

  function findChild(children, idBytes) {
    return Array.isArray(children) ? children.find((child) => compareBytes(child?.idBytes, idBytes)) ?? null : null;
  }

  function compareBytes(left, right) {
    if (!(left instanceof Uint8Array) || !Array.isArray(right) && !(right instanceof Uint8Array)) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }
    return true;
  }

  function readUnsignedInt(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      return 0;
    }
    let value = 0;
    for (const byte of bytes) {
      value = (value * 256) + byte;
    }
    return value;
  }

  function encodeUnsignedInt(value) {
    const normalized = Math.max(0, Math.floor(Number(value) || 0));
    if (normalized === 0) {
      return new Uint8Array([0]);
    }
    const parts = [];
    let remainder = normalized;
    while (remainder > 0) {
      parts.unshift(remainder & 0xff);
      remainder = Math.floor(remainder / 256);
    }
    return new Uint8Array(parts);
  }

  function readFloat(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      return 0;
    }
    if (bytes.length === 4) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return view.getFloat32(0, false);
    }
    if (bytes.length === 8) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return view.getFloat64(0, false);
    }
    return 0;
  }

  function encodeFloat64(value) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, Number.isFinite(value) ? value : 0, false);
    return new Uint8Array(buffer);
  }

  function encodeVintSize(value, preferredLength = 0) {
    const normalized = Math.max(0, Math.floor(Number(value) || 0));
    const minLength = preferredLength > 0 ? preferredLength : 1;
    for (let length = minLength; length <= 8; length += 1) {
      const limit = Math.pow(2, 7 * length) - 2;
      if (normalized <= limit) {
        const bytes = new Uint8Array(length);
        let remainder = normalized;
        for (let index = length - 1; index >= 0; index -= 1) {
          bytes[index] = remainder & 0xff;
          remainder = Math.floor(remainder / 256);
        }
        bytes[0] |= 1 << (8 - length);
        return bytes;
      }
    }
    throw new Error("EBML size is too large to encode.");
  }

  function encodeElement(idBytes, dataBytes, { preferredSizeLength = 0, keepUnknownSize = false } = {}) {
    const normalizedIdBytes = idBytes instanceof Uint8Array ? idBytes : new Uint8Array(idBytes);
    const normalizedDataBytes = dataBytes instanceof Uint8Array ? dataBytes : new Uint8Array(dataBytes);
    const sizeBytes = keepUnknownSize
      ? new Uint8Array(preferredSizeLength > 0 ? preferredSizeLength : 8).fill(0xff)
      : encodeVintSize(normalizedDataBytes.length, preferredSizeLength);
    return concatUint8Arrays([normalizedIdBytes, sizeBytes, normalizedDataBytes]);
  }

  function decodeSimpleBlockTimecode(data) {
    if (!(data instanceof Uint8Array) || data.length < 4) {
      return 0;
    }
    const trackLength = readVintLength(data[0]);
    const timecodeOffset = trackLength;
    if (trackLength === 0 || data.length < timecodeOffset + 2) {
      return 0;
    }
    const view = new DataView(data.buffer, data.byteOffset + timecodeOffset, 2);
    return view.getInt16(0, false);
  }

  function parseBlockGroupMaxTimecode(groupData) {
    const children = parseChildren(groupData, 0, groupData.length);
    const block = findChild(children, ID_BLOCK);
    if (!block) {
      return 0;
    }
    const blockDuration = findChild(children, ID_BLOCK_DURATION);
    return decodeSimpleBlockTimecode(block.data) + readUnsignedInt(blockDuration?.data ?? new Uint8Array());
  }

  function estimateWebmDurationMsFromBytes(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      return 0;
    }

    const topLevel = parseChildren(bytes, 0, bytes.length);
    const segment = findChild(topLevel, ID_SEGMENT);
    if (!segment) {
      return 0;
    }

    const segmentChildren = parseChildren(bytes, segment.dataStart, segment.dataEnd);
    const info = findChild(segmentChildren, ID_INFO);
    const infoChildren = info ? parseChildren(bytes, info.dataStart, info.dataEnd) : [];
    const timecodeScale = readUnsignedInt(findChild(infoChildren, ID_TIMECODE_SCALE)?.data ?? new Uint8Array()) || DEFAULT_TIMECODE_SCALE_NS;

    let maxTimecode = 0;
    for (const child of segmentChildren) {
      if (!compareBytes(child.idBytes, ID_CLUSTER)) {
        continue;
      }
      const clusterChildren = parseChildren(bytes, child.dataStart, child.dataEnd);
      const clusterTimecode = readUnsignedInt(findChild(clusterChildren, ID_CLUSTER_TIMECODE)?.data ?? new Uint8Array());
      let clusterMax = clusterTimecode;

      for (const clusterChild of clusterChildren) {
        if (compareBytes(clusterChild.idBytes, ID_SIMPLE_BLOCK)) {
          clusterMax = Math.max(clusterMax, clusterTimecode + decodeSimpleBlockTimecode(clusterChild.data));
          continue;
        }
        if (compareBytes(clusterChild.idBytes, ID_BLOCK_GROUP)) {
          clusterMax = Math.max(clusterMax, clusterTimecode + parseBlockGroupMaxTimecode(clusterChild.data));
        }
      }

      maxTimecode = Math.max(maxTimecode, clusterMax);
    }

    return Math.max(0, Math.round((maxTimecode * timecodeScale) / 1_000_000));
  }

  function patchWebmDurationBytes(bytes, durationMs) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
      return bytes;
    }

    const topLevel = parseChildren(bytes, 0, bytes.length);
    const segmentIndex = topLevel.findIndex((child) => compareBytes(child.idBytes, ID_SEGMENT));
    if (segmentIndex === -1) {
      return bytes;
    }

    const segment = topLevel[segmentIndex];
    const segmentChildren = parseChildren(bytes, segment.dataStart, segment.dataEnd);
    const infoIndex = segmentChildren.findIndex((child) => compareBytes(child.idBytes, ID_INFO));
    if (infoIndex === -1) {
      return bytes;
    }

    const info = segmentChildren[infoIndex];
    const infoChildren = parseChildren(bytes, info.dataStart, info.dataEnd);
    const existingDuration = findChild(infoChildren, ID_DURATION);
    if (existingDuration && readFloat(existingDuration.data) > 0) {
      return bytes;
    }

    const nextInfoChildren = [];
    let wroteTimecodeScale = false;
    let wroteDuration = false;
    for (const child of infoChildren) {
      if (compareBytes(child.idBytes, ID_TIMECODE_SCALE)) {
        nextInfoChildren.push(encodeElement(child.idBytes, encodeUnsignedInt(DEFAULT_TIMECODE_SCALE_NS), {
          preferredSizeLength: child.sizeLength,
          keepUnknownSize: child.sizeUnknown,
        }));
        wroteTimecodeScale = true;
        continue;
      }
      if (compareBytes(child.idBytes, ID_DURATION)) {
        nextInfoChildren.push(encodeElement(child.idBytes, encodeFloat64(durationMs), {
          preferredSizeLength: child.sizeLength,
          keepUnknownSize: child.sizeUnknown,
        }));
        wroteDuration = true;
        continue;
      }
      nextInfoChildren.push(child.raw);
    }

    if (!wroteTimecodeScale) {
      nextInfoChildren.push(encodeElement(ID_TIMECODE_SCALE, encodeUnsignedInt(DEFAULT_TIMECODE_SCALE_NS)));
    }
    if (!wroteDuration) {
      nextInfoChildren.push(encodeElement(ID_DURATION, encodeFloat64(durationMs)));
    }

    const nextInfo = encodeElement(info.idBytes, concatUint8Arrays(nextInfoChildren), {
      preferredSizeLength: info.sizeLength,
      keepUnknownSize: info.sizeUnknown,
    });
    const nextSegmentChildren = segmentChildren.map((child, index) => (index === infoIndex ? nextInfo : child.raw));
    const nextSegment = encodeElement(segment.idBytes, concatUint8Arrays(nextSegmentChildren), {
      preferredSizeLength: segment.sizeLength,
      keepUnknownSize: segment.sizeUnknown,
    });

    const nextTopLevel = topLevel.map((child, index) => (index === segmentIndex ? nextSegment : child.raw));
    return concatUint8Arrays(nextTopLevel);
  }

  async function finalizeRecordedBlob(blob, { durationMs = 0, mimeType = "" } = {}) {
    const candidateMimeType = mimeType || blob?.type || WEBM_MIME_TYPE;
    if (!isWebmMimeType(candidateMimeType) || !blob || typeof blob.arrayBuffer !== "function") {
      return blob;
    }

    const rawBytes = await readBlobAsUint8Array(blob);
    if (rawBytes.length === 0) {
      return blob;
    }

    const effectiveDurationMs =
      Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : estimateWebmDurationMsFromBytes(rawBytes);
    if (!effectiveDurationMs) {
      return blob;
    }

    const fixedBytes = patchWebmDurationBytes(rawBytes, effectiveDurationMs);
    if (!(fixedBytes instanceof Uint8Array) || fixedBytes.length === 0) {
      return blob;
    }

    return new Blob([fixedBytes], {
      type: candidateMimeType || WEBM_MIME_TYPE,
    });
  }

  return {
    WEBM_MIME_TYPE,
    buildMimeTypeCandidates,
    selectSupportedMimeType,
    readBlobAsUint8Array,
    estimateWebmDurationMsFromBytes,
    finalizeRecordedBlob,
  };
});
