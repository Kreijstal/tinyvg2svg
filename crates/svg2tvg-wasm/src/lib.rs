use wasm_bindgen::prelude::*;
use tinyvg_rs::svg_to_tvg::svg_to_tvg::svg_to_tvg;

#[wasm_bindgen]
pub fn convert_svg_to_tvg(svg_bytes: &[u8]) -> Vec<u8> {
    svg_to_tvg(svg_bytes)
}
