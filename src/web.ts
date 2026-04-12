/**
 * Web application entry point for TinyVG <-> SVG converter
 * Uses WASM (usvg-based) for SVG->TVG, TypeScript for TVG->SVG
 */

import { parseTinyVG, ParseError } from "./parser";
import { generateSVG } from "./generator";

// WASM module for SVG->TVG conversion
let wasmConvert: ((svg: Uint8Array) => Uint8Array) | null = null;
let wasmReady = false;
let wasmError: string | null = null;

// Load the WASM module at runtime (not bundled)
async function initWasm() {
  try {
    // Use dynamic import so esbuild doesn't try to bundle this
    const wasmUrl = new URL("./wasm/svg2tvg.js", window.location.href).href;
    const wasm = await import(/* webpackIgnore: true */ wasmUrl);
    await wasm.default();
    wasmConvert = wasm.convert_svg_to_tvg;
    wasmReady = true;
    updateWasmStatus();
  } catch (e) {
    wasmError = `WASM load failed: ${e}`;
    updateWasmStatus();
  }
}

function updateWasmStatus() {
  const el = document.getElementById("wasmStatus");
  if (!el) return;
  if (wasmReady) {
    el.textContent = "WASM engine loaded (usvg)";
    el.style.color = "#4ade80";
  } else if (wasmError) {
    el.textContent = wasmError;
    el.style.color = "#f87171";
  } else {
    el.textContent = "Loading WASM engine...";
    el.style.color = "#94a3b8";
  }
}

initWasm();

const dropZone = document.getElementById("dropZone")!;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const inputInfo = document.getElementById("inputInfo")!;
const inputError = document.getElementById("inputError")!;
const inputPreviewContent = document.getElementById("inputPreviewContent")!;
const outputInfo = document.getElementById("outputInfo")!;
const outputError = document.getElementById("outputError")!;
const outputPreviewContent = document.getElementById("outputPreviewContent")!;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;
const copyBtn = document.getElementById("copyBtn") as HTMLButtonElement;

let outputBlob: Blob | null = null;
let outputFilename = "";
let outputSvgText = "";

function showInfo(el: HTMLElement, text: string) {
  el.textContent = text;
  el.classList.remove("hidden");
}

function showError(el: HTMLElement, text: string) {
  el.textContent = text;
  el.classList.remove("hidden");
}

function hideEl(el: HTMLElement) {
  el.classList.add("hidden");
}

function clearOutput() {
  hideEl(outputInfo);
  hideEl(outputError);
  outputPreviewContent.innerHTML = '<p style="color:#64748b">Converted output will appear here</p>';
  downloadBtn.disabled = true;
  copyBtn.disabled = true;
  outputBlob = null;
  outputSvgText = "";
}

function clearInput() {
  hideEl(inputInfo);
  hideEl(inputError);
  inputPreviewContent.innerHTML = '<p style="color:#64748b">Preview will appear here</p>';
}

function previewSvg(container: HTMLElement, svgText: string) {
  container.innerHTML = svgText;
  const svg = container.querySelector("svg");
  if (svg) {
    svg.style.maxWidth = "100%";
    svg.style.maxHeight = "100%";
    svg.removeAttribute("width");
    svg.removeAttribute("height");
  }
}

function handleTVGInput(data: Uint8Array, filename: string) {
  clearInput();
  clearOutput();

  try {
    const doc = parseTinyVG(data);
    showInfo(inputInfo, `${filename} - ${doc.header.width}x${doc.header.height}, ${doc.colorTable.length} colors, ${doc.commands.length} commands, ${data.byteLength} bytes`);

    const svgText = generateSVG(doc, true);

    previewSvg(inputPreviewContent, svgText);

    outputSvgText = svgText;
    outputBlob = new Blob([svgText], { type: "image/svg+xml" });
    outputFilename = filename.replace(/\.tvg$/i, ".svg");

    previewSvg(outputPreviewContent, svgText);
    showInfo(outputInfo, `${outputFilename} - ${svgText.length} bytes`);

    downloadBtn.disabled = false;
    copyBtn.disabled = false;
  } catch (e) {
    const msg = e instanceof ParseError ? e.message : `Error: ${e}`;
    showError(inputError, msg);
  }
}

function handleSVGInput(svgText: string, filename: string) {
  clearInput();
  clearOutput();

  try {
    previewSvg(inputPreviewContent, svgText);
    showInfo(inputInfo, `${filename} - ${svgText.length} bytes`);

    if (!wasmReady || !wasmConvert) {
      showError(outputError, "WASM engine not loaded yet. Please wait and try again.");
      return;
    }

    const svgBytes = new TextEncoder().encode(svgText);
    const tvgData = wasmConvert(svgBytes);

    outputFilename = filename.replace(/\.svg$/i, ".tvg");
    outputBlob = new Blob([tvgData.buffer as ArrayBuffer], { type: "application/octet-stream" });
    outputSvgText = "";

    // Re-parse the TVG to show preview (round-trip verification)
    try {
      const reparsed = parseTinyVG(tvgData);
      const roundTripSvg = generateSVG(reparsed, true);
      previewSvg(outputPreviewContent, roundTripSvg);
      showInfo(outputInfo, `${outputFilename} - ${tvgData.byteLength} bytes, ${reparsed.colorTable.length} colors, ${reparsed.commands.length} commands`);
    } catch {
      showInfo(outputInfo, `${outputFilename} - ${tvgData.byteLength} bytes`);
      outputPreviewContent.innerHTML = '<p style="color:#94a3b8">Binary TVG output (preview unavailable)</p>';
    }

    downloadBtn.disabled = false;
    copyBtn.disabled = true;
  } catch (e) {
    showError(outputError, `Conversion error: ${e}`);
  }
}

function handleFile(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "tvg") {
    file.arrayBuffer().then((buf) => {
      handleTVGInput(new Uint8Array(buf), file.name);
    });
  } else if (ext === "svg") {
    file.text().then((text) => {
      handleSVGInput(text, file.name);
    });
  } else {
    clearInput();
    clearOutput();
    showError(inputError, `Unsupported file type: .${ext}. Please use .tvg or .svg files.`);
  }
}

// Drag and drop
dropZone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) {
    handleFile(fileInput.files[0]);
  }
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer?.files[0]) {
    handleFile(e.dataTransfer.files[0]);
  }
});

// Download
downloadBtn.addEventListener("click", () => {
  if (!outputBlob) return;
  const url = URL.createObjectURL(outputBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = outputFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Copy SVG
copyBtn.addEventListener("click", () => {
  if (!outputSvgText) return;
  navigator.clipboard.writeText(outputSvgText).then(() => {
    const orig = copyBtn.textContent;
    copyBtn.textContent = "Copied!";
    setTimeout(() => { copyBtn.textContent = orig; }, 1500);
  });
});
