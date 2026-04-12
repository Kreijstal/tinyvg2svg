/**
 * SVG to TinyVG converter - parses SVG and produces a TinyVGDocument
 * Handles common SVG elements: rect, circle, ellipse, line, polyline, polygon, path
 */

import {
  ColorEncoding,
  CoordinateRange,
  CommandIndex,
  StyleType,
  PathSegmentType,
  type RGBA,
  type Point,
  type Style,
  type FlatStyle,
  type Path,
  type PathSegment,
  type TVGCommand,
  type TinyVGDocument,
  type TinyVGHeader,
} from "./types";

interface ColorMap {
  colors: RGBA[];
  index: Map<string, number>;
}

function colorKey(c: RGBA): string {
  return `${c.r.toFixed(6)},${c.g.toFixed(6)},${c.b.toFixed(6)},${c.a.toFixed(6)}`;
}

function getOrAddColor(map: ColorMap, color: RGBA): number {
  const key = colorKey(color);
  const existing = map.index.get(key);
  if (existing !== undefined) return existing;
  const idx = map.colors.length;
  map.colors.push(color);
  map.index.set(key, idx);
  return idx;
}

function parseColor(str: string | null, opacity: number = 1): RGBA | null {
  if (!str || str === "none" || str === "transparent") return null;

  str = str.trim();

  // Named colors
  const named: Record<string, [number, number, number]> = {
    black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0],
    green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0],
    cyan: [0, 255, 255], magenta: [255, 0, 255], gray: [128, 128, 128],
    grey: [128, 128, 128], orange: [255, 165, 0], purple: [128, 0, 128],
    pink: [255, 192, 203], lime: [0, 255, 0], navy: [0, 0, 128],
    teal: [0, 128, 128], maroon: [128, 0, 0], olive: [128, 128, 0],
    silver: [192, 192, 192], aqua: [0, 255, 255], fuchsia: [255, 0, 255],
    coral: [255, 127, 80], gold: [255, 215, 0], indigo: [75, 0, 130],
    ivory: [255, 255, 240], khaki: [240, 230, 140], lavender: [230, 230, 250],
    linen: [250, 240, 230], peru: [205, 133, 63], plum: [221, 160, 221],
    salmon: [250, 128, 114], sienna: [160, 82, 45], tan: [210, 180, 140],
    thistle: [216, 191, 216], tomato: [255, 99, 71], violet: [238, 130, 238],
    wheat: [245, 222, 179], crimson: [220, 20, 60], darkblue: [0, 0, 139],
    darkgreen: [0, 100, 0], darkred: [139, 0, 0], lightblue: [173, 216, 230],
    lightgreen: [144, 238, 144], lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
    darkgray: [169, 169, 169], darkgrey: [169, 169, 169],
  };

  const lower = str.toLowerCase();
  if (named[lower]) {
    const [r, g, b] = named[lower];
    return { r: r / 255, g: g / 255, b: b / 255, a: opacity };
  }

  // #RGB, #RRGGBB, #RRGGBBAA
  if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r: r / 255, g: g / 255, b: b / 255, a: opacity };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r: r / 255, g: g / 255, b: b / 255, a: opacity };
    }
    if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16);
      return { r: r / 255, g: g / 255, b: b / 255, a: (a / 255) * opacity };
    }
  }

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = str.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)/);
  if (rgbMatch) {
    const r = parseFloat(rgbMatch[1]);
    const g = parseFloat(rgbMatch[2]);
    const b = parseFloat(rgbMatch[3]);
    const a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    return { r: r / 255, g: g / 255, b: b / 255, a: a * opacity };
  }

  return null;
}

function getAttr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

function getNumAttr(el: Element, name: string, def: number = 0): number {
  const val = el.getAttribute(name);
  if (val === null) return def;
  const n = parseFloat(val);
  return isNaN(n) ? def : n;
}

function getStyleColor(el: Element, attr: "fill" | "stroke", colorMap: ColorMap): { style: Style; hasColor: boolean } {
  const colorStr = getAttr(el, attr) || (attr === "fill" ? "black" : null);
  const opacityStr = getAttr(el, attr + "-opacity") || getAttr(el, "opacity");
  const opacity = opacityStr ? parseFloat(opacityStr) : 1;

  const color = parseColor(colorStr, opacity);
  if (!color) {
    return { style: { type: StyleType.Flat, colorIndex: 0 } as FlatStyle, hasColor: false };
  }

  const idx = getOrAddColor(colorMap, color);
  return { style: { type: StyleType.Flat, colorIndex: idx } as FlatStyle, hasColor: true };
}

/**
 * Parse an SVG path `d` attribute into TinyVG path segments.
 */
function parseSVGPathD(d: string): { origin: Point; segments: PathSegment[] } | null {
  const tokens: string[] = [];
  // Tokenize: split on commands and numbers
  const re = /([MmZzLlHhVvCcSsQqTtAa])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    tokens.push(m[0]);
  }

  if (tokens.length === 0) return null;

  let i = 0;
  const next = (): number => {
    if (i >= tokens.length) return 0;
    return parseFloat(tokens[i++]);
  };

  let curX = 0, curY = 0;
  let startX = 0, startY = 0;
  let origin: Point | null = null;
  const segments: PathSegment[] = [];

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (/^[A-Za-z]$/.test(cmd)) {
      i++;
    } else {
      // Implicit lineto after moveto
      break;
    }

    const isRel = cmd === cmd.toLowerCase();

    const processCommand = () => {
      switch (cmd.toUpperCase()) {
        case "M": {
          const x = next();
          const y = next();
          curX = isRel ? curX + x : x;
          curY = isRel ? curY + y : y;
          startX = curX;
          startY = curY;
          if (!origin) {
            origin = { x: curX, y: curY };
          } else {
            segments.push({ type: PathSegmentType.Line, lineWidthChange: null, end: { x: curX, y: curY } });
          }
          // Subsequent coordinates are implicit lineto
          while (i < tokens.length && /^[+-]?[\d.]/.test(tokens[i])) {
            const lx = next();
            const ly = next();
            curX = isRel ? curX + lx : lx;
            curY = isRel ? curY + ly : ly;
            segments.push({ type: PathSegmentType.Line, lineWidthChange: null, end: { x: curX, y: curY } });
          }
          break;
        }
        case "L": {
          do {
            const x = next();
            const y = next();
            curX = isRel ? curX + x : x;
            curY = isRel ? curY + y : y;
            segments.push({ type: PathSegmentType.Line, lineWidthChange: null, end: { x: curX, y: curY } });
          } while (i < tokens.length && /^[+-]?[\d.]/.test(tokens[i]));
          break;
        }
        case "H": {
          do {
            const x = next();
            curX = isRel ? curX + x : x;
            segments.push({ type: PathSegmentType.HorizontalLine, lineWidthChange: null, x: curX });
          } while (i < tokens.length && /^[+-]?[\d.]/.test(tokens[i]));
          break;
        }
        case "V": {
          do {
            const y = next();
            curY = isRel ? curY + y : y;
            segments.push({ type: PathSegmentType.VerticalLine, lineWidthChange: null, y: curY });
          } while (i < tokens.length && /^[+-]?[\d.]/.test(tokens[i]));
          break;
        }
        case "C": {
          do {
            const x1 = next(), y1 = next();
            const x2 = next(), y2 = next();
            const x = next(), y = next();
            const ax1 = isRel ? curX + x1 : x1;
            const ay1 = isRel ? curY + y1 : y1;
            const ax2 = isRel ? curX + x2 : x2;
            const ay2 = isRel ? curY + y2 : y2;
            curX = isRel ? curX + x : x;
            curY = isRel ? curY + y : y;
            segments.push({
              type: PathSegmentType.CubicBezier, lineWidthChange: null,
              control1: { x: ax1, y: ay1 }, control2: { x: ax2, y: ay2 }, end: { x: curX, y: curY },
            });
          } while (i < tokens.length && /^[+-]?[\d.]/.test(tokens[i]));
          break;
        }
        case "Q": {
          do {
            const x1 = next(), y1 = next();
            const x = next(), y = next();
            const ax1 = isRel ? curX + x1 : x1;
            const ay1 = isRel ? curY + y1 : y1;
            curX = isRel ? curX + x : x;
            curY = isRel ? curY + y : y;
            segments.push({
              type: PathSegmentType.QuadraticBezier, lineWidthChange: null,
              control: { x: ax1, y: ay1 }, end: { x: curX, y: curY },
            });
          } while (i < tokens.length && /^[+-]?[\d.]/.test(tokens[i]));
          break;
        }
        case "A": {
          do {
            const rx = next(), ry = next();
            const angle = next();
            const largeArc = next() !== 0;
            const sweep = next() !== 0;
            const x = next(), y = next();
            curX = isRel ? curX + x : x;
            curY = isRel ? curY + y : y;
            if (Math.abs(rx - ry) < 0.001) {
              segments.push({
                type: PathSegmentType.ArcCircle, lineWidthChange: null,
                radius: rx, largeArc, sweep, end: { x: curX, y: curY },
              });
            } else {
              segments.push({
                type: PathSegmentType.ArcEllipse, lineWidthChange: null,
                radiusX: rx, radiusY: ry, angle, largeArc, sweep, end: { x: curX, y: curY },
              });
            }
          } while (i < tokens.length && /^[+-]?[\d.]/.test(tokens[i]));
          break;
        }
        case "S": {
          // Smooth cubic - convert to regular cubic (no reflection tracking, use current point as control1)
          do {
            const x2 = next(), y2 = next();
            const x = next(), y = next();
            const ax2 = isRel ? curX + x2 : x2;
            const ay2 = isRel ? curY + y2 : y2;
            curX = isRel ? curX + x : x;
            curY = isRel ? curY + y : y;
            segments.push({
              type: PathSegmentType.CubicBezier, lineWidthChange: null,
              control1: { x: curX, y: curY }, control2: { x: ax2, y: ay2 }, end: { x: curX, y: curY },
            });
          } while (i < tokens.length && /^[+-]?[\d.]/.test(tokens[i]));
          break;
        }
        case "T": {
          // Smooth quadratic - approximate as line
          do {
            const x = next(), y = next();
            curX = isRel ? curX + x : x;
            curY = isRel ? curY + y : y;
            segments.push({ type: PathSegmentType.Line, lineWidthChange: null, end: { x: curX, y: curY } });
          } while (i < tokens.length && /^[+-]?[\d.]/.test(tokens[i]));
          break;
        }
        case "Z": {
          segments.push({ type: PathSegmentType.ClosePath, lineWidthChange: null });
          curX = startX;
          curY = startY;
          break;
        }
      }
    };

    processCommand();
  }

  if (!origin) return null;
  return { origin, segments };
}

function convertElement(el: Element, colorMap: ColorMap, commands: TVGCommand[]): void {
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "rect": {
      const x = getNumAttr(el, "x");
      const y = getNumAttr(el, "y");
      const w = getNumAttr(el, "width");
      const h = getNumAttr(el, "height");
      if (w <= 0 || h <= 0) break;

      const fill = getStyleColor(el, "fill", colorMap);
      const stroke = getStyleColor(el, "stroke", colorMap);
      const strokeWidth = getNumAttr(el, "stroke-width", 1);

      if (fill.hasColor && stroke.hasColor) {
        commands.push({
          command: CommandIndex.OutlineFillRectangles,
          fillStyle: fill.style,
          lineStyle: stroke.style,
          lineWidth: strokeWidth,
          rectangles: [{ x, y, width: w, height: h }],
        });
      } else if (fill.hasColor) {
        commands.push({
          command: CommandIndex.FillRectangles,
          fillStyle: fill.style,
          rectangles: [{ x, y, width: w, height: h }],
        });
      }
      break;
    }

    case "circle": {
      const cx = getNumAttr(el, "cx");
      const cy = getNumAttr(el, "cy");
      const r = getNumAttr(el, "r");
      if (r <= 0) break;

      // Approximate circle as a path with 2 arcs
      const path: Path = {
        origin: { x: cx - r, y: cy },
        segments: [
          { type: PathSegmentType.ArcCircle, lineWidthChange: null, radius: r, largeArc: true, sweep: true, end: { x: cx + r, y: cy } },
          { type: PathSegmentType.ArcCircle, lineWidthChange: null, radius: r, largeArc: true, sweep: true, end: { x: cx - r, y: cy } },
          { type: PathSegmentType.ClosePath, lineWidthChange: null },
        ],
      };

      const fill = getStyleColor(el, "fill", colorMap);
      const stroke = getStyleColor(el, "stroke", colorMap);
      const strokeWidth = getNumAttr(el, "stroke-width", 1);

      if (fill.hasColor && stroke.hasColor) {
        commands.push({ command: CommandIndex.OutlineFillPath, fillStyle: fill.style, lineStyle: stroke.style, lineWidth: strokeWidth, path });
      } else if (fill.hasColor) {
        commands.push({ command: CommandIndex.FillPath, fillStyle: fill.style, path });
      } else if (stroke.hasColor) {
        commands.push({ command: CommandIndex.DrawLinePath, lineStyle: stroke.style, lineWidth: strokeWidth, path });
      }
      break;
    }

    case "ellipse": {
      const cx = getNumAttr(el, "cx");
      const cy = getNumAttr(el, "cy");
      const rx = getNumAttr(el, "rx");
      const ry = getNumAttr(el, "ry");
      if (rx <= 0 || ry <= 0) break;

      const path: Path = {
        origin: { x: cx - rx, y: cy },
        segments: [
          { type: PathSegmentType.ArcEllipse, lineWidthChange: null, radiusX: rx, radiusY: ry, angle: 0, largeArc: true, sweep: true, end: { x: cx + rx, y: cy } },
          { type: PathSegmentType.ArcEllipse, lineWidthChange: null, radiusX: rx, radiusY: ry, angle: 0, largeArc: true, sweep: true, end: { x: cx - rx, y: cy } },
          { type: PathSegmentType.ClosePath, lineWidthChange: null },
        ],
      };

      const fill = getStyleColor(el, "fill", colorMap);
      const stroke = getStyleColor(el, "stroke", colorMap);
      const strokeWidth = getNumAttr(el, "stroke-width", 1);

      if (fill.hasColor && stroke.hasColor) {
        commands.push({ command: CommandIndex.OutlineFillPath, fillStyle: fill.style, lineStyle: stroke.style, lineWidth: strokeWidth, path });
      } else if (fill.hasColor) {
        commands.push({ command: CommandIndex.FillPath, fillStyle: fill.style, path });
      } else if (stroke.hasColor) {
        commands.push({ command: CommandIndex.DrawLinePath, lineStyle: stroke.style, lineWidth: strokeWidth, path });
      }
      break;
    }

    case "line": {
      const x1 = getNumAttr(el, "x1");
      const y1 = getNumAttr(el, "y1");
      const x2 = getNumAttr(el, "x2");
      const y2 = getNumAttr(el, "y2");

      const stroke = getStyleColor(el, "stroke", colorMap);
      const strokeWidth = getNumAttr(el, "stroke-width", 1);

      if (stroke.hasColor) {
        commands.push({
          command: CommandIndex.DrawLines,
          lineStyle: stroke.style,
          lineWidth: strokeWidth,
          lines: [{ start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }],
        });
      }
      break;
    }

    case "polyline": {
      const pointsStr = getAttr(el, "points");
      if (!pointsStr) break;
      const points = parsePointsList(pointsStr);
      if (points.length < 2) break;

      const stroke = getStyleColor(el, "stroke", colorMap);
      const strokeWidth = getNumAttr(el, "stroke-width", 1);

      if (stroke.hasColor) {
        commands.push({
          command: CommandIndex.DrawLineStrip,
          lineStyle: stroke.style,
          lineWidth: strokeWidth,
          points,
        });
      }
      break;
    }

    case "polygon": {
      const pointsStr = getAttr(el, "points");
      if (!pointsStr) break;
      const points = parsePointsList(pointsStr);
      if (points.length < 3) break;

      const fill = getStyleColor(el, "fill", colorMap);
      const stroke = getStyleColor(el, "stroke", colorMap);
      const strokeWidth = getNumAttr(el, "stroke-width", 1);

      if (fill.hasColor && stroke.hasColor) {
        commands.push({
          command: CommandIndex.OutlineFillPolygon,
          fillStyle: fill.style,
          lineStyle: stroke.style,
          lineWidth: strokeWidth,
          points,
        });
      } else if (fill.hasColor) {
        commands.push({ command: CommandIndex.FillPolygon, fillStyle: fill.style, points });
      }
      break;
    }

    case "path": {
      const d = getAttr(el, "d");
      if (!d) break;

      const parsed = parseSVGPathD(d);
      if (!parsed || parsed.segments.length === 0) break;

      const fill = getStyleColor(el, "fill", colorMap);
      const stroke = getStyleColor(el, "stroke", colorMap);
      const strokeWidth = getNumAttr(el, "stroke-width", 1);

      if (fill.hasColor && stroke.hasColor) {
        commands.push({ command: CommandIndex.OutlineFillPath, fillStyle: fill.style, lineStyle: stroke.style, lineWidth: strokeWidth, path: parsed });
      } else if (fill.hasColor) {
        commands.push({ command: CommandIndex.FillPath, fillStyle: fill.style, path: parsed });
      } else if (stroke.hasColor) {
        commands.push({ command: CommandIndex.DrawLinePath, lineStyle: stroke.style, lineWidth: strokeWidth, path: parsed });
      }
      break;
    }

    case "g":
    case "svg":
    case "defs":
    case "symbol":
    case "use":
    default: {
      // Recurse into children
      for (let c = 0; c < el.children.length; c++) {
        convertElement(el.children[c], colorMap, commands);
      }
      break;
    }
  }
}

function parsePointsList(str: string): Point[] {
  const nums = str.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  if (!nums) return [];
  const points: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: parseFloat(nums[i]), y: parseFloat(nums[i + 1]) });
  }
  return points;
}

/**
 * Convert an SVG string to a TinyVGDocument.
 * Uses DOMParser (browser) to parse the SVG.
 */
export function svgToTinyVG(svgString: string): TinyVGDocument {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svgEl = doc.documentElement;

  // Determine dimensions
  let width = getNumAttr(svgEl, "width", 0);
  let height = getNumAttr(svgEl, "height", 0);

  if (width === 0 || height === 0) {
    const vb = getAttr(svgEl, "viewBox");
    if (vb) {
      const parts = vb.split(/[\s,]+/).map(Number);
      if (parts.length === 4) {
        width = width || parts[2];
        height = height || parts[3];
      }
    }
  }

  if (width === 0) width = 100;
  if (height === 0) height = 100;

  const colorMap: ColorMap = { colors: [], index: new Map() };
  const commands: TVGCommand[] = [];

  // Add a transparent color at index 0 as fallback
  getOrAddColor(colorMap, { r: 0, g: 0, b: 0, a: 0 });

  for (let i = 0; i < svgEl.children.length; i++) {
    const child = svgEl.children[i];
    if (child.tagName.toLowerCase() === "defs") continue;
    convertElement(child, colorMap, commands);
  }

  // Pick coordinate range
  let coordinateRange = CoordinateRange.Default;
  if (width <= 255 && height <= 255) {
    coordinateRange = CoordinateRange.Reduced;
  } else if (width > 65535 || height > 65535) {
    coordinateRange = CoordinateRange.Enhanced;
  }

  const scale = 0; // integer coordinates

  const header: TinyVGHeader = {
    magic: [0x72, 0x56],
    version: 1,
    scale,
    colorEncoding: ColorEncoding.RGBA8888,
    coordinateRange,
    width: Math.round(width),
    height: Math.round(height),
    colorCount: colorMap.colors.length,
  };

  return { header, colorTable: colorMap.colors, commands };
}
