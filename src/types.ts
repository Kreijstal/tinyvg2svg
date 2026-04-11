/**
 * TinyVG format type definitions based on the TinyVG specification v1.0
 */

export enum ColorEncoding {
  RGBA8888 = 0,
  RGB565 = 1,
  RGBAF32 = 2,
  Custom = 3,
}

export enum CoordinateRange {
  Default = 0, // 16-bit
  Reduced = 1, // 8-bit
  Enhanced = 2, // 32-bit
}

export enum CommandIndex {
  EndOfDocument = 0,
  FillPolygon = 1,
  FillRectangles = 2,
  FillPath = 3,
  DrawLines = 4,
  DrawLineLoop = 5,
  DrawLineStrip = 6,
  DrawLinePath = 7,
  OutlineFillPolygon = 8,
  OutlineFillRectangles = 9,
  OutlineFillPath = 10,
  TextHint = 11,
}

export enum StyleType {
  Flat = 0,
  LinearGradient = 1,
  RadialGradient = 2,
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Line {
  start: Point;
  end: Point;
}

export interface FlatStyle {
  type: StyleType.Flat;
  colorIndex: number;
}

export interface LinearGradientStyle {
  type: StyleType.LinearGradient;
  point1: Point;
  point2: Point;
  colorIndex1: number;
  colorIndex2: number;
}

export interface RadialGradientStyle {
  type: StyleType.RadialGradient;
  point1: Point;
  point2: Point;
  colorIndex1: number;
  colorIndex2: number;
}

export type Style = FlatStyle | LinearGradientStyle | RadialGradientStyle;

export enum PathSegmentType {
  Line = 0,
  HorizontalLine = 1,
  VerticalLine = 2,
  CubicBezier = 3,
  ArcCircle = 4,
  ArcEllipse = 5,
  ClosePath = 6,
  QuadraticBezier = 7,
}

export interface LineSegment {
  type: PathSegmentType.Line;
  lineWidthChange: number | null; // null = no change
  end: Point;
}

export interface HorizontalLineSegment {
  type: PathSegmentType.HorizontalLine;
  lineWidthChange: number | null;
  x: number;
}

export interface VerticalLineSegment {
  type: PathSegmentType.VerticalLine;
  lineWidthChange: number | null;
  y: number;
}

export interface CubicBezierSegment {
  type: PathSegmentType.CubicBezier;
  lineWidthChange: number | null;
  control1: Point;
  control2: Point;
  end: Point;
}

export interface ArcCircleSegment {
  type: PathSegmentType.ArcCircle;
  lineWidthChange: number | null;
  radius: number;
  largeArc: boolean;
  sweep: boolean;
  end: Point;
}

export interface ArcEllipseSegment {
  type: PathSegmentType.ArcEllipse;
  lineWidthChange: number | null;
  radiusX: number;
  radiusY: number;
  angle: number;
  largeArc: boolean;
  sweep: boolean;
  end: Point;
}

export interface ClosePathSegment {
  type: PathSegmentType.ClosePath;
  lineWidthChange: number | null;
}

export interface QuadraticBezierSegment {
  type: PathSegmentType.QuadraticBezier;
  lineWidthChange: number | null;
  control: Point;
  end: Point;
}

export type PathSegment =
  | LineSegment
  | HorizontalLineSegment
  | VerticalLineSegment
  | CubicBezierSegment
  | ArcCircleSegment
  | ArcEllipseSegment
  | ClosePathSegment
  | QuadraticBezierSegment;

export interface Path {
  origin: Point;
  segments: PathSegment[];
}

// Commands

export interface FillPolygonCommand {
  command: CommandIndex.FillPolygon;
  fillStyle: Style;
  points: Point[];
}

export interface FillRectanglesCommand {
  command: CommandIndex.FillRectangles;
  fillStyle: Style;
  rectangles: Rectangle[];
}

export interface FillPathCommand {
  command: CommandIndex.FillPath;
  fillStyle: Style;
  path: Path;
}

export interface DrawLinesCommand {
  command: CommandIndex.DrawLines;
  lineStyle: Style;
  lineWidth: number;
  lines: Line[];
}

export interface DrawLineLoopCommand {
  command: CommandIndex.DrawLineLoop;
  lineStyle: Style;
  lineWidth: number;
  points: Point[];
}

export interface DrawLineStripCommand {
  command: CommandIndex.DrawLineStrip;
  lineStyle: Style;
  lineWidth: number;
  points: Point[];
}

export interface DrawLinePathCommand {
  command: CommandIndex.DrawLinePath;
  lineStyle: Style;
  lineWidth: number;
  path: Path;
}

export interface OutlineFillPolygonCommand {
  command: CommandIndex.OutlineFillPolygon;
  fillStyle: Style;
  lineStyle: Style;
  lineWidth: number;
  points: Point[];
}

export interface OutlineFillRectanglesCommand {
  command: CommandIndex.OutlineFillRectangles;
  fillStyle: Style;
  lineStyle: Style;
  lineWidth: number;
  rectangles: Rectangle[];
}

export interface OutlineFillPathCommand {
  command: CommandIndex.OutlineFillPath;
  fillStyle: Style;
  lineStyle: Style;
  lineWidth: number;
  path: Path;
}

export interface TextHintCommand {
  command: CommandIndex.TextHint;
  center: Point;
  rotation: number;
  height: number;
  text: string;
  glyphOffsets: Array<[number, number]>;
}

export type TVGCommand =
  | FillPolygonCommand
  | FillRectanglesCommand
  | FillPathCommand
  | DrawLinesCommand
  | DrawLineLoopCommand
  | DrawLineStripCommand
  | DrawLinePathCommand
  | OutlineFillPolygonCommand
  | OutlineFillRectanglesCommand
  | OutlineFillPathCommand
  | TextHintCommand;

export interface TinyVGHeader {
  magic: [number, number];
  version: number;
  scale: number;
  colorEncoding: ColorEncoding;
  coordinateRange: CoordinateRange;
  width: number;
  height: number;
  colorCount: number;
}

export interface TinyVGDocument {
  header: TinyVGHeader;
  colorTable: RGBA[];
  commands: TVGCommand[];
}
