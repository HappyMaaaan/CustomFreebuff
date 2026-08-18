#!/usr/bin/env node
/**
 * scripts/make-icon.mjs — Draws a small "palette" icon (dark rounded square
 * with colorful dots) and writes it as build/icon.ico.
 * Pure Node: the PNG is built by hand (zlib + CRC32), then wrapped in an ICO.
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'build', 'icon.ico')

const SIZE = 64

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

// "CF" in a tiny 5x7 bitmap font, drawn 2x (10x14 px each).
const FONT = {
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
}

function drawLetters(x, y) {
  const scale = 2
  const cells = []
  let cx = x
  for (const letter of ['C', 'F']) {
    for (let ry = 0; ry < FONT[letter].length; ry++) {
      for (let rx = 0; rx < FONT[letter][ry].length; rx++) {
        if (FONT[letter][ry][rx] === '#') cells.push([cx + rx * scale, y + ry * scale])
      }
    }
    cx += FONT[letter][0].length * scale + 4
  }
  return cells
}

const LETTERS = drawLetters(20, 11)

// One row of RGBA pixels.
function row(y) {
  const out = Buffer.alloc(SIZE * 4)
  for (let x = 0; x < SIZE; x++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    if (insideRoundedRect(x, y, 4, 4, 59, 59, 13)) {
      // dark tile
      r = 14
      g = 14
      b = 14
      a = 255
      // "CF" in light gray (top)
      for (const [lx, ly] of LETTERS) {
        if (x >= lx && x < lx + 2 && y >= ly && y < ly + 2) {
          r = 205
          g = 205
          b = 205
          a = 255
        }
      }
      // palette: big green dot + smaller colored dots (bottom half)
      if (inCircle(x, y, 24, 44, 9)) {
        r = 124
        g = 255
        b = 63
        a = 255
      } else if (inCircle(x, y, 48, 15, 4)) {
        r = 136
        g = 192
        b = 208
        a = 255
      } else if (inCircle(x, y, 51, 34, 4)) {
        r = 247
        g = 118
        b = 142
        a = 255
      } else if (inCircle(x, y, 44, 51, 4)) {
        r = 216
        g = 161
        b = 74
        a = 255
      } else if (inCircle(x, y, 53, 44, 3)) {
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

function makePng() {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  // 10-12: compression, filter, interlace = 0

  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4))
  for (let y = 0; y < SIZE; y++) {
    const rowData = row(y)
    rowData.copy(raw, y * (1 + SIZE * 4) + 1)
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
  header[6] = SIZE // width
  header[7] = SIZE // height
  header[8] = 0 // palette
  header[9] = 0 // reserved
  header.writeUInt16LE(1, 10) // planes
  header.writeUInt16LE(32, 12) // bit count
  header.writeUInt32LE(png.length, 14) // size
  header.writeUInt32LE(22, 18) // offset
  return Buffer.concat([header, png])
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, makeIco(makePng()))
console.log(`[build] icon written to ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes)`)
