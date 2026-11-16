import { deflateSync } from 'node:zlib'

function crc32(data: Buffer): number {
  let crc = 0xffffffff

  for (const byte of data) {
    crc ^= byte

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([length, typeBytes, data, checksum])
}

/**
 * Builds a small, valid RGB PNG without any image dependency. Used to prove
 * that the PDF renderer embeds real images rather than merely reserving space.
 */
export function tinyPng(size = 4): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.writeUInt8(8, 8)
  header.writeUInt8(2, 9)
  header.writeUInt8(0, 10)
  header.writeUInt8(0, 11)
  header.writeUInt8(0, 12)

  const rows: Buffer[] = []

  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3)
    row[0] = 0

    for (let x = 0; x < size; x += 1) {
      const offset = 1 + x * 3
      row[offset] = 20 + x * 20
      row[offset + 1] = 60 + y * 20
      row[offset + 2] = 120
    }

    rows.push(row)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
