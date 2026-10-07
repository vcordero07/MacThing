import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from './log.js';

// User-changeable settings (from the device's settings screen or the Mac settings page),
// persisted outside the repo. Developer-level options live in config.js instead.
const FILE = path.join(os.homedir(), 'Library', 'Application Support', 'carthing-now-playing', 'settings.json');

export const DEFAULTS = {
  theme: 'dark', // 'dark' | 'light' | 'auto' (follow the Mac's appearance)
  units: 'F', // weather temperature: 'F' | 'C'
  clock24h: false,
  clockFace: 'analog', // 'analog' | 'numbers' | 'digital'
  artBackground: false, // blurred album art behind Now Playing and the widgets
  rotateEvery: 0, // seconds on each screen before the next: 0 off, 60 or 120. Order is Now Playing, Calendar, Weather, Clock
  location: { mode: 'auto' }, // or { mode: 'manual', name, lat, lon }
  calendars: null, // null = every calendar in the Mac's Calendar app; else an array of calendar ids
  calendarDays: 2, // days of events on the Calendar screen: today plus the next (n − 1)
  meetingAlert: 0, // when a timed event's alert covers the screen: 0 = off, 'event' = at the event's own alert, else minutes before
  meetingTimer: false, // start the clock's timer, set to the meeting's end, as each timed event starts
};

const VALID = {
  theme: (v) => ['dark', 'light', 'auto'].includes(v),
  units: (v) => v === 'F' || v === 'C',
  clock24h: (v) => typeof v === 'boolean',
  clockFace: (v) => ['analog', 'numbers', 'digital'].includes(v),
  artBackground: (v) => typeof v === 'boolean',
  rotateEvery: (v) => v === 0 || v === 60 || v === 120,
  location: (v) =>
    v?.mode === 'auto' ||
    (v?.mode === 'manual' && typeof v.name === 'string' && Number.isFinite(v.lat) && Number.isFinite(v.lon)),
  calendars: (v) => v === null || (Array.isArray(v) && v.every((id) => typeof id === 'string')),
  calendarDays: (v) => Number.isInteger(v) && v >= 1 && v <= 7,
  meetingAlert: (v) => [0, 'event', 1, 5, 10].includes(v),
  meetingTimer: (v) => typeof v === 'boolean',
};

class Settings extends EventEmitter {
  constructor() {
    super();
    this.values = { ...DEFAULTS, ...this.#load() };
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      return Object.fromEntries(Object.entries(raw).filter(([k, v]) => VALID[k]?.(v)));
    } catch {
      return {};
    }
  }

  get() {
    return this.values;
  }

  /** Applies the valid, changed keys of `patch`; emits 'change' (values, changedKeys). */
  update(patch) {
    const changed = Object.entries(patch ?? {}).filter(
      ([k, v]) => VALID[k]?.(v) && JSON.stringify(v) !== JSON.stringify(this.values[k]),
    );
    if (!changed.length) return false;
    this.values = { ...this.values, ...Object.fromEntries(changed) };
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(this.values, null, 2));
      fs.renameSync(`${FILE}.tmp`, FILE);
    } catch (err) {
      log.warn('[settings] could not save:', err.message);
    }
    this.emit('change', this.values, changed.map(([k]) => k));
    return true;
  }
}

export const settings = new Settings();
