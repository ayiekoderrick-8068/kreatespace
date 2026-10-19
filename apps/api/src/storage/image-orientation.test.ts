import { describe, expect, it } from "vitest";
import { InvalidImageError, inspectImage } from "./image-validation.js";

/** A minimal JPEG header: optional EXIF orientation note plus a frame of the given raw size. */
function jpeg(width: number, height: number, orientation?: number): Buffer {
  const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (orientation !== undefined) {
    const tiff = Buffer.concat([
      Buffer.from("MM"),
      u16(0x002a),
      Buffer.from([0, 0, 0, 8]), // first directory starts at byte 8
      u16(1), // one entry
      u16(0x0112), // orientation
      u16(3), // type: short
      Buffer.from([0, 0, 0, 1]), // count
      u16(orientation),
      u16(0), // value padding
      Buffer.from([0, 0, 0, 0]), // no next directory
    ]);
    const body = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
    parts.push(Buffer.from([0xff, 0xe1]), u16(body.length + 2), body);
  }
  parts.push(
    Buffer.from([0xff, 0xc0]),
    u16(17),
    Buffer.from([8]),
    u16(height),
    u16(width),
    Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.from([0xff, 0xd9]),
  );
  return Buffer.concat(parts);
}

describe("stored photo shape follows the way the photo is displayed", () => {
  it("keeps the size of an upright photo", () => {
    expect(inspectImage(jpeg(800, 1000, 1))).toMatchObject({ width: 800, height: 1000 });
  });

  it.each([5, 6, 7, 8])("swaps width and height for camera orientation %i", (orientation) => {
    // Stored as 1000 wide by 800 tall, shown turned upright as 800 wide by 1000 tall.
    expect(inspectImage(jpeg(1000, 800, orientation))).toMatchObject({ width: 800, height: 1000 });
  });

  it.each([2, 3, 4])("does not swap for flips and half turns (orientation %i)", (orientation) => {
    expect(inspectImage(jpeg(1000, 800, orientation))).toMatchObject({ width: 1000, height: 800 });
  });

  it("still refuses photos that are too small, whichever way they are turned", () => {
    expect(() => inspectImage(jpeg(1000, 150, 6))).toThrow(InvalidImageError);
  });
});
