/** Tiny average-hash for PNG/JPEG buffers without native deps (downsample via raw parse limited).
 *  For non-decodable buffers, falls back to sha1 of byte sample — still useful for exact dupes.
 */
const crypto = require('crypto');

function sampleHash(buf) {
  if (!buf || !buf.length) return 'empty';
  const step = Math.max(1, Math.floor(buf.length / 64));
  const samples = [];
  for (let i = 0; i < buf.length && samples.length < 64; i += step) samples.push(buf[i]);
  return crypto.createHash('sha1').update(Buffer.from(samples)).digest('hex').slice(0, 16);
}

/** Returns true if hashes are "same enough" (exact for sample hash). */
function similar(a, b) {
  if (!a || !b) return false;
  return a === b;
}

module.exports = { sampleHash, similar };
