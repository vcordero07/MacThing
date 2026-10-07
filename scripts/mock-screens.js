#!/usr/bin/env node
// Saves the README's screenshots: npm run mock-screens -- [preset] [out-dir]
//
// Runs on the real device so the pictures are what the Car Thing draws, but feeds it fixture
// data instead of whatever is playing — one Friday evening, the same on every run. The page is
// reloaded afterwards, which puts the live bridge data and input handlers back.
//
// Three presets, because the album art background changes every screen: `hug` (the default) has it
// on and writes docs/<screen>.png, `deafheaven` has it on over other art and writes
// docs/<screen>-deafheaven.png, and `polvo` has it off and writes docs/<screen>-polvo.png.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../bridge/config.js';
import { adb, listCarThings } from '../bridge/device/adb.js';
import { CDP, listTargets } from '../bridge/device/cdp.js';

const presets = {
  hug: {
    suffix: '', background: 'art', art: 'mock-art.png',
    np: { artist: 'HUG', title: 'Cow With Half Moon Parasol', album: 'HUG', duration: 276, elapsed: 69 },
  },
  deafheaven: {
    suffix: '-deafheaven', background: 'art', art: 'mock-art-deafheaven.png',
    np: { artist: 'Deafheaven', title: 'Dream House', album: 'Sunbather', duration: 554, elapsed: 139 },
  },
  polvo: {
    suffix: '-polvo', background: 'off', art: 'mock-art-polvo.png',
    np: { artist: 'Polvo', title: 'When Will You Die for the Last Time in My Dreams', album: 'Exploded Drawing', duration: 703, elapsed: 176 },
  },
};

const args = process.argv.slice(2);
const name = args.find((a) => !a.includes('/')) || 'hug';
const preset = presets[name];
if (!preset) {
  console.error(`Unknown preset "${name}" — try ${Object.keys(presets).join(' or ')}`);
  process.exit(1);
}
const out = args.find((a) => a.includes('/')) || 'docs';
const here = path.dirname(new URL(import.meta.url).pathname);

const now = Date.UTC(2026, 8, 18, 13, 14); // Friday 18 September, 1:14 PM
const HOUR = 3600000;
const DAY = 86400000;
const midnight = Date.UTC(2026, 8, 18);
const at = (day, hours) => midnight + day * DAY + hours * HOUR;

const settings = {
  theme: 'dark', units: 'F', clock24h: false, background: preset.background,
  clockFace: 'analog', calendarDays: 2, location: { mode: 'auto' },
};

const calendar = {
  status: 'ok',
  events: [
    { start: at(0, 17.5), end: at(0, 19), title: 'Dinner with Sam & Alex', location: 'Studio B', color: '#ff8b00' },
    { start: at(0, 19.5), end: at(0, 21), title: 'Book club', location: 'Studio B', color: '#bf5af2' },
    { start: at(1, 13), end: at(1, 14), title: 'Design review', color: '#30d158' },
  ],
};

const hour = (i, temp, code, isDay, pop) => ({ t: at(0, 13 + i), temp, code, isDay, pop });
const day = (i, code, pop, lo, hi) => ({ t: midnight + i * DAY, code, pop, lo, hi });
const weather = {
  status: 'ok', place: 'Portland', utcOffset: 0, updatedAt: now,
  current: { temp: 72, code: 0, isDay: true },
  hourly: [hour(0, 72, 0, true, 0), hour(1, 74, 0, true, 0), hour(2, 75, 1, true, 0), hour(3, 75, 2, true, 10), hour(4, 74, 2, true, 10), hour(5, 72, 2, true, 10), hour(6, 70, 2, false, 10), hour(7, 68, 3, false, 20), hour(8, 66, 3, false, 20), hour(9, 64, 3, false, 20), hour(10, 63, 3, false, 20)],
  daily: [day(0, 63, 55, 56, 77), day(1, 3, 0, 56, 77), day(2, 63, 55, 44, 63), day(3, 3, 0, 44, 77), day(4, 2, 10, 50, 72), day(5, 61, 40, 52, 68)],
};

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
// The page keeps the least-delayed of the last 15 ticks, so set the time with all 15.
async function tick(ms = now) {
  for (let i = 0; i < 15; i++) await send({ type: 'tick', now: ms, tzMinutes: 0 });
}

const press = (key) => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)}})); window.dispatchEvent(new KeyboardEvent('keyup', {key:${JSON.stringify(key)}}))`);

// Each shot: the screen, and how many more times its button is pressed for the next view (the
// weather's Today and This Week, the calendar's month, the clock's timer; screens keep their view
// between shots). `before` sets up anything else first.
const shots = [
  { name: 'nowplaying' },
  { name: 'calendar' },
  { name: 'calendar-month', screen: 'calendar', reselect: 1 },
  { name: 'weather' },
  { name: 'weather-today', screen: 'weather', reselect: 1 },
  { name: 'weather-week', screen: 'weather', reselect: 1 },
  { name: 'clock' },
  // The knob sets the timer (a click is five minutes), a press starts it; 12 minutes then pass.
  { name: 'clock-timer', screen: 'clock', reselect: 1, before: () => evaluate("window.dispatchEvent(new WheelEvent('wheel', {deltaX:53, cancelable:true}))") },
  { name: 'clock-timer-running', screen: 'clock', before: async () => { await press('Enter'); await pause(500); await tick(now + 12 * 60000); } },
  { name: 'settings' },
  // A meeting alert: the card over whatever is on screen a few minutes before a meeting (a 2 PM
  // one, so the clock is set back to 1:57 for this shot).
  { name: 'meeting-alert', screen: 'nowplaying', before: async () => {
    await tick(at(0, 14) - 3 * 60000);
    await evaluate("localStorage.removeItem('ct-dismissed-meetings')");
    await send({ type: 'settings', settings: { ...settings, meetingAlert: 5 } });
    await send({ type: 'calendar', calendar: { status: 'ok', events: [
      { start: at(0, 14), end: at(0, 14.5), title: 'Design sync', call: 'https://zoom.us/j/1234567890', color: '#30d158', calendarId: 'mock' },
      ...calendar.events,
    ] } });
  } },
];

async function capture({ name, screen = name, reselect = 0, before }) {
  await tick(); // the page shows "Waiting for your Mac" after 6.5s without a message
  await evaluate(`CT.show(${JSON.stringify(screen)})`);
  for (let i = 0; i < reselect; i++) await evaluate(`CT.screens.${screen}.reselect()`);
  if (before) await before();
  // Let screen switches (core.js clears .leaving when the new screen's fade-in ends) and view
  // fades (0.3 s out, then 0.5 s in) finish, then any font fitting settle.
  const busy = `!!document.querySelector('.screen.leaving, .view-enter-active, .view-leave-active')`;
  await pause(100);
  for (let i = 0; i < 30 && (await evaluate(busy)); i++) await pause(100);
  await pause(400);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(out, `${name}${preset.suffix}.png`);
  await fs.writeFile(file, Buffer.from(data, 'base64'));
  console.log(file);
}

// Screens keep the view they were left on (the calendar's month, the clock's timer), so start
// from a fresh page with the default views.
await cdp.send('Page.reload', { ignoreCache: true });
let mounted = false;
for (let i = 0; i < 30 && !mounted; i++) {
  await pause(500);
  mounted = await evaluate('!!window.CT && !!document.querySelector("#mount") && !!document.querySelector("#mount").__vue_app__').catch(() => false);
}

try {
  // Take the bridge's messages out of the page, so live data can't overwrite the fixtures.
  await evaluate('window.__mockReceive = window.__carthingReceive; window.__carthingReceive = function () {}; CT.send = function () {}');
  await send({ type: 'settings', settings });
  await send({ type: 'screen', on: true });
  await tick();
  await send({ type: 'calendar', calendar });
  await send({ type: 'weather', weather });

  const artwork = await fs.readFile(path.join(here, '..', 'docs', preset.art));
  await send({ type: 'nowPlaying', np: { active: true, kind: 'music', ...preset.np, rate: 1, playing: true, artworkKey: 'mock' } });
  await send({ type: 'artwork', key: 'mock', dataUrl: `data:image/png;base64,${artwork.toString('base64')}` });
  await pause(1000); // the art decodes and fades in (0.3 s); on the device that can take longer

  await fs.mkdir(out, { recursive: true });
  for (const shot of shots) await capture(shot);
} finally {
  await cdp.send('Page.reload', { ignoreCache: true });
  cdp.close();
}
