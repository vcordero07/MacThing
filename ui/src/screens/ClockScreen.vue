<script setup>
import { computed, ref, watch } from 'vue';
import { state, CT } from '../state.js';
import LeftRail from '../components/LeftRail.vue';
import ScreenStage from '../components/ScreenStage.vue';
import AnalogClock from '../components/AnalogClock.vue';
import TimeTimer from '../components/TimeTimer.vue';
import { timer, total, remaining, timerLabel, timerTitle, stepPreset, currentMeetingKey, pickMeeting, autoStartMeeting, toggleTimer, resetTimer, clearTimer } from '../timer.js';
const parts = computed(() => CT.parts(state.now));
const face = computed(() => state.settings.clockFace);
const time = computed(() => CT.clockText(parts.value));
const next = computed(() => state.calendar.status === 'ok' ? state.calendar.events.find(e => !e.allDay && e.start > state.now && CT.dayNumber(e.start) === CT.dayNumber(state.now)) : null);
// The clock button, pressed on the clock, swaps it for the timer and back. Knob and wheel work
// the timer only while it's up: turn to pick a length, press to start or pause, press twice to reset.
// During a meeting it opens set to the meeting's end, a stop just left of 5 minutes; reset there
// drops back to the preset, stopped.
const mode = ref('clock');
// Auto-rotate waits while a length is being picked, and while a timer is running, paused, or
// counting past its end. A preset that was never opened does not hold the other screens.
watch([mode, () => timer.status], () => {
  const status = timer.status;
  state.timerHold = status === 'running' || status === 'paused' || status === 'done' || (mode.value === 'timer' && status === 'set');
}, { immediate: true });
const screen = CT.screen('clock');
screen.reselect = () => {
  mode.value = mode.value === 'clock' ? 'timer' : 'clock';
  if (mode.value === 'timer') pickMeeting();
};
// While it's up and not started, a meeting that starts sets it too, as does one that turns up
// when the calendar first loads (after a reload that reopened the timer). With Settings → Meeting
// timer on, a meeting that starts (or is on when it's turned on) starts the timer, puts it up in
// place of the clock and switches to it — unless Settings is open on the device.
watch([currentMeetingKey, () => state.settings.meetingTimer], ([key]) => {
  if (!key) return;
  if (autoStartMeeting()) {
    mode.value = 'timer';
    if (state.current !== 'settings') CT.show('clock');
  } else if (mode.value === 'timer') pickMeeting();
});
// A finished timer counts up past its time until you leave it, then goes back to its preset.
watch(() => mode.value === 'timer' && state.current === 'clock', up => { if (!up && timer.status === 'done') resetTimer(); });
// A meeting's timer counts on past its end for ten minutes at most, then puts itself away.
const MEETING_OVERRUN_MS = 10 * 60000;
CT.onSecond(now => {
  if (timer.status !== 'done' || !timer.meeting || now - timer.endsAt < MEETING_OVERRUN_MS) return;
  resetTimer();
  mode.value = 'clock';
});
screen.turn = steps => {
  if (mode.value === 'clock' || timer.status === 'running' || timer.status === 'paused') return false;
  stepPreset(steps);
};
let lastPress = 0;
screen.press = () => {
  if (mode.value === 'clock') return false;
  const t = performance.now();
  if (t - lastPress < (CT.config.multiClickMs || 350)) { clearTimer(); lastPress = 0; } else { toggleTimer(); lastPress = t; }
};
</script>
<template>
  <section id="screen-clock" class="screen fill flex" :class="{ active: state.current === 'clock', leaving: state.leaving === 'clock', timer: mode === 'timer' }">
    <LeftRail :view="mode" :views="{ clock: { eyebrow: CT.MONTHS[parts.month], title: parts.date, subtitle: CT.DAYS[parts.day] }, timer: { eyebrow: timerLabel, title: timerTitle, subtitle: time.time } }">
      <template #lower>
        <template v-if="next">{{ CT.timeText(next.start) }} <b class="primary medium">{{ next.title }}</b></template><template v-else-if="state.calendar.status === 'ok'">No events today</template>
      </template>
    </LeftRail>
    <ScreenStage class="bg-panel">
      <!-- Both faces stay drawn and only fade (see .fade-view), so a press doesn't have to build and
           paint the incoming one while the other is fading out. -->
      <div class="fade-view c-view-timer fill" :class="{ on: mode === 'timer' }"><TimeTimer :remaining="remaining" :total="total" :idle="timer.status === 'set' && !timer.meeting" /></div>
      <div class="fade-view fill" :class="{ on: mode === 'clock' }">
        <AnalogClock v-if="face !== 'digital'" :numbers="face === 'numbers'" :now="state.current === 'clock' ? state.now : 0" />
        <div v-else class="c-digital fill tabular semibold" :class="{ 'flex gap-10': !state.settings.digitalLarge, 'c-digital-large': state.settings.digitalLarge, 'c-digital-hm': state.settings.digitalSeconds === false }"><span>{{ time.time }}</span><span v-if="state.settings.digitalSeconds !== false" class="c-digital-sec accent">{{ String(parts.seconds).padStart(2, '0') }}</span></div>
      </div>
    </ScreenStage>
  </section>
</template>
