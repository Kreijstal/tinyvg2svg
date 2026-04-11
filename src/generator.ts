/**
 * SVG generator - converts a parsed TinyVG document into SVG markup
 */

import {
  StyleType,
  PathSegmentType,
  CommandIndex,
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
  type TVGCommand,
  type TinyVGDocument,
} from "./types";

let gradientCounter = 0;

/**
 * Converts an RGBA color to a CSS color string
 */
function rgbaToCSS(color: RGBA): string {
  const r = Math.round(Math.min(1, Math.max(0, color.r)) * 255);
  const g = Math.round(Math.min(1, Math.max(0, color.g)) * 255);
  const b = Math.round(Math.min(1, Math.max(0, color.b)) * 255);
  const a = Math.min(1, Math.max(0, color.a));

  if (a < 1) {
    return `rgba(${r},${g},${b},${a.toFixed(4)})`;
  }
  return `rgb(${r},${g},${b})`;
}

/**
 * Resolves a style to SVG attributes, returning fill/stroke and any defs needed
 */
function resolveStyle(
  style: Style,
  colorTable: RGBA[],
  mode: "fill" | "stroke",
  defs: string[]
): string {
  switch (style.type) {
    case StyleType.Flat: {
      const color = colorTable[style.colorIndex];
      if (!color) {
        throw new Error(`Color index ${style.colorIndex} out of range`);
      }
      return mode === "fill" ? `fill="${rgbaToCSS(color)}"` : `stroke="${rgbaToCSS(color)}"`;
    }

    case StyleType.LinearGradient: {
      const gradId = `grad_${gradientCounter++}`;
      const c1 = colorTable[style.colorIndex1];
      const c2 = colorTable[style.colorIndex2];
      if (!c1 || !c2) {
        throw new Error("Gradient color index out of range");
      }

      defs.push(
        `<linearGradient id="${gradId}" x1="${style.point1.x}" y1="${style.point1.y}" x2="${style.point2.x}" y2="${style.point2.y}" gradientUnits="userSpaceOnUse">` +
          `<stop offset="0%" stop-color="${rgbaToCSS(c1)}" />` +
          `<stop offset="100%" stop-color="${rgbaToCSS(c2)}" />` +
          `</linearGradient>`
      );

      return mode === "fill" ? `fill="url(#${gradId})"` : `stroke="url(#${gradId})"`;
    }

    case StyleType.RadialGradient: {
      const gradId = `grad_${gradientCounter++}`;
      const c1 = colorTable[style.colorIndex1];
      const c2 = colorTable[style.colorIndex2];
      if (!c1 || !c2) {
        throw new Error("Gradient color index out of range");
      }

      const dx = style.point2.x - style.point1.x;
      const dy = style.point2.y - style.point1.y;
      const r = Math.sqrt(dx * dx + dy * dy);

      defs.push(
        `<radialGradient id="${gradId}" cx="${style.point1.x}" cy="${style.point1.y}" r="${r.toFixed(4)}" gradientUnits="userSpaceOnUse">` +
          `<stop offset="0%" stop-color="${rgbaToCSS(c1)}" />` +
          `<stop offset="100%" stop-color="${rgbaToCSS(c2)}" />` +
          `</radialGradient>`
      );

      return mode === "fill" ? `fill="url(#${gradId})"` : `stroke="url(#${gradId})"`;
    }

    default:
      throw new Error(`Unknown style type: ${(style as any).type}`);
  }
}

/**
 * Converts a Path to an SVG path d attribute string
 */
function pathToSVGPathD(path: Path): string {
  let d = `M ${path.origin.x} ${path.origin.y}`;
  let currentX = path.origin.x;
  let currentY = path.origin.y;

  for (const segment of path.segments) {
    // Track line width changes (currently ignored in SVG output, but tracked for future use)
    // const lwChange = segment.lineWidthChange;

    switch (segment.type) {
      case PathSegmentType.Line:
        d += ` L ${segment.end.x} ${segment.end.y}`;
        currentX = segment.end.x;
        currentY = segment.end.y;
        break;

      case PathSegmentType.HorizontalLine:
        d += ` L ${segment.x} ${currentY}`;
        currentX = segment.x;
        break;

      case PathSegmentType.VerticalLine:
        d += ` L ${currentX} ${segment.y}`;
        currentY = segment.y;
        break;

      case PathSegmentType.CubicBezier:
        d += ` C ${segment.control1.x} ${segment.control1.y}, ${segment.control2.x} ${segment.control2.y}, ${segment.end.x} ${segment.end.y}`;
        currentX = segment.end.x;
        currentY = segment.end.y;
        break;

      case PathSegmentType.QuadraticBezier:
        d += ` Q ${segment.control.x} ${segment.control.y}, ${segment.end.x} ${segment.end.y}`;
        currentX = segment.end.x;
        currentY = segment.end.y;
        break;

      case PathSegmentType.ArcCircle: {
        const r = Math.abs(segment.radius);
        const la = segment.largeArc ? 1 : 0;
        const sw = segment.sweep ? 1 : 0;
        d += ` A ${r} ${r} 0 ${la} ${sw} ${segment.end.x} ${segment.end.y}`;
        currentX = segment.end.x;
        currentY = segment.end.y;
        break;
      }

      case PathSegmentType.ArcEllipse: {
        const la = segment.largeArc ? 1 : 0;
        const sw = segment.sweep ? 1 : 0;
        // Convert angle from degrees to the x-axis-rotation parameter
        const angleDeg = segment.angle;
        d += ` A ${Math.abs(segment.radiusX)} ${Math.abs(segment.radiusY)} ${angleDeg} ${la} ${sw} ${segment.end.x} ${segment.end.y}`;
        currentX = segment.end.x;
        currentY = segment.end.y;
        break;
      }

      case PathSegmentType.ClosePath:
        d += " Z";
        currentX = path.origin.x;
        currentY = path.origin.y;
        break;

      default:
        throw new Error(`Unknown path segment type: ${(segment as any).type}`);
    }
  }

  return d;
}

/**
 * Generates SVG markup from a TinyVG document
 */
export function generateSVG(doc: TinyVGDocument, pretty: boolean = true): string {
  gradientCounter = 0;

  const { header, colorTable, commands } = doc;
  const { width, height } = header;

  const defs: string[] = [];
  const elements: string[] = [];

  const nl = pretty ? "\n" : "";
  const indent = pretty ? "  " : "";

  for (const cmd of commands) {
    const elem = generateCommandElement(cmd, colorTable, defs, indent);
    if (elem) {
      elements.push(elem);
    }
  }

  let svg = `<?xml version="1.0" encoding="UTF-8"?>${nl}`;
  svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${nl}`;

  if (defs.length > 0) {
    svg += `${indent}<defs>${nl}`;
    for (const def of defs) {
      svg += `${indent}${indent}${def}${nl}`;
    }
    svg += `${indent}</defs>${nl}`;
  }

  for (const elem of elements) {
    svg += `${indent}${elem}${nl}`;
  }

  svg += `</svg>`;

  return svg;
}

/**
 * Generates SVG element(s) for a single TinyVG command
 */
function generateCommandElement(
  cmd: TVGCommand,
  colorTable: RGBA[],
  defs: string[],
  indent: string
): string | null {
  switch (cmd.command) {
    case CommandIndex.FillPolygon: {
      const pointsStr = cmd.points.map((p) => `${p.x},${p.y}`).join(" ");
      const fillAttr = resolveStyle(cmd.fillStyle, colorTable, "fill", defs);
      return `<polygon points="${pointsStr}" ${fillAttr} stroke="none" fill-rule="evenodd" />`;
    }

    case CommandIndex.FillRectangles: {
      const parts: string[] = [];
      const fillAttr = resolveStyle(cmd.fillStyle, colorTable, "fill", defs);
      for (const rect of cmd.rectangles) {
        parts.push(
          `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" ${fillAttr} stroke="none" />`
        );
      }
      return parts.join("\n" + indent);
    }

    case CommandIndex.FillPath: {
      const d = pathToSVGPathD(cmd.path);
      const fillAttr = resolveStyle(cmd.fillStyle, colorTable, "fill", defs);
      return `<path d="${d}" ${fillAttr} stroke="none" fill-rule="evenodd" />`;
    }

    case CommandIndex.DrawLines: {
      const parts: string[] = [];
      const strokeAttr = resolveStyle(cmd.lineStyle, colorTable, "stroke", defs);
      const lw = Math.max(cmd.lineWidth, 0.5);
      for (const line of cmd.lines) {
        parts.push(
          `<line x1="${line.start.x}" y1="${line.start.y}" x2="${line.end.x}" y2="${line.end.y}" ${strokeAttr} stroke-width="${lw}" stroke-linecap="round" fill="none" />`
        );
      }
      return parts.join("\n" + indent);
    }

    case CommandIndex.DrawLineLoop: {
      const d = cmd.points
        .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
        .join(" ") + " Z";
      const strokeAttr = resolveStyle(cmd.lineStyle, colorTable, "stroke", defs);
      const lw = Math.max(cmd.lineWidth, 0.5);
      return `<path d="${d}" ${strokeAttr} stroke-width="${lw}" stroke-linejoin="round" stroke-linecap="round" fill="none" />`;
    }

    case CommandIndex.DrawLineStrip: {
      const d = cmd.points
        .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
        .join(" ");
      const strokeAttr = resolveStyle(cmd.lineStyle, colorTable, "stroke", defs);
      const lw = Math.max(cmd.lineWidth, 0.5);
      return `<path d="${d}" ${strokeAttr} stroke-width="${lw}" stroke-linejoin="round" stroke-linecap="round" fill="none" />`;
    }

    case CommandIndex.DrawLinePath: {
      const d = pathToSVGPathD(cmd.path);
      const strokeAttr = resolveStyle(cmd.lineStyle, colorTable, "stroke", defs);
      const lw = Math.max(cmd.lineWidth, 0.5);
      return `<path d="${d}" ${strokeAttr} stroke-width="${lw}" stroke-linejoin="round" stroke-linecap="round" fill="none" />`;
    }

    case CommandIndex.OutlineFillPolygon: {
      const pointsStr = cmd.points.map((p) => `${p.x},${p.y}`).join(" ");
      const fillAttr = resolveStyle(cmd.fillStyle, colorTable, "fill", defs);
      const strokeAttr = resolveStyle(cmd.lineStyle, colorTable, "stroke", defs);
      const lw = Math.max(cmd.lineWidth, 0.5);
      return `<polygon points="${pointsStr}" ${fillAttr} ${strokeAttr} stroke-width="${lw}" stroke-linejoin="round" fill-rule="evenodd" />`;
    }

    case CommandIndex.OutlineFillRectangles: {
      const parts: string[] = [];
      const fillAttr = resolveStyle(cmd.fillStyle, colorTable, "fill", defs);
      const strokeAttr = resolveStyle(cmd.lineStyle, colorTable, "stroke", defs);
      const lw = Math.max(cmd.lineWidth, 0.5);
      for (const rect of cmd.rectangles) {
        parts.push(
          `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" ${fillAttr} ${strokeAttr} stroke-width="${lw}" />`
        );
      }
      return parts.join("\n" + indent);
    }

    case CommandIndex.OutlineFillPath: {
      const d = pathToSVGPathD(cmd.path);
      const fillAttr = resolveStyle(cmd.fillStyle, colorTable, "fill", defs);
      const strokeAttr = resolveStyle(cmd.lineStyle, colorTable, "stroke", defs);
      const lw = Math.max(cmd.lineWidth, 0.5);
      return `<path d="${d}" ${fillAttr} ${strokeAttr} stroke-width="${lw}" stroke-linejoin="round" fill-rule="evenodd" />`;
    }

    case CommandIndex.TextHint: {
      // Text hints are metadata only and don't affect rendering
      // We can optionally include them as SVG text elements for accessibility
      const angle = cmd.rotation;
      const transform = angle !== 0 ? ` transform="rotate(${angle} ${cmd.center.x} ${cmd.center.y})"` : "";
      return `<text x="${cmd.center.x}" y="${cmd.center.y}" font-size="${cmd.height}" text-anchor="middle" dominant-baseline="central"${transform} fill="none" stroke="none" aria-label="${escapeXML(cmd.text)}">${escapeXML(cmd.text)}</text>`;
    }

    default:
      console.warn(`Unknown command: ${(cmd as any).command}`);
      return null;
  }
}

/**
 * Escapes special XML characters
 */
function escapeXML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
