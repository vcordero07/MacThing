#!/usr/bin/env node
// Screenshots of the album art background, drawn four ways over each cover in a folder, in the dark
// and light themes: node scripts/util/art-compare.js [covers-dir] [out-dir]
//
//   1-current   blurred on the Mac, tinted as much as the Mac measured the art needs (this branch)
//   2-mac-blur  blurred on the Mac, the usual tint (0.3 black / 0.4 white)
//   3-css-blur  blurred on the device, mirrored at the sides so the edges don't darken (020034f)
//   4-original  the first CSS blur: the art 32px past the edges, blur(60px), 0.25 white in light
//
// Variants 1–3 go through the page's own code, changing only what the artwork message carries;
// the fourth puts the first version's CSS back on top of it. Everything else on screen is the
// current UI. It runs on the real device, over whatever screen and data it is showing (switch to
// the calendar first), and reloads the page afterwards, which puts the live bridge data back.
// Writes <out>/<cover>.<theme>.<variant>.png and an index.html that lays them side by side.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../../bridge/config.js';
import { adb, listCarThings } from '../../bridge/device/adb.js';
import { CDP, listTargets } from '../../bridge/device/cdp.js';
import { ArtworkCache } from '../../bridge/nowplaying/artwork.js';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const coversDir = process.argv[2] || path.join(root, 'art-compare', 'covers');
const out = process.argv[3] || path.join(root, 'art-compare', 'out');
const THEMES = ['dark', 'light'];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.heic': 'image/heic', '.tiff': 'image/tiff' };

// Each variant: the artwork message it sends (from the Mac's processed cover) and whether the
// first version's CSS goes on. The device blurs the CSS ones itself, which takes it a while.
const VARIANTS = [
  { id: '1-current', label: 'Current: Mac blur, measured tint', art: (a) => ({ dataUrl: a.dataUrl, blurUrl: a.blurUrl, tint: a.tint }) },
  { id: '2-mac-blur', label: 'Mac blur, usual tint', art: (a) => ({ dataUrl: a.dataUrl, blurUrl: a.blurUrl }) },
  { id: '3-css-blur', label: 'CSS blur, mirrored edges', art: (a) => ({ dataUrl: a.dataUrl }), settle: 3000 },
  { id: '4-original', label: 'Original CSS blur', art: (a) => ({ dataUrl: a.dataUrl }), original: true, settle: 3000 },
];

// The first album art background (before 89ff1ed), over the current one: no mirrored copies or
// saturate, and the light theme's tint was 25% white. The dark theme's was 30% black, as now.
const ORIGINAL_CSS = `
html.cmp-original .ambient .art-img { left: -32px; top: -32px; right: -32px; bottom: -32px; -webkit-filter: blur(60px); filter: blur(60px); }
html.cmp-original .ambient .art-img::before, html.cmp-original .ambient .art-img::after { content: none; }
html.cmp-original #app.light .ambient .art-img + .fill { background: rgba(255, 255, 255, 0.25) !important; }`;

const covers = (await fs.readdir(coversDir)).filter((f) => MIME[path.extname(f).toLowerCase()]).sort();
if (!covers.length) {
  console.error(`No images in ${coversDir}`);
  process.exit(1);
}

// The same processing the bridge does: a ≤480px JPEG, the blurred background and its tint.
const artwork = new ArtworkCache(path.join(paths.bin, 'artwork'), { blur: true });
const processed = {};
for (const file of covers) {
  const name = path.basename(file, path.extname(file));
  const base64 = (await fs.readFile(path.join(coversDir, file))).toString('base64');
  processed[name] = await artwork.get({ key: name, mime: MIME[path.extname(file).toLowerCase()], base64 });
  if (!processed[name].blurUrl) console.warn(`${name}: no Mac background (is native/bin/artwork up to date?)`);
}

const [device] = await listCarThings();
if (!device) {
  console.error('No Car Thing found over adb');
  process.exit(1);
}
await adb(['forward', `tcp:${config.cdpPort}`, 'tcp:2222'], { serial: device.serial });
const page = (await listTargets(config.cdpPort)).find((t) => t.type === 'page');
const cdp = await CDP.connect(page.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const send = (msg) => evaluate(`window.__mockReceive(${JSON.stringify(msg)})`);

// The page only shows art whose data URL differs from what's up, so each shot's URLs carry a
// parameter of their own (data: URLs allow them; the image is the same). It also finds them on screen.
let shot = 0;
const mark = (url, id) => url && url.replace(/^data:([^;,]+)/, `data:$1;shot=${id}`);

let ticker;
try {
  // Take the bridge's messages out of the page, so it can't swap the art back; keep the clock
  // ticking in their place (the page shows "Waiting for your Mac" after 6.5s without a message).
  await evaluate('window.__mockReceive = window.__carthingReceive; window.__carthingReceive = function () {}; CT.send = function () {}');
  ticker = setInterval(() => send({ type: 'tick', now: Date.now(), tzMinutes: -new Date().getTimezoneOffset() }).catch(() => {}), 2000);
  await evaluate(`(function () { var s = document.createElement('style'); s.textContent = ${JSON.stringify(ORIGINAL_CSS)}; document.head.appendChild(s); })()`);
  const settings = await evaluate('JSON.parse(JSON.stringify(CT.settings))');
  await fs.mkdir(out, { recursive: true });

  for (const theme of THEMES) {
    await send({ type: 'settings', settings: { ...settings, theme, background: 'art' } });
    for (const name of Object.keys(processed)) {
      for (const variant of VARIANTS) {
        const id = ++shot;
        const art = variant.art(processed[name]);
        await evaluate(`document.documentElement.classList.toggle('cmp-original', ${!!variant.original})`);
        await send({ type: 'nowPlaying', np: { active: true, kind: 'music', artist: name, title: name, album: name, duration: 300, elapsed: 60, rate: 0, playing: false, artworkKey: `cmp-${id}` } });
        await send({ type: 'artwork', key: `cmp-${id}`, ...art, dataUrl: mark(art.dataUrl, id), blurUrl: mark(art.blurUrl, id) });
        // Up once the front layer has this shot's art and the old one has faded out from under it.
        const up = `(function () { var img = document.querySelector('.ambient .art-layer.front .art-img'); return !!img && img.style.backgroundImage.indexOf('shot=${id};') >= 0 && !document.querySelector('.ambient .art-layer.under'); })()`;
        let ready = false;
        for (let i = 0; i < 60 && !ready; i++) {
          await pause(100);
          ready = await evaluate(up);
        }
        if (!ready) console.warn(`${name} ${theme} ${variant.id}: art didn't come up in 6s`);
        await pause(variant.settle || 800);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
        const file = `${name}.${theme}.${variant.id}.png`;
        await fs.writeFile(path.join(out, file), Buffer.from(data, 'base64'));
        console.log(file);
      }
    }
  }
} finally {
  clearInterval(ticker);
  await cdp.send('Page.reload', { ignoreCache: true });
  cdp.close();
}

// Side by side: a table per theme, a row per cover, a column per variant.
const tint = (a, theme) => (a.tint ? a.tint[theme].toFixed(2) : '–');
const html = `<!doctype html>
<meta charset="utf-8"><title>Album art backgrounds</title>
<style>
  body { margin: 24px; font: 13px -apple-system, sans-serif; background: #1b1b1b; color: #ddd; }
  h2 { margin: 32px 0 12px; }
  table { border-collapse: collapse; }
  th, td { padding: 6px; text-align: left; vertical-align: top; }
  td img { display: block; width: 400px; height: 240px; }
  .cover img { width: 120px; height: 120px; }
  small { color: #999; }
</style>
<p>Measured tint is what the Mac says each theme needs (the current version uses it, clamped to 0.3–0.6 dark and 0.4–0.6 light).</p>
${THEMES.map((theme) => `<h2>${theme}</h2>
<table>
  <tr><th>Cover</th>${VARIANTS.map((v) => `<th>${v.label}</th>`).join('')}</tr>
  ${Object.keys(processed).map((name) => `<tr>
    <td class="cover"><img src="${path.relative(out, path.join(coversDir, covers.find((f) => path.basename(f, path.extname(f)) === name)))}"><br>${name}<br><small>measured tint ${tint(processed[name], theme)}</small></td>
    ${VARIANTS.map((v) => `<td><img src="${name}.${theme}.${v.id}.png"></td>`).join('')}
  </tr>`).join('\n  ')}
</table>`).join('\n')}
`;
await fs.writeFile(path.join(out, 'index.html'), html);
console.log(path.join(out, 'index.html'));
