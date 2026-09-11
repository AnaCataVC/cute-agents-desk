// @ts-check
/**
 * Packs `assets/icon.png` into `assets/icon.ico`, which is what Windows reads for the
 * executable, the taskbar and the shortcut.
 *
 * Electron does the resizing through `nativeImage` — it is already a dependency, so this needs
 * no ImageMagick and no sharp, and the sizes come out of the same renderer that draws the
 * window. Run with: npm run icon
 */

const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', 'assets', 'icon.png');
const TARGET = path.join(__dirname, '..', 'assets', 'icon.ico');

// Windows picks the closest entry per context: 16 in the title bar, 32 in the taskbar,
// 256 in the "extra large icons" view and in the installer.
const SIZES = [256, 128, 64, 48, 32, 24, 16];

/**
 * ICO container with PNG payloads (supported since Vista, and the only sane way to carry 256px).
 * @param {{size: number, png: Buffer}[]} images
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, png }, i) => {
    const at = i * 16;
    // 256 does not fit in a byte and is written as 0 — the format's own convention.
    directory.writeUInt8(size === 256 ? 0 : size, at);
    directory.writeUInt8(size === 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2);       // palette colours: none, it is truecolour
    directory.writeUInt8(0, at + 3);       // reserved
    directory.writeUInt16LE(1, at + 4);    // colour planes
    directory.writeUInt16LE(32, at + 6);   // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.png)]);
}

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(SOURCE);
  if (source.isEmpty()) {
    console.error(`no se pudo leer ${SOURCE}`);
    app.exit(1);
    return;
  }

  const images = SIZES.map((size) => ({
    size,
    png: source.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));

  fs.writeFileSync(TARGET, buildIco(images));
  const { width, height } = source.getSize();
  console.log(`icon.ico ← icon.png (${width}x${height}) · ${SIZES.join(', ')} px`);
  app.quit();
});
