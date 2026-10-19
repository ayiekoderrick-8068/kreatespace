import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareImage, shrinkImage, validateImageFile } from "./uploads";

const file = (name: string, type: string, bytes: number) =>
  new File([new Uint8Array(bytes)], name, { type });

/** A pretend browser: images have the given size, and saving a canvas produces `outputBytes`. */
function fakeBrowser(options: {
  width: number;
  height: number;
  outputBytes?: number;
  noContext?: boolean;
}) {
  const drawn: { width: number; height: number }[] = [];
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: options.width, height: options.height, close })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    if (options.noContext) return null;
    return {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn((_bitmap: unknown, _x: number, _y: number, w: number, h: number) =>
        drawn.push({ width: w, height: h }),
      ),
    } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback, type) {
    callback(
      options.outputBytes === 0
        ? null
        : new Blob([new Uint8Array(options.outputBytes ?? 300_000)], { type }),
    );
  });
  return { drawn, close };
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("shrinkImage", () => {
  it("scales a large phone photo down to 1600 pixels on its longer side, as a smaller JPEG", async () => {
    const { drawn, close } = fakeBrowser({ width: 4000, height: 3000, outputBytes: 350_000 });
    const original = file("IMG_0042.jpeg", "image/jpeg", 4_000_000);
    const result = await shrinkImage(original);
    expect(drawn).toEqual([{ width: 1600, height: 1200 }]);
    expect(result).not.toBe(original);
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("IMG_0042.jpg");
    expect(result.size).toBe(350_000);
    expect(close).toHaveBeenCalled();
  });

  it("handles portrait photos and keeps a WebP as WebP", async () => {
    const { drawn } = fakeBrowser({ width: 3000, height: 4000, outputBytes: 200_000 });
    const result = await shrinkImage(file("look.webp", "image/webp", 2_500_000));
    expect(drawn).toEqual([{ width: 1200, height: 1600 }]);
    expect(result).toMatchObject({ type: "image/webp", name: "look.webp" });
  });

  it("turns a large PNG into a JPEG", async () => {
    fakeBrowser({ width: 2400, height: 1800, outputBytes: 250_000 });
    const result = await shrinkImage(file("logo.png", "image/png", 3_000_000));
    expect(result).toMatchObject({ type: "image/jpeg", name: "logo.jpg" });
  });

  it("leaves a photo alone when it is already small and light", async () => {
    const { drawn } = fakeBrowser({ width: 1200, height: 900 });
    const original = file("small.jpg", "image/jpeg", 400_000);
    expect(await shrinkImage(original)).toBe(original);
    expect(drawn).toEqual([]);
  });

  it("still recompresses a modest-sized but heavy file", async () => {
    fakeBrowser({ width: 1500, height: 1000, outputBytes: 300_000 });
    const result = await shrinkImage(file("heavy.jpg", "image/jpeg", 2_000_000));
    expect(result.size).toBe(300_000);
  });

  it("never shrinks a very wide image below the API's minimum side", async () => {
    const { drawn } = fakeBrowser({ width: 12_000, height: 600 });
    const original = file("panorama.jpg", "image/jpeg", 3_000_000);
    expect(await shrinkImage(original)).toBe(original);
    expect(drawn).toEqual([]);
  });

  it("keeps the original when the new file would not be any lighter", async () => {
    fakeBrowser({ width: 4000, height: 3000, outputBytes: 5_000_000 });
    const original = file("odd.jpg", "image/jpeg", 4_000_000);
    expect(await shrinkImage(original)).toBe(original);
  });

  it("keeps the original whenever the browser cannot do the work", async () => {
    const original = file("x.jpg", "image/jpeg", 4_000_000);
    fakeBrowser({ width: 4000, height: 3000, noContext: true });
    expect(await shrinkImage(original)).toBe(original);

    vi.restoreAllMocks();
    fakeBrowser({ width: 4000, height: 3000, outputBytes: 0 });
    expect(await shrinkImage(original)).toBe(original);

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => Promise.reject(new Error("corrupt"))),
    );
    expect(await shrinkImage(original)).toBe(original);

    vi.stubGlobal("createImageBitmap", undefined);
    expect(await shrinkImage(original)).toBe(original);
  });

  it("ignores files that are not supported images", async () => {
    fakeBrowser({ width: 4000, height: 3000 });
    const gif = file("anim.gif", "image/gif", 4_000_000);
    expect(await shrinkImage(gif)).toBe(gif);
  });
});

describe("prepareImage", () => {
  it("accepts a photo over 5 MB once it has been made lighter", async () => {
    fakeBrowser({ width: 6000, height: 4000, outputBytes: 400_000 });
    const result = await prepareImage(file("big.jpg", "image/jpeg", 8_000_000));
    expect("file" in result && result.file.size).toBe(400_000);
  });

  it("still refuses a too-large file that could not be shrunk, naming the person's own file", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const result = await prepareImage(file("big.jpg", "image/jpeg", 8_000_000));
    expect(result).toEqual({ error: "big.jpg: images must be 5 MB or smaller." });
  });

  it("explains unsupported and empty files", async () => {
    expect(await prepareImage(file("a.gif", "image/gif", 1000))).toEqual({
      error: "a.gif: only JPEG, PNG or WebP images are allowed.",
    });
    expect(await prepareImage(file("a.png", "image/png", 0))).toEqual({
      error: "a.png: this file is empty.",
    });
  });

  it("passes small photos through unchanged", async () => {
    fakeBrowser({ width: 800, height: 800 });
    const original = file("ok.png", "image/png", 90_000);
    expect(await prepareImage(original)).toEqual({ file: original });
  });
});

describe("validateImageFile (unchanged limits)", () => {
  it("still enforces type, size and emptiness", () => {
    expect(validateImageFile(file("a.jpg", "image/jpeg", 100))).toBeNull();
    expect(validateImageFile(file("a.jpg", "image/jpeg", 6_000_000))).toMatch(/5 MB/);
    expect(validateImageFile(file("a.svg", "image/svg+xml", 100))).toMatch(
      /only JPEG, PNG or WebP/,
    );
  });
});
