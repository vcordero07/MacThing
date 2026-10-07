<script setup>
import { computed, ref } from 'vue';
import { state, CT } from '../state.js';
import LeftRail from '../components/LeftRail.vue';
import ScreenStage from '../components/ScreenStage.vue';
import SettingsRow from '../components/SettingsRow.vue';
const rows = [
  { key: 'theme', label: 'Appearance', options: [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Match Mac']] },
  { key: 'artBackground', label: 'Album art background', options: [[false, 'Off'], [true, 'On']] },
  { key: 'rotateEvery', label: 'Auto-rotate', options: [[0, 'Off'], [60, '1 min'], [120, '2 min']] },
  { key: 'digitalSeconds', label: 'Digital seconds', options: [[true, 'On'], [false, 'Off']] },
  { key: 'digitalLarge', label: 'Digital size', options: [[false, 'Regular'], [true, 'Large']] },
  { key: 'meetingAlert', label: 'Meeting alerts', options: [[0, 'Off'], ['event', 'Event’s alert'], [1, '1 min before'], [5, '5 min before'], [10, '10 min before']] },
  { key: 'meetingTimer', label: 'Meeting timer', options: [[false, 'Off'], [true, 'Auto-start']] },
  { label: 'Weather location', page: 'location', value: s => s.location && s.location.mode === 'manual' ? s.location.name : 'Current location' },
  { label: 'More settings on Mac', page: '', value: () => '' }
];
const selected = ref(0);
// Six rows fit the stage; past that the list scrolls to keep the selection in view.
const VISIBLE = 6;
const scrolled = computed(() => Math.max(0, selected.value - (VISIBLE - 1)));
const index = row => Math.max(0, row.options.findIndex(option => option[0] === state.settings[row.key]));
const value = row => row.value ? row.value(state.settings) : row.options[index(row)][1];
const screen = CT.screen('settings');
screen.show = () => { selected.value = 0; };
screen.turn = steps => { selected.value = Math.max(0, Math.min(rows.length - 1, selected.value + steps)); };
screen.press = () => {
  const row = rows[selected.value];
  if (row.page != null) { CT.send({ type: 'openSettingsPage', section: row.page }); CT.toast('Opened on your Mac'); return; }
  const next = row.options[(index(row) + 1) % row.options.length][0];
  state.settings[row.key] = next;
  CT.send({ type: 'setting', key: row.key, value: next });
  CT.applyTheme();
};
</script>
<template>
  <section id="screen-settings" class="screen fill flex" :class="{ active: state.current === 'settings', leaving: state.leaving === 'settings' }">
    <LeftRail title="Settings" variant="instructions">
      <template #subtitle>Turn the knob to choose.<br />Press it to change.</template>
    </LeftRail>
    <ScreenStage class="bg-panel"><div class="s-list"><div class="s-rows" :style="{ transform: 'translateY(' + -scrolled * 64 + 'px)' }">
      <SettingsRow v-for="(row, i) in rows" :key="row.label" :label="row.label" :value="value(row)" :selected="selected === i" :link="row.page != null" />
    </div></div></ScreenStage>
  </section>
</template>
