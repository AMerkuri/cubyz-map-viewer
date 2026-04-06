/**
 * Big-endian binary reader for Cubyz save files.
 * All Cubyz binary data uses big-endian byte order.
 */

export class BinaryReader {
  private readonly buffer: Buffer;
  private offset: number;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  seek(offset: number): void {
    this.offset = offset;
  }

  skip(bytes: number): void {
    this.offset += bytes;
  }

  readU8(): number {
    const val = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return val;
  }

  readU16(): number {
    const val = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return val;
  }

  readU32(): number {
    const val = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return val;
  }

  readI32(): number {
    const val = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return val;
  }

  readF32(): number {
    const val = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return val;
  }

  readF64(): number {
    const val = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return val;
  }

  /**
   * Read MSB-first varint (Cubyz format).
   * Continuation bit in high bit, data in lower 7 bits, MSB first.
   */
  readVarInt(): number {
    let result = 0;
    let shift = 0;
    // First pass: count bytes to determine shift
    const startPos = this.offset;
    let byteCount = 0;
    while (this.offset < this.buffer.length) {
      const byte = this.buffer[this.offset];
      this.offset += 1;
      byteCount += 1;
      if ((byte & 0x80) === 0) break;
    }
    // Reset and read with proper MSB-first ordering
    this.offset = startPos;
    shift = (byteCount - 1) * 7;
    result = 0;
    for (let i = 0; i < byteCount; i++) {
      const byte = this.buffer[this.offset];
      this.offset += 1;
      result |= (byte & 0x7f) << shift;
      shift -= 7;
    }
    return result;
  }

  readBytes(length: number): Buffer {
    const slice = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  readRemainingBytes(): Buffer {
    const slice = this.buffer.subarray(this.offset);
    this.offset = this.buffer.length;
    return slice;
  }
}
