import { assertEquals } from "./assert.ts";
import { imageDimensions } from "../_shared/image-dimensions.ts";

const u16be = (n: number) => [n >> 8, n & 0xff];
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

// PNG signature + IHDR chunk (length 13, "IHDR", width, height, depth, color, ...). CRC is not read.
const PNG_3x2 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ...u32be(13), 0x49, 0x48, 0x44, 0x52, ...u32be(3), ...u32be(2), 8, 6, 0, 0, 0,
  0, 0, 0, 0,
]);

// SOI, APP0 (JFIF, 16 bytes), DQT stub (4 bytes), then SOF0: length 17, precision 8, height 5, width 4.
const jpeg = (sof: number) =>
  new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, ...u16be(16), 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xdb, ...u16be(4), 0, 0,
    0xff, sof, ...u16be(17), 8, ...u16be(5), ...u16be(4), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);

Deno.test("imageDimensions: PNG IHDR 3x2", () => {
  assertEquals(imageDimensions(PNG_3x2, "image/png"), { width: 3, height: 2 });
});

Deno.test("imageDimensions: JPEG SOF0 / SOF1 / SOF2 after APP0 and DQT, 4x5", () => {
  assertEquals(imageDimensions(jpeg(0xc0), "image/jpeg"), { width: 4, height: 5 });
  assertEquals(imageDimensions(jpeg(0xc1), "image/jpeg"), { width: 4, height: 5 });
  assertEquals(imageDimensions(jpeg(0xc2), "image/jpeg"), { width: 4, height: 5 });
});

Deno.test("imageDimensions: garbage, truncated and mismatched mime → null", () => {
  assertEquals(imageDimensions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), "image/png"), null);
  assertEquals(imageDimensions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), "image/jpeg"), null);
  assertEquals(imageDimensions(PNG_3x2.slice(0, 20), "image/png"), null);
  assertEquals(imageDimensions(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"), null);
  // A segment length that runs past the end never reads out of bounds.
  assertEquals(imageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0, 0, 0, 0]), "image/jpeg"), null);
  // Only SOS/EOI before any SOF: unknown.
  assertEquals(imageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]), "image/jpeg"), null);
  assertEquals(imageDimensions(PNG_3x2, "image/jpeg"), null);
  assertEquals(imageDimensions(jpeg(0xc0), "image/png"), null);
});
