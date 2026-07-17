'use strict';
// Strips the Authenticode certificate table from a PE (.exe) - pure Node, no deps.
//
// When we build the SEA exe we copy node.exe, which ships Authenticode-signed.
// After injecting our blob that signature is invalid ("signature seems corrupted"),
// and the leftover cert overlay at end-of-file makes rcedit hang and looks
// suspicious to antivirus (a broken signature is worse than none). This removes it
// cleanly so we can stamp metadata and (optionally) self-sign fresh.
//
//   node strip-signature.js DesktopBroom.exe

const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('usage: node strip-signature.js <exe>'); process.exit(1); }

const buf = fs.readFileSync(file);
const peOff = buf.readUInt32LE(0x3C);                 // e_lfanew -> PE header
if (buf.toString('ascii', peOff, peOff + 4) !== 'PE\0\0') { console.error('Not a PE file'); process.exit(1); }

const optOff = peOff + 24;                             // COFF header is 20 bytes after "PE\0\0"
const magic = buf.readUInt16LE(optOff);
const isPE32Plus = magic === 0x20B;                   // 0x20B = PE32+ (x64/arm64), 0x10B = PE32
const dataDirOff = optOff + (isPE32Plus ? 112 : 96);  // start of the data directory array
const certEntryOff = dataDirOff + 4 * 8;              // IMAGE_DIRECTORY_ENTRY_SECURITY (index 4)

const certAddr = buf.readUInt32LE(certEntryOff);      // file offset of cert table (special: it's a raw offset)
const certSize = buf.readUInt32LE(certEntryOff + 4);

if (!certSize || !certAddr) { console.log('No Authenticode signature present - nothing to strip.'); process.exit(0); }

// Zero the directory entry, then drop the cert overlay by truncating to its start.
buf.writeUInt32LE(0, certEntryOff);
buf.writeUInt32LE(0, certEntryOff + 4);
const stripped = buf.subarray(0, certAddr);
fs.writeFileSync(file, stripped);
console.log(`Stripped signature: removed ${certSize} bytes at offset ${certAddr}. New size: ${stripped.length} bytes.`);
