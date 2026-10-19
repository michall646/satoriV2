// Store-only ZIP writer (no compression): stdlib-only, good enough for code bundles.
'use strict';
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(String(f.name || 'file.txt'), 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); // fixed DOS time
    local.writeUInt16LE(0, 12); // fixed DOS date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);
    central.push({ name, crc, size: data.length, offset });
    offset += local.length + name.length + data.length;
  }
  const cdStart = offset;
  for (const e of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(0, 12);
    h.writeUInt16LE(0, 14);
    h.writeUInt32LE(e.crc, 16);
    h.writeUInt32LE(e.size, 20);
    h.writeUInt32LE(e.size, 24);
    h.writeUInt16LE(e.name.length, 28);
    h.writeUInt32LE(e.offset, 42);
    chunks.push(h, e.name);
    offset += h.length + e.name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}
module.exports = { crc32, zipStore };
