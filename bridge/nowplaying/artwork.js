import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { log } from '../log.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/tiff': 'tiff', 'image/gif': 'gif', 'image/webp': 'webp' };
const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  );

/**
 * Re-encodes artwork for the device with native/bin/artwork (see artwork.swift): a square JPEG of at
 * most 480px, centre-cropped at the source's resolution, that the device's 2018-era Chromium can
 * decode whatever the source format was (HEIC/TIFF would not render there). Also a wide JPEG of the
 * whole frame (long edge at most 480px) for Now Playing's 16:9 setting.
 *
 * With `blur` each cover also gets `blurUrl`, the album art background already blurred, so the
 * device doesn't have to blur it (config.ambientBlurOnMac), and `tint`, how strong a tint each theme
 * needs over it for the text to stay readable ({dark, light} overlay opacities, 0…1).
 */
export class ArtworkCache {
  constructor(bin, { maxSize = 480, blur = false } = {}) {
    this.bin = bin;
    this.maxSize = maxSize;
    this.blur = blur;
    this.cache = new Map(); // key -> Promise<{key, dataUrl, wideUrl?, blurUrl?, tint?, width, height, wideWidth, wideHeight}>
    this.dir = null;
  }

  /** @param {{key: string, mime: string, base64: string}} art
   *  @returns {Promise<{key, dataUrl, wideUrl?, blurUrl?, tint?, width, height, wideWidth, wideHeight}>} */
  get(art) {
    if (!this.cache.has(art.key)) {
      if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(art.key, this.#process(art));
    }
    return this.cache.get(art.key);
  }

  async #process(art) {
    this.dir ??= await fs.mkdtemp(path.join(os.tmpdir(), 'carthing-art-'));
    const src = path.join(this.dir, `${art.key}.${EXT[art.mime] || 'img'}`);
    const out = path.join(this.dir, `${art.key}.out.jpg`);
    const wide = path.join(this.dir, `${art.key}.wide.jpg`);
    const blur = path.join(this.dir, `${art.key}.blur.jpg`);
    try {
      await fs.writeFile(src, Buffer.from(art.base64, 'base64'));
      const parsed = JSON.parse(await run(this.bin, [src, String(this.maxSize), out, wide, ...(this.blur ? [blur] : [])]));
      const { width, height, wideWidth, wideHeight, tint } = parsed;
      const jpeg = await fs.readFile(out);
      const wideJpeg = wideWidth ? await fs.readFile(wide).catch(() => null) : null;
      // No background (blur off, or it failed): the device blurs the cover itself.
      const background = this.blur ? await fs.readFile(blur).catch(() => null) : null;
      return {
        key: art.key,
        dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
        wideUrl: wideJpeg ? `data:image/jpeg;base64,${wideJpeg.toString('base64')}` : undefined,
        blurUrl: background ? `data:image/jpeg;base64,${background.toString('base64')}` : undefined,
        tint: background ? tint : undefined,
        width,
        height,
        wideWidth: wideWidth || width,
        wideHeight: wideHeight || height,
      };
    } catch (err) {
      log.warn('[artwork] could not convert, sending original', err.message);
      return { key: art.key, dataUrl: `data:${art.mime};base64,${art.base64}`, width: 0, height: 0, wideWidth: 0, wideHeight: 0 };
    } finally {
      fs.rm(src, { force: true }).catch(() => {});
      fs.rm(out, { force: true }).catch(() => {});
      fs.rm(wide, { force: true }).catch(() => {});
      fs.rm(blur, { force: true }).catch(() => {});
    }
  }
}
