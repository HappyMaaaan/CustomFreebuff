#!/usr/bin/env node
/**
 * scripts/make-icon.mjs — Draws a small "palette" icon (dark rounded square
 * with colorful dots) and writes it as build/icon.ico (Windows) and
 * build/icon.icns (macOS). Pure Node: the PNG is built by hand
 * (zlib + CRC32), then wrapped in an ICO / ICNS container.
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_ICO = path.join(__dirname, '..', 'build', 'icon.ico')
const OUT_ICNS = path.join(__dirname, '..', 'build', 'icon.icns')

// The design is drawn on a 64×64 grid; any multiple of 64 scales it
// pixel-perfectly.
const BASE = 64
const ICO_SIZE = 64
const ICNS_SIZE = 1024

/* ---------------------------------------------------------------- */
/* CRC32 (PNG chunk checksums)                                       */
/* ---------------------------------------------------------------- */

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/* ---------------------------------------------------------------- */
/* Drawing                                                           */
/* ---------------------------------------------------------------- */

function insideRoundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r))
  const cy = Math.max(y0 + r, Math.min(y, y1 - r))
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

// "CF" in a tiny 5x7 bitmap font.
const FONT = {
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
}

function drawLetters(x, y, cell) {
  const cells = []
  let cx = x
  for (const letter of ['C', 'F']) {
    for (let ry = 0; ry < FONT[letter].length; ry++) {
      for (let rx = 0; rx < FONT[letter][ry].length; rx++) {
        if (FONT[letter][ry][rx] === '#') cells.push([cx + rx * cell, y + ry * cell])
      }
    }
    cx += FONT[letter][0].length * cell + 4 * (cell / 2)
  }
  return cells
}

// One row of RGBA pixels. `s` scales the 64×64 design up to `size`.
function row(y, size) {
  const s = size / BASE
  const out = Buffer.alloc(size * 4)
  const LETTERS = drawLetters(20 * s, 11 * s, 2 * s)
  for (let x = 0; x < size; x++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    if (insideRoundedRect(x, y, 4 * s, 4 * s, 59 * s, 59 * s, 13 * s)) {
      // dark tile
      r = 14
      g = 14
      b = 14
      a = 255
      // "CF" in light gray (top)
      for (const [lx, ly] of LETTERS) {
        if (x >= lx && x < lx + 2 * s && y >= ly && y < ly + 2 * s) {
          r = 205
          g = 205
          b = 205
          a = 255
        }
      }
      // palette: big green dot + smaller colored dots (bottom half)
      if (inCircle(x, y, 24 * s, 44 * s, 9 * s)) {
        r = 124
        g = 255
        b = 63
        a = 255
      } else if (inCircle(x, y, 48 * s, 15 * s, 4 * s)) {
        r = 136
        g = 192
        b = 208
        a = 255
      } else if (inCircle(x, y, 51 * s, 34 * s, 4 * s)) {
        r = 247
        g = 118
        b = 142
        a = 255
      } else if (inCircle(x, y, 44 * s, 51 * s, 4 * s)) {
        r = 216
        g = 161
        b = 74
        a = 255
      } else if (inCircle(x, y, 53 * s, 44 * s, 3 * s)) {
        r = 80
        g = 250
        b = 123
        a = 255
      }
    }
    const o = x * 4
    out[o] = r
    out[o + 1] = g
    out[o + 2] = b
    out[o + 3] = a
  }
  return out
}

/* ---------------------------------------------------------------- */
/* PNG                                                                */
/* ---------------------------------------------------------------- */

function makePng(size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  // 10-12: compression, filter, interlace = 0

  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    row(y, size).copy(raw, y * (1 + size * 4) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------------------------------------------------------------- */
/* ICO wrapper                                                       */
/* ---------------------------------------------------------------- */

function makeIco(png) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count
  header[6] = ICO_SIZE // width
  header[7] = ICO_SIZE // height
  header[8] = 0 // palette
  header[9] = 0 // reserved
  header.writeUInt16LE(1, 10) // planes
  header.writeUInt16LE(32, 12) // bit count
  header.writeUInt32LE(png.length, 14) // size
  header.writeUInt32LE(22, 18) // offset
  return Buffer.concat([header, png])
}

/* ---------------------------------------------------------------- */
/* ICNS wrapper                                                      */
/* ---------------------------------------------------------------- */

/** Minimal .icns: a single 1024×1024 PNG ('ic10'). macOS scales it down
 *  for every display size, so one image is enough. */
function makeIcns(png) {
  const chunkLen = 8 + png.length
  const total = 8 + chunkLen
  const out = Buffer.alloc(total)
  out.write('icns', 0, 'ascii')
  out.writeUInt32BE(total, 4)
  out.write('ic10', 8, 'ascii')
  out.writeUInt32BE(chunkLen, 12)
  png.copy(out, 16)
  return out
}

fs.mkdirSync(path.dirname(OUT_ICO), { recursive: true })
const icoPng = makePng(ICO_SIZE)
fs.writeFileSync(OUT_ICO, makeIco(icoPng))
console.log(`[build] icon written to ${path.relative(process.cwd(), OUT_ICO)} (${fs.statSync(OUT_ICO).size} bytes)`)
const icnsPng = makePng(ICNS_SIZE)
fs.writeFileSync(OUT_ICNS, makeIcns(icnsPng))
console.log(`[build] icon written to ${path.relative(process.cwd(), OUT_ICNS)} (${fs.statSync(OUT_ICNS).size} bytes)`)
