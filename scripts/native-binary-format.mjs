import fs from 'node:fs';

export function assertWindowsX64Pe(filePath, label = filePath) {
  const binary = fs.readFileSync(filePath);
  if (binary.length < 0x40 || binary[0] !== 0x4d || binary[1] !== 0x5a) {
    throw new Error(`${label} is not a Windows PE binary (missing MZ header): ${filePath}`);
  }

  const peOffset = binary.readUInt32LE(0x3c);
  if (
    peOffset + 24 > binary.length ||
    binary.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000'
  ) {
    throw new Error(`${label} is not a valid Windows PE binary: ${filePath}`);
  }

  const machine = binary.readUInt16LE(peOffset + 4);
  if (machine !== 0x8664) {
    throw new Error(
      `${label} is not Windows x64 (expected machine 0x8664, got 0x${machine.toString(16)}): ${filePath}`,
    );
  }
}
