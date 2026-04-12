/**
 * TinyVG binary serializer - converts a TinyVGDocument into .tvg binary format
 * Based on the TinyVG specification v1.0
 */

import {
  ColorEncoding,
  CoordinateRange,
  CommandIndex,
  StyleType,
  PathSegmentType,
  type RGBA,
  type Style,
  type Path,
  type TVGCommand,
  type TinyVGDocument,
} from "./types";

class BinaryWriter {
  private chunks: number[] = [];

  get length(): number {
    return this.chunks.length;
  }

  writeByte(value: number): void {
    this.chunks.push(value & 0xff);
  }

  writeUint8(value: number): void {
    this.writeByte(value);
  }

  writeUint16LE(value: number): void {
    this.chunks.push(value & 0xff);
    this.chunks.push((value >> 8) & 0xff);
  }

  writeUint32LE(value: number): void {
    this.chunks.push(value & 0xff);
    this.chunks.push((value >> 8) & 0xff);
    this.chunks.push((value >> 16) & 0xff);
    this.chunks.push((value >> 24) & 0xff);
  }

  writeFloat32LE(value: number): void {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < 4; i++) {
      this.chunks.push(bytes[i]);
    }
  }

  writeVarUInt(value: number): void {
    value = value >>> 0;
    while (value > 0x7f) {
      this.chunks.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    this.chunks.push(value & 0x7f);
  }

  writeUnit(value: number, scale: number, coordinateRange: CoordinateRange): void {
    const raw = Math.round(value * (1 << scale));
    switch (coordinateRange) {
      case CoordinateRange.Reduced:
        this.writeUint8(raw & 0xff);
        break;
      case CoordinateRange.Default:
        this.writeUint16LE(raw & 0xffff);
        break;
      case CoordinateRange.Enhanced:
        this.writeUint32LE(raw >>> 0);
        break;
    }
  }

  writePoint(x: number, y: number, scale: number, coordinateRange: CoordinateRange): void {
    this.writeUnit(x, scale, coordinateRange);
    this.writeUnit(y, scale, coordinateRange);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

export function serializeTinyVG(doc: TinyVGDocument): Uint8Array {
  const writer = new BinaryWriter();
  const { header, colorTable, commands } = doc;
  const { scale, colorEncoding, coordinateRange } = header;

  // Magic bytes
  writer.writeByte(0x72);
  writer.writeByte(0x56);

  // Version
  writer.writeByte(1);

  // Flags byte: scale(4) | colorEncoding(2) | coordinateRange(2)
  const flagsByte = (scale & 0x0f) | ((colorEncoding & 0x03) << 4) | ((coordinateRange & 0x03) << 6);
  writer.writeByte(flagsByte);

  // Width and height
  switch (coordinateRange) {
    case CoordinateRange.Reduced:
      writer.writeUint8(header.width);
      writer.writeUint8(header.height);
      break;
    case CoordinateRange.Default:
      writer.writeUint16LE(header.width);
      writer.writeUint16LE(header.height);
      break;
    case CoordinateRange.Enhanced:
      writer.writeUint32LE(header.width);
      writer.writeUint32LE(header.height);
      break;
  }

  // Color count
  writer.writeVarUInt(colorTable.length);

  // Color table
  for (const color of colorTable) {
    writeColor(writer, color, colorEncoding);
  }

  // Commands
  for (const cmd of commands) {
    writeCommand(writer, cmd, scale, coordinateRange);
  }

  // End of document
  writer.writeByte(0x00);

  return writer.toUint8Array();
}

function writeColor(writer: BinaryWriter, color: RGBA, encoding: ColorEncoding): void {
  switch (encoding) {
    case ColorEncoding.RGBA8888:
      writer.writeUint8(Math.round(color.r * 255));
      writer.writeUint8(Math.round(color.g * 255));
      writer.writeUint8(Math.round(color.b * 255));
      writer.writeUint8(Math.round(color.a * 255));
      break;
    case ColorEncoding.RGB565: {
      const r5 = Math.round(color.r * 31);
      const g6 = Math.round(color.g * 63);
      const b5 = Math.round(color.b * 31);
      const raw = r5 | (g6 << 5) | (b5 << 11);
      writer.writeUint8(raw & 0xff);
      writer.writeUint8((raw >> 8) & 0xff);
      break;
    }
    case ColorEncoding.RGBAF32:
      writer.writeFloat32LE(color.r);
      writer.writeFloat32LE(color.g);
      writer.writeFloat32LE(color.b);
      writer.writeFloat32LE(color.a);
      break;
  }
}

function writeStyle(writer: BinaryWriter, style: Style, scale: number, coordinateRange: CoordinateRange): void {
  switch (style.type) {
    case StyleType.Flat:
      writer.writeVarUInt(style.colorIndex);
      break;
    case StyleType.LinearGradient:
    case StyleType.RadialGradient:
      writer.writePoint(style.point1.x, style.point1.y, scale, coordinateRange);
      writer.writePoint(style.point2.x, style.point2.y, scale, coordinateRange);
      writer.writeVarUInt(style.colorIndex1);
      writer.writeVarUInt(style.colorIndex2);
      break;
  }
}

function writePath(writer: BinaryWriter, path: Path, scale: number, coordinateRange: CoordinateRange): void {
  writer.writePoint(path.origin.x, path.origin.y, scale, coordinateRange);

  for (const seg of path.segments) {
    let segByte = seg.type & 0x07;
    if (seg.lineWidthChange !== null) {
      segByte |= 0x08;
    }
    writer.writeByte(segByte);

    if (seg.lineWidthChange !== null) {
      writer.writeUnit(seg.lineWidthChange, scale, coordinateRange);
    }

    switch (seg.type) {
      case PathSegmentType.Line:
        writer.writePoint(seg.end.x, seg.end.y, scale, coordinateRange);
        break;
      case PathSegmentType.HorizontalLine:
        writer.writeUnit(seg.x, scale, coordinateRange);
        break;
      case PathSegmentType.VerticalLine:
        writer.writeUnit(seg.y, scale, coordinateRange);
        break;
      case PathSegmentType.CubicBezier:
        writer.writePoint(seg.control1.x, seg.control1.y, scale, coordinateRange);
        writer.writePoint(seg.control2.x, seg.control2.y, scale, coordinateRange);
        writer.writePoint(seg.end.x, seg.end.y, scale, coordinateRange);
        break;
      case PathSegmentType.QuadraticBezier:
        writer.writePoint(seg.control.x, seg.control.y, scale, coordinateRange);
        writer.writePoint(seg.end.x, seg.end.y, scale, coordinateRange);
        break;
      case PathSegmentType.ArcCircle:
        writer.writeUnit(seg.radius, scale, coordinateRange);
        writer.writeByte((seg.largeArc ? 1 : 0) | (seg.sweep ? 2 : 0));
        writer.writePoint(seg.end.x, seg.end.y, scale, coordinateRange);
        break;
      case PathSegmentType.ArcEllipse:
        writer.writeUnit(seg.radiusX, scale, coordinateRange);
        writer.writeUnit(seg.radiusY, scale, coordinateRange);
        writer.writeUnit(seg.angle, scale, coordinateRange);
        writer.writeByte((seg.largeArc ? 1 : 0) | (seg.sweep ? 2 : 0));
        writer.writePoint(seg.end.x, seg.end.y, scale, coordinateRange);
        break;
      case PathSegmentType.ClosePath:
        break;
    }
  }
}

function writeCommand(writer: BinaryWriter, cmd: TVGCommand, scale: number, coordinateRange: CoordinateRange): void {
  const getPrimStyleKind = (style: Style): number => style.type & 0x03;

  switch (cmd.command) {
    case CommandIndex.FillPolygon: {
      writer.writeByte(cmd.command | (getPrimStyleKind(cmd.fillStyle) << 6));
      writer.writeVarUInt(cmd.points.length - 1);
      writeStyle(writer, cmd.fillStyle, scale, coordinateRange);
      for (const p of cmd.points) {
        writer.writePoint(p.x, p.y, scale, coordinateRange);
      }
      break;
    }

    case CommandIndex.FillRectangles: {
      writer.writeByte(cmd.command | (getPrimStyleKind(cmd.fillStyle) << 6));
      writer.writeVarUInt(cmd.rectangles.length - 1);
      writeStyle(writer, cmd.fillStyle, scale, coordinateRange);
      for (const r of cmd.rectangles) {
        writer.writeUnit(r.x, scale, coordinateRange);
        writer.writeUnit(r.y, scale, coordinateRange);
        writer.writeUnit(r.width, scale, coordinateRange);
        writer.writeUnit(r.height, scale, coordinateRange);
      }
      break;
    }

    case CommandIndex.FillPath: {
      writer.writeByte(cmd.command | (getPrimStyleKind(cmd.fillStyle) << 6));
      writer.writeVarUInt(cmd.path.segments.length - 1);
      writeStyle(writer, cmd.fillStyle, scale, coordinateRange);
      writePath(writer, cmd.path, scale, coordinateRange);
      break;
    }

    case CommandIndex.DrawLines: {
      writer.writeByte(cmd.command | (getPrimStyleKind(cmd.lineStyle) << 6));
      writer.writeVarUInt(cmd.lines.length - 1);
      writeStyle(writer, cmd.lineStyle, scale, coordinateRange);
      writer.writeUnit(cmd.lineWidth, scale, coordinateRange);
      for (const l of cmd.lines) {
        writer.writePoint(l.start.x, l.start.y, scale, coordinateRange);
        writer.writePoint(l.end.x, l.end.y, scale, coordinateRange);
      }
      break;
    }

    case CommandIndex.DrawLineLoop:
    case CommandIndex.DrawLineStrip: {
      writer.writeByte(cmd.command | (getPrimStyleKind(cmd.lineStyle) << 6));
      writer.writeVarUInt(cmd.points.length - 1);
      writeStyle(writer, cmd.lineStyle, scale, coordinateRange);
      writer.writeUnit(cmd.lineWidth, scale, coordinateRange);
      for (const p of cmd.points) {
        writer.writePoint(p.x, p.y, scale, coordinateRange);
      }
      break;
    }

    case CommandIndex.DrawLinePath: {
      writer.writeByte(cmd.command | (getPrimStyleKind(cmd.lineStyle) << 6));
      writer.writeVarUInt(cmd.path.segments.length - 1);
      writeStyle(writer, cmd.lineStyle, scale, coordinateRange);
      writer.writeUnit(cmd.lineWidth, scale, coordinateRange);
      writePath(writer, cmd.path, scale, coordinateRange);
      break;
    }

    case CommandIndex.OutlineFillPolygon: {
      writer.writeByte(cmd.command | (getPrimStyleKind(cmd.fillStyle) << 6));
      const countByte = ((cmd.points.length - 1) & 0x3f) | ((getPrimStyleKind(cmd.lineStyle) & 0x03) << 6);
      writer.writeByte(countByte);
      writeStyle(writer, cmd.fillStyle, scale, coordinateRange);
      writeStyle(writer, cmd.lineStyle, scale, coordinateRange);
      writer.writeUnit(cmd.lineWidth, scale, coordinateRange);
      for (const p of cmd.points) {
        writer.writePoint(p.x, p.y, scale, coordinateRange);
      }
      break;
    }

    case CommandIndex.OutlineFillRectangles: {
      writer.writeByte(cmd.command | (getPrimStyleKind(cmd.fillStyle) << 6));
      const countByte = ((cmd.rectangles.length - 1) & 0x3f) | ((getPrimStyleKind(cmd.lineStyle) & 0x03) << 6);
      writer.writeByte(countByte);
      writeStyle(writer, cmd.fillStyle, scale, coordinateRange);
      writeStyle(writer, cmd.lineStyle, scale, coordinateRange);
      writer.writeUnit(cmd.lineWidth, scale, coordinateRange);
      for (const r of cmd.rectangles) {
        writer.writeUnit(r.x, scale, coordinateRange);
        writer.writeUnit(r.y, scale, coordinateRange);
        writer.writeUnit(r.width, scale, coordinateRange);
        writer.writeUnit(r.height, scale, coordinateRange);
      }
      break;
    }

    case CommandIndex.OutlineFillPath: {
      writer.writeByte(cmd.command | (getPrimStyleKind(cmd.fillStyle) << 6));
      const countByte = ((cmd.path.segments.length - 1) & 0x3f) | ((getPrimStyleKind(cmd.lineStyle) & 0x03) << 6);
      writer.writeByte(countByte);
      writeStyle(writer, cmd.fillStyle, scale, coordinateRange);
      writeStyle(writer, cmd.lineStyle, scale, coordinateRange);
      writer.writeUnit(cmd.lineWidth, scale, coordinateRange);
      writePath(writer, cmd.path, scale, coordinateRange);
      break;
    }

    case CommandIndex.TextHint: {
      writer.writeByte(cmd.command);
      writer.writePoint(cmd.center.x, cmd.center.y, scale, coordinateRange);
      writer.writeUnit(cmd.rotation, scale, coordinateRange);
      writer.writeUnit(cmd.height, scale, coordinateRange);
      const textBytes = new TextEncoder().encode(cmd.text);
      writer.writeVarUInt(textBytes.length);
      for (const b of textBytes) {
        writer.writeByte(b);
      }
      writer.writeVarUInt(cmd.glyphOffsets.length);
      for (const [start, end] of cmd.glyphOffsets) {
        writer.writeUnit(start, scale, coordinateRange);
        writer.writeUnit(end, scale, coordinateRange);
      }
      break;
    }
  }
}
