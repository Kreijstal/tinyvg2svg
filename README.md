# tinyvg2svg

A TinyVG to SVG converter — transform [TinyVG](https://tinyvg.tech/) vector graphics (.tvg) into standard SVG format.

## Features

- Full TinyVG v1.0 specification support
- All 12 command types (fill polygon, fill rectangles, fill path, draw lines, draw line loop, draw line strip, draw line path, outline fill polygon/rectangles/path, text hint)
- All 3 color encodings (RGBA8888, RGB565, RGBA F32)
- All 3 coordinate ranges (8-bit, 16-bit, 32-bit)
- All 3 style types (flat color, linear gradient, radial gradient)
- All path segment types (line, horizontal/vertical line, cubic/quadratic Bézier, arc circle/ellipse, close path)
- Both library API and CLI interface

## Installation

```bash
npm install
npm run build
```

## CLI Usage

```bash
# Basic conversion (outputs to input filename with .svg extension)
npx tinyvg2svg image.tvg

# Specify output path
npx tinyvg2svg image.tvg output.svg

# Compact output (no pretty printing)
npx tinyvg2svg image.tvg output.svg --compact
```

## Library Usage

```typescript
import { parseTinyVG, generateSVG } from "tinyvg2svg";
import * as fs from "fs";

const tvgData = fs.readFileSync("image.tvg");
const doc = parseTinyVG(tvgData);
const svgString = generateSVG(doc);
fs.writeFileSync("image.svg", svgString);
```

## TinyVG Format Overview

TinyVG is a compact binary vector graphics format designed as a simpler, smaller alternative to SVG. Key characteristics:

- **Binary encoding** — ~39% file size compared to equivalent SVG
- **Color table** — Colors are stored once in a palette; commands reference them by index
- **Variable-length integers** — VarUInt encoding keeps small numbers small
- **Fixed-point Units** — Configurable precision via scale and coordinate range
- **12 draw commands** — Cover 90%+ of commonly used SVG features

## Specification

This implementation follows the [TinyVG specification v1.0](https://github.com/TinyVG/specification).

## License

MIT
