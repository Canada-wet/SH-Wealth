/** Synthetic sine with silence / energy changes. Not a user's song. */
export function syntheticDJWave(seconds = 64, silent = false) {
  const rate = 8000,
    count = rate * seconds,
    buffer = Buffer.alloc(44 + count * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + count * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate,
      gain =
        silent || t < 2 || t > 60 ? 0 : t < 30 ? 0.12 : t < 45 ? 0.65 : 0.08;
    buffer.writeInt16LE(
      Math.round(32760 * gain * Math.sin(2 * Math.PI * 220 * t)),
      44 + i * 2,
    );
  }
  return buffer;
}
