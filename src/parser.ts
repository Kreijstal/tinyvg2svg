/**
 * TinyVG binary parser - reads .tvg files and produces a TinyVGDocument
 * Based on the TinyVG specification v1.0
 */

import {
  ColorEncoding,
  CoordinateRange,
  CommandIndex,
  StyleType,
  PathSegmentType,
  type RGBA,
  type Point,
  type Rectangle,
  type Line,
  type Style,
  type FlatStyle,
  type LinearGradientStyle,
  type RadialGradientStyle,
  type Path,
  type PathSegment,
  type LineSegment,
  type HorizontalLineSegment,
  type VerticalLineSegment,
  type CubicBezierSegment,
  type ArcCircleSegment,
  type ArcEllipseSegment,
  type ClosePathSegment,
  type QuadraticBezierSegment,
  type TVGCommand,
  type TinyVGHeader,
  type TinyVGDocument,
} from "./types";

export class ParseError extends Error {
  constructor(message: string) {
    super(`TinyVG parse error: ${message}`);
    this.name = "ParseError";
  }
}

/**
 * Binary reader with position tracking for parsing TinyVG data
 */
class BinaryReader {
  private data: Uint8Array;
  private view: DataView;
  private pos: number = 0;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get position(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.data.length - this.pos;
  }

  seek(pos: number): void {
    if (pos < 0 || pos > this.data.length) {
      throw new ParseError(`Seek position ${pos} out of range (0..${this.data.length})`);
    }
    this.pos = pos;
  }

  readByte(): number {
    if (this.pos >= this.data.length) {
      throw new ParseError("Unexpected end of data while reading byte");
    }
    return this.data[this.pos++];
  }

  readBytes(count: number): Uint8Array {
    if (this.pos + count > this.data.length) {
      throw new ParseError(`Unexpected end of data while reading ${count} bytes`);
    }
    const slice = this.data.slice(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }

  readUint8(): number {
    return this.readByte();
  }

  readUint16LE(): number {
    if (this.pos + 2 > this.data.length) {
      throw new ParseError("Unexpected end of data while reading u16");
    }
    const val = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return val;
  }

  readUint32LE(): number {
    if (this.pos + 4 > this.data.length) {
      throw new ParseError("Unexpected end of data while reading u32");
    }
    const val = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return val;
  }

  readFloat32LE(): number {
    if (this.pos + 4 > this.data.length) {
      throw new ParseError("Unexpected end of data while reading f32");
    }
    const val = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return val;
  }

  /**
   * Reads a VarUInt from the stream (variable-length unsigned integer)
   * Uses 7 bits per byte with MSB as continuation flag
   */
  readVarUInt(): number {
    let result = 0;
    let shift = 0;
    let byteCount = 0;

    while (true) {
      const byte = this.readByte();
      byteCount++;

      result |= (byte & 0x7f) << shift;

      if ((byte & 0x80) === 0) {
        break;
      }

      if (byteCount >= 5) {
        throw new ParseError("VarUInt exceeded maximum length of 5 bytes");
      }

      shift += 7;
    }

    if (result > 0xffffffff) {
      throw new ParseError(`VarUInt value ${result} exceeds 32-bit range`);
    }

    return result >>> 0; // ensure unsigned
  }

  /**
   * Reads a Unit value - a signed fixed-point number
   * The size depends on coordinate range (8, 16, or 32 bits)
   * The scale determines fractional bits
   */
  readUnit(scale: number, coordinateRange: CoordinateRange): number {
    let rawValue: number;

    switch (coordinateRange) {
      case CoordinateRange.Reduced:
        rawValue = this.readUint8();
        // Sign-extend from 8 bits
        if (rawValue & 0x80) {
          rawValue = rawValue - 256;
        }
        break;

      case CoordinateRange.Default:
        rawValue = this.readUint16LE();
        // Sign-extend from 16 bits
        if (rawValue & 0x8000) {
          rawValue = rawValue - 0x10000;
        }
        break;

      case CoordinateRange.Enhanced:
        rawValue = this.readUint32LE();
        // Sign-extend from 32 bits (already handled by JS bitwise ops)
        rawValue = rawValue | 0;
        break;

      default:
        throw new ParseError(`Unknown coordinate range: ${coordinateRange}`);
    }

    return rawValue / (1 << scale);
  }

  /**
   * Reads a Point (x, y pair of Units)
   */
  readPoint(scale: number, coordinateRange: CoordinateRange): Point {
    return {
      x: this.readUnit(scale, coordinateRange),
      y: this.readUnit(scale, coordinateRange),
    };
  }

  /**
   * Reads a Rectangle (x, y, width, height of Units)
   */
  readRectangle(scale: number, coordinateRange: CoordinateRange): Rectangle {
    return {
      x: this.readUnit(scale, coordinateRange),
      y: this.readUnit(scale, coordinateRange),
      width: this.readUnit(scale, coordinateRange),
      height: this.readUnit(scale, coordinateRange),
    };
  }

  /**
   * Reads a Line (start and end Points)
   */
  readLine(scale: number, coordinateRange: CoordinateRange): Line {
    return {
      start: this.readPoint(scale, coordinateRange),
      end: this.readPoint(scale, coordinateRange),
    };
  }
}

/**
 * Parse a TinyVG binary file and return a structured document
 */
export function parseTinyVG(data: Uint8Array): TinyVGDocument {
  const reader = new BinaryReader(data);

  // --- Parse Header ---
  const magic1 = reader.readByte();
  const magic2 = reader.readByte();

  if (magic1 !== 0x72 || magic2 !== 0x56) {
    throw new ParseError(
      `Invalid magic bytes: expected 0x72 0x56, got 0x${magic1.toString(16)} 0x${magic2.toString(16)}`
    );
  }

  const version = reader.readByte();
  if (version !== 1) {
    throw new ParseError(`Unsupported TinyVG version: ${version}`);
  }

  // scale (u4) and color_encoding (u2) and coordinate_range (u2) are packed in one byte
  const flagsByte = reader.readByte();
  const scale = flagsByte & 0x0f;
  const colorEncoding: ColorEncoding = (flagsByte >> 4) & 0x03;
  const coordinateRange: CoordinateRange = (flagsByte >> 6) & 0x03;

  if (colorEncoding === ColorEncoding.Custom) {
    throw new ParseError("Custom color encoding is not supported");
  }

  let width: number;
  let height: number;

  switch (coordinateRange) {
    case CoordinateRange.Reduced:
      width = reader.readUint8();
      height = reader.readUint8();
      break;
    case CoordinateRange.Default:
      width = reader.readUint16LE();
      height = reader.readUint16LE();
      break;
    case CoordinateRange.Enhanced:
      width = reader.readUint32LE();
      height = reader.readUint32LE();
      break;
    default:
      throw new ParseError(`Unknown coordinate range: ${coordinateRange}`);
  }

  const colorCount = reader.readVarUInt();

  const header: TinyVGHeader = {
    magic: [0x72, 0x56],
    version,
    scale,
    colorEncoding,
    coordinateRange,
    width,
    height,
    colorCount,
  };

  // --- Parse Color Table ---
  const colorTable: RGBA[] = [];
  for (let i = 0; i < colorCount; i++) {
    colorTable.push(readColor(reader, colorEncoding));
  }

  // --- Parse Commands ---
  const commands: TVGCommand[] = [];
  while (true) {
    const commandByte = reader.readByte();
    const commandIndex: CommandIndex = commandByte & 0x3f;
    const primStyleKind: StyleType = (commandByte >> 6) & 0x03;

    if (commandIndex === CommandIndex.EndOfDocument) {
      break;
    }

    commands.push(
      readCommand(reader, commandIndex, primStyleKind, scale, coordinateRange, colorTable)
    );
  }

  return { header, colorTable, commands };
}

/**
 * Reads a color from the color table
 */
function readColor(reader: BinaryReader, encoding: ColorEncoding): RGBA {
  switch (encoding) {
    case ColorEncoding.RGBA8888: {
      const r = reader.readUint8();
      const g = reader.readUint8();
      const b = reader.readUint8();
      const a = reader.readUint8();
      return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
    }

    case ColorEncoding.RGB565: {
      const lo = reader.readUint8();
      const hi = reader.readUint8();
      const raw = lo | (hi << 8);
      const r5 = raw & 0x1f;
      const g6 = (raw >> 5) & 0x3f;
      const b5 = (raw >> 11) & 0x1f;
      return {
        r: r5 / 31,
        g: g6 / 63,
        b: b5 / 31,
        a: 1.0,
      };
    }

    case ColorEncoding.RGBAF32: {
      const r = reader.readFloat32LE();
      const g = reader.readFloat32LE();
      const b = reader.readFloat32LE();
      const a = reader.readFloat32LE();
      return { r, g, b, a };
    }

    default:
      throw new ParseError(`Unsupported color encoding: ${encoding}`);
  }
}

/**
 * Reads a Style based on the style type
 */
function readStyle(
  reader: BinaryReader,
  styleType: StyleType,
  scale: number,
  coordinateRange: CoordinateRange
): Style {
  switch (styleType) {
    case StyleType.Flat: {
      const colorIndex = reader.readVarUInt();
      return { type: StyleType.Flat, colorIndex } as FlatStyle;
    }

    case StyleType.LinearGradient: {
      const point1 = reader.readPoint(scale, coordinateRange);
      const point2 = reader.readPoint(scale, coordinateRange);
      const colorIndex1 = reader.readVarUInt();
      const colorIndex2 = reader.readVarUInt();
      return {
        type: StyleType.LinearGradient,
        point1,
        point2,
        colorIndex1,
        colorIndex2,
      } as LinearGradientStyle;
    }

    case StyleType.RadialGradient: {
      const point1 = reader.readPoint(scale, coordinateRange);
      const point2 = reader.readPoint(scale, coordinateRange);
      const colorIndex1 = reader.readVarUInt();
      const colorIndex2 = reader.readVarUInt();
      return {
        type: StyleType.RadialGradient,
        point1,
        point2,
        colorIndex1,
        colorIndex2,
      } as RadialGradientStyle;
    }

    default:
      throw new ParseError(`Unknown style type: ${styleType}`);
  }
}

/**
 * Reads a Path with the given number of segments
 */
function readPath(
  reader: BinaryReader,
  segmentCount: number,
  scale: number,
  coordinateRange: CoordinateRange
): Path {
  const origin = reader.readPoint(scale, coordinateRange);
  const segments: PathSegment[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const segmentByte = reader.readByte();
    const segmentType: PathSegmentType = segmentByte & 0x07;
    const hasLineWidthChange = (segmentByte >> 3) & 0x01;

    let lineWidthChange: number | null = null;
    if (hasLineWidthChange) {
      lineWidthChange = reader.readUnit(scale, coordinateRange);
    }

    switch (segmentType) {
      case PathSegmentType.Line:
        segments.push({
          type: PathSegmentType.Line,
          lineWidthChange,
          end: reader.readPoint(scale, coordinateRange),
        } as LineSegment);
        break;

      case PathSegmentType.HorizontalLine:
        segments.push({
          type: PathSegmentType.HorizontalLine,
          lineWidthChange,
          x: reader.readUnit(scale, coordinateRange),
        } as HorizontalLineSegment);
        break;

      case PathSegmentType.VerticalLine:
        segments.push({
          type: PathSegmentType.VerticalLine,
          lineWidthChange,
          y: reader.readUnit(scale, coordinateRange),
        } as VerticalLineSegment);
        break;

      case PathSegmentType.CubicBezier:
        segments.push({
          type: PathSegmentType.CubicBezier,
          lineWidthChange,
          control1: reader.readPoint(scale, coordinateRange),
          control2: reader.readPoint(scale, coordinateRange),
          end: reader.readPoint(scale, coordinateRange),
        } as CubicBezierSegment);
        break;

      case PathSegmentType.ArcCircle: {
        const radius = reader.readUnit(scale, coordinateRange);
        const flags = reader.readByte();
        const largeArc = (flags & 0x01) !== 0;
        const sweep = (flags & 0x02) !== 0;
        segments.push({
          type: PathSegmentType.ArcCircle,
          lineWidthChange,
          radius,
          largeArc,
          sweep,
          end: reader.readPoint(scale, coordinateRange),
        } as ArcCircleSegment);
        break;
      }

      case PathSegmentType.ArcEllipse: {
        const radiusX = reader.readUnit(scale, coordinateRange);
        const radiusY = reader.readUnit(scale, coordinateRange);
        const angle = reader.readUnit(scale, coordinateRange);
        const flags = reader.readByte();
        const largeArc = (flags & 0x01) !== 0;
        const sweep = (flags & 0x02) !== 0;
        segments.push({
          type: PathSegmentType.ArcEllipse,
          lineWidthChange,
          radiusX,
          radiusY,
          angle,
          largeArc,
          sweep,
          end: reader.readPoint(scale, coordinateRange),
        } as ArcEllipseSegment);
        break;
      }

      case PathSegmentType.ClosePath:
        segments.push({
          type: PathSegmentType.ClosePath,
          lineWidthChange,
        } as ClosePathSegment);
        break;

      case PathSegmentType.QuadraticBezier:
        segments.push({
          type: PathSegmentType.QuadraticBezier,
          lineWidthChange,
          control: reader.readPoint(scale, coordinateRange),
          end: reader.readPoint(scale, coordinateRange),
        } as QuadraticBezierSegment);
        break;

      default:
        throw new ParseError(`Unknown path segment type: ${segmentType}`);
    }
  }

  return { origin, segments };
}

/**
 * Reads a single command from the stream
 */
function readCommand(
  reader: BinaryReader,
  commandIndex: CommandIndex,
  primStyleKind: StyleType,
  scale: number,
  coordinateRange: CoordinateRange,
  _colorTable: RGBA[]
): TVGCommand {
  switch (commandIndex) {
    case CommandIndex.FillPolygon: {
      const pointCount = reader.readVarUInt() + 1;
      const fillStyle = readStyle(reader, primStyleKind, scale, coordinateRange);
      const points: Point[] = [];
      for (let i = 0; i < pointCount; i++) {
        points.push(reader.readPoint(scale, coordinateRange));
      }
      return { command: CommandIndex.FillPolygon, fillStyle, points };
    }

    case CommandIndex.FillRectangles: {
      const rectangleCount = reader.readVarUInt() + 1;
      const fillStyle = readStyle(reader, primStyleKind, scale, coordinateRange);
      const rectangles: Rectangle[] = [];
      for (let i = 0; i < rectangleCount; i++) {
        rectangles.push(reader.readRectangle(scale, coordinateRange));
      }
      return { command: CommandIndex.FillRectangles, fillStyle, rectangles };
    }

    case CommandIndex.FillPath: {
      const segmentCount = reader.readVarUInt() + 1;
      const fillStyle = readStyle(reader, primStyleKind, scale, coordinateRange);
      const path = readPath(reader, segmentCount, scale, coordinateRange);
      return { command: CommandIndex.FillPath, fillStyle, path };
    }

    case CommandIndex.DrawLines: {
      const lineCount = reader.readVarUInt() + 1;
      const lineStyle = readStyle(reader, primStyleKind, scale, coordinateRange);
      const lineWidth = reader.readUnit(scale, coordinateRange);
      const lines: Line[] = [];
      for (let i = 0; i < lineCount; i++) {
        lines.push(reader.readLine(scale, coordinateRange));
      }
      return { command: CommandIndex.DrawLines, lineStyle, lineWidth, lines };
    }

    case CommandIndex.DrawLineLoop: {
      const pointCount = reader.readVarUInt() + 1;
      const lineStyle = readStyle(reader, primStyleKind, scale, coordinateRange);
      const lineWidth = reader.readUnit(scale, coordinateRange);
      const points: Point[] = [];
      for (let i = 0; i < pointCount; i++) {
        points.push(reader.readPoint(scale, coordinateRange));
      }
      return { command: CommandIndex.DrawLineLoop, lineStyle, lineWidth, points };
    }

    case CommandIndex.DrawLineStrip: {
      const pointCount = reader.readVarUInt() + 1;
      const lineStyle = readStyle(reader, primStyleKind, scale, coordinateRange);
      const lineWidth = reader.readUnit(scale, coordinateRange);
      const points: Point[] = [];
      for (let i = 0; i < pointCount; i++) {
        points.push(reader.readPoint(scale, coordinateRange));
      }
      return { command: CommandIndex.DrawLineStrip, lineStyle, lineWidth, points };
    }

    case CommandIndex.DrawLinePath: {
      const segmentCount = reader.readVarUInt() + 1;
      const lineStyle = readStyle(reader, primStyleKind, scale, coordinateRange);
      const lineWidth = reader.readUnit(scale, coordinateRange);
      const path = readPath(reader, segmentCount, scale, coordinateRange);
      return { command: CommandIndex.DrawLinePath, lineStyle, lineWidth, path };
    }

    case CommandIndex.OutlineFillPolygon: {
      // For outline commands, the count is u6 and sec_style_kind is u2
      const countByte = reader.readByte();
      const pointCount = (countByte & 0x3f) + 1;
      const secStyleKind: StyleType = (countByte >> 6) & 0x03;
      const fillStyle = readStyle(reader, primStyleKind, scale, coordinateRange);
      const lineStyle = readStyle(reader, secStyleKind, scale, coordinateRange);
      const lineWidth = reader.readUnit(scale, coordinateRange);
      const points: Point[] = [];
      for (let i = 0; i < pointCount; i++) {
        points.push(reader.readPoint(scale, coordinateRange));
      }
      return {
        command: CommandIndex.OutlineFillPolygon,
        fillStyle,
        lineStyle,
        lineWidth,
        points,
      };
    }

    case CommandIndex.OutlineFillRectangles: {
      const countByte = reader.readByte();
      const rectangleCount = (countByte & 0x3f) + 1;
      const secStyleKind: StyleType = (countByte >> 6) & 0x03;
      const fillStyle = readStyle(reader, primStyleKind, scale, coordinateRange);
      const lineStyle = readStyle(reader, secStyleKind, scale, coordinateRange);
      const lineWidth = reader.readUnit(scale, coordinateRange);
      const rectangles: Rectangle[] = [];
      for (let i = 0; i < rectangleCount; i++) {
        rectangles.push(reader.readRectangle(scale, coordinateRange));
      }
      return {
        command: CommandIndex.OutlineFillRectangles,
        fillStyle,
        lineStyle,
        lineWidth,
        rectangles,
      };
    }

    case CommandIndex.OutlineFillPath: {
      const countByte = reader.readByte();
      const segmentCount = (countByte & 0x3f) + 1;
      const secStyleKind: StyleType = (countByte >> 6) & 0x03;
      const fillStyle = readStyle(reader, primStyleKind, scale, coordinateRange);
      const lineStyle = readStyle(reader, secStyleKind, scale, coordinateRange);
      const lineWidth = reader.readUnit(scale, coordinateRange);
      const path = readPath(reader, segmentCount, scale, coordinateRange);
      return {
        command: CommandIndex.OutlineFillPath,
        fillStyle,
        lineStyle,
        lineWidth,
        path,
      };
    }

    case CommandIndex.TextHint: {
      const center = reader.readPoint(scale, coordinateRange);
      const rotation = reader.readUnit(scale, coordinateRange);
      const height = reader.readUnit(scale, coordinateRange);
      const textLength = reader.readVarUInt();
      const textBytes = reader.readBytes(textLength);
      const text = new TextDecoder().decode(textBytes);
      const glyphLength = reader.readVarUInt();
      const glyphOffsets: Array<[number, number]> = [];
      for (let i = 0; i < glyphLength; i++) {
        const start = reader.readUnit(scale, coordinateRange);
        const end = reader.readUnit(scale, coordinateRange);
        glyphOffsets.push([start, end]);
      }
      return {
        command: CommandIndex.TextHint,
        center,
        rotation,
        height,
        text,
        glyphOffsets,
      };
    }

    default:
      throw new ParseError(`Unknown command index: ${commandIndex}`);
  }
}
