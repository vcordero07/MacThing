<script setup>
import { computed, reactive, watch } from 'vue';
import { state, CT } from '../state.js';
// Settings → Meeting alerts: a card over every screen from a timed event's alert (its own, from
// the Mac's Calendar, or a fixed few minutes before) until a few minutes after it starts. Any button or knob press dismisses it (and does nothing
// else); turning the knob still sets the volume.
const AFTER_START_MS = 5 * 60000;
// Of an event's own alerts, only those in the last hour count: a "1 day before" alert is a
// reminder, not a reason to cover the screen for a day.
const EVENT_ALERT_MAX_MS = 60 * 60000;
const STORE = 'ct-dismissed-meetings';
const keyOf = e => (e.calendarId || '') + '|' + e.start + '|' + (e.title || '');
// Kept across page reloads (dev, a bridge restart) so a dismissed alert doesn't come back.
const dismissed = reactive(load());
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
}
function save() {
  Object.keys(dismissed).forEach(key => { if (dismissed[key] < state.now) delete dismissed[key]; });
  try { localStorage.setItem(STORE, JSON.stringify(dismissed)); } catch (e) {}
}
// Every timed event whose card is due now. It never outlasts the meeting (bar a zero-length one).
// How long before the start an event's card appears, or null for no card. "At time of event" is 0.
function leadMs(e, setting) {
  if (setting !== 'event') return setting * 60000;
  const leads = (e.alerts || []).filter(ms => ms <= EVENT_ALERT_MAX_MS).map(ms => Math.max(0, ms));
  return leads.length ? Math.max.apply(null, leads) : null;
}
const due = computed(() => {
  const setting = state.settings.meetingAlert;
  if (!setting || state.calendar.status !== 'ok') return [];
  return state.calendar.events.filter(e => {
    if (e.allDay || dismissed[keyOf(e)]) return false;
    const lead = leadMs(e, setting);
    // A zero-length event (a reminder at 6:34) keeps its card for the full five minutes.
    const until = e.end > e.start ? Math.min(e.end, e.start + AFTER_START_MS) : e.start + AFTER_START_MS;
    return lead != null && e.start - lead <= state.now && state.now < until;
  });
});
// One meeting at a time: the card shows the first, and a press dismisses all of them, so
// overlapping meetings don't bring up another card straight after.
const event = computed(() => due.value[0] || null);
watch(event, (value) => { state.alertCover = !!value; }, { immediate: true });
CT.dismissModal = () => {
  if (!event.value) return false;
  due.value.forEach(e => { dismissed[keyOf(e)] = e.start + AFTER_START_MS; });
  save();
  return true;
};
const when = computed(() => {
  const minutes = Math.round((event.value.start - state.now) / 60000);
  if (minutes > 0) return 'In ' + minutes + ' min';
  if (minutes < 0) return 'Started ' + -minutes + ' min ago';
  return 'Starting now';
});
// "2:00 – 2:30 PM", keeping both AM/PMs only when the meeting spans noon or midnight; just
// "2:00 PM" for a zero-length event.
const range = computed(() => {
  if (event.value.end <= event.value.start) return CT.timeText(event.value.start);
  const start = CT.clockText(CT.parts(event.value.start)), end = CT.clockText(CT.parts(event.value.end));
  return (start.ampm === end.ampm ? start.time : start.time + ' ' + start.ampm) + ' – ' + end.time + (end.ampm ? ' ' + end.ampm : '');
});
// A video call's location is its link (with a passcode in it, often): show the service instead.
const SERVICES = [[/(^|\.)zoom\.us$/, 'Zoom'], [/^meet\.google\.com$/, 'Google Meet'], [/^teams\.(microsoft|live)\.com$/, 'Microsoft Teams'], [/(^|\.)webex\.com$/, 'Webex'], [/^facetime\.apple\.com$/, 'FaceTime']];
function place(location) {
  const line = (location || '').split('\n')[0].trim();
  const link = /^https?:\/\/([^/?#]+)/i.exec(line);
  if (!link) return line;
  const host = link[1].toLowerCase().replace(/^www\./, '');
  const service = SERVICES.find(s => s[0].test(host));
  return service ? service[1] : host;
}
// With no location, a call link from the event's URL or notes (the helper finds it) says where.
const where = computed(() => place(event.value.location) || place(event.value.call));
</script>
<template>
  <div class="meeting-alert fill flex center" :class="{ on: !!event }">
    <div v-if="event" class="m-card flex-col">
      <div class="flex">
        <div class="m-bar flex-none" :style="{ background: event.color }" />
        <div class="flex-1 flex-col">
          <div class="m-title clamp-2">{{ event.title || 'Untitled' }}</div>
          <div class="m-range m-detail secondary tabular">{{ range }}</div>
          <div v-if="where" class="m-where m-detail muted truncate">{{ where }}</div>
        </div>
      </div>
      <div class="m-when">{{ when }}</div>
    </div>
  </div>
</template>
