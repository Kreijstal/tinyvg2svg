#!/usr/bin/env node

/**
 * CLI tool for converting TinyVG (.tvg) files to SVG format
 */

import * as fs from "fs";
import * as path from "path";
import { parseTinyVG, ParseError } from "./parser";
import { generateSVG } from "./generator";

function printUsage(): void {
  console.log(`tinyvg2svg - Convert TinyVG (.tvg) files to SVG

Usage:
  tinyvg2svg <input.tvg> [output.svg]
  tinyvg2svg --help

Arguments:
  input.tvg   Path to the input TinyVG file
  output.svg  Path to the output SVG file (optional, defaults to input filename with .svg extension)

Options:
  --help      Show this help message
  --compact   Generate compact SVG without extra whitespace

Examples:
  tinyvg2svg image.tvg
  tinyvg2svg image.tvg output.svg
  tinyvg2svg image.tvg --compact
`);
}

interface CLIOptions {
  inputPath: string;
  outputPath: string | null;
  compact: boolean;
}

function parseArgs(args: string[]): CLIOptions | null {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return null;
  }

  let compact = false;
  const positionalArgs: string[] = [];

  for (const arg of args) {
    if (arg === "--compact") {
      compact = true;
    } else if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      return null;
    } else {
      positionalArgs.push(arg);
    }
  }

  if (positionalArgs.length === 0) {
    console.error("Error: No input file specified");
    return null;
  }

  return {
    inputPath: positionalArgs[0],
    outputPath: positionalArgs.length > 1 ? positionalArgs[1] : null,
    compact,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (!options) {
    printUsage();
    process.exit(1);
  }

  const { inputPath, outputPath, compact } = options;

  // Check input file exists
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Determine output path
  const finalOutputPath =
    outputPath ||
    path.join(path.dirname(inputPath), path.basename(inputPath, path.extname(inputPath)) + ".svg");

  try {
    // Read input file
    const inputData = fs.readFileSync(inputPath);

    // Parse TinyVG
    const doc = parseTinyVG(inputData);

    // Generate SVG
    const svgContent = generateSVG(doc, !compact);

    // Write output
    fs.writeFileSync(finalOutputPath, svgContent, "utf-8");

    console.log(`Converted: ${inputPath} -> ${finalOutputPath}`);
    console.log(`  Dimensions: ${doc.header.width}x${doc.header.height}`);
    console.log(`  Colors: ${doc.colorTable.length}`);
    console.log(`  Commands: ${doc.commands.length}`);
  } catch (err) {
    if (err instanceof ParseError) {
      console.error(`Parse error: ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
    } else {
      console.error(`Unknown error: ${err}`);
    }
    process.exit(1);
  }
}

main();
