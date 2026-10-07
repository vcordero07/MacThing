<script setup>
import { computed, ref, watch } from 'vue';
import { state, hasArt, ambientUrl, ambientPreBlurred, ambientTint, artworkDirection } from './state.js';
import { flatColor } from './palette.js';
import Artwork from './components/Artwork.vue';
import IconSymbols from './components/IconSymbols.vue';
import UiProgress from './components/UiProgress.vue';
import NowPlayingScreen from './screens/NowPlayingScreen.vue';
import CalendarScreen from './screens/CalendarScreen.vue';
import WeatherScreen from './screens/WeatherScreen.vue';
import ClockScreen from './screens/ClockScreen.vue';
import SettingsScreen from './screens/SettingsScreen.vue';
import MeetingAlert from './components/MeetingAlert.vue';
// The paused badge on Now Playing shows flashes itself (it swaps its icon), so the flash's own disc stays hidden.
const pausedBadge = computed(() => state.current === 'nowplaying' && state.np.active && !state.np.playing);
const background = computed(() => {
  const mode = state.settings.background;
  if (mode === 'art' || mode === 'color' || mode === 'off') return mode;
  return state.settings.artBackground ? 'art' : 'off';
});
const ambient = computed(() => background.value === 'art' && hasArt.value);
const flat = computed(() => (background.value === 'color' ? flatColor(state.settings.flatColor) || flatColor('blue') : null));
const NOTCHED = ['nowplaying', 'calendar', 'weather', 'clock']; // left to right, as the top buttons run
// Settings has no top button, so the notch stays under the last page's while it fades out.
const notchAt = ref(Math.max(0, NOTCHED.indexOf(state.current)));
watch(() => state.current, current => { if (NOTCHED.includes(current)) notchAt.value = NOTCHED.indexOf(current); });
</script>
<template>
  <IconSymbols />
  <div id="app" :data-screen="state.current" :data-ink="flat ? state.settings.fontColor : null" :style="flat ? { '--flat': flat.hex } : null" :class="{ offline: state.offline, asleep: state.asleep, light: state.light, 'ambient-on': ambient, 'flat-on': !!flat, 'show-volume': state.showVolume, 'volume-unsupported': state.volumeUnsupported }">
    <div v-if="ambient" class="ambient fill" :class="{ 'pre-blurred': ambientPreBlurred }"><Artwork :url="ambientUrl" :direction="artworkDirection" :tint="ambientTint" /></div>
    <div class="screens fill" :data-switch="state.screenSwitch || null"><NowPlayingScreen /><CalendarScreen /><WeatherScreen /><ClockScreen /><SettingsScreen /></div>
    <div class="page-notch" :class="{ on: NOTCHED.includes(state.current) }" :style="{ transform: 'translateX(' + notchAt * 201 + 'px)' }" />
    <MeetingAlert />
    <div class="volume-hud fill flex items-center gap-16">
      <svg class="vol-icon flex-none"><use :href="state.volume === 0 ? '#i-muted' : '#i-speaker'" /></svg>
      <UiProgress v-show="!state.volumeUnsupported" :value="state.volume" /><span v-show="!state.volumeUnsupported" class="vol-value flex-none text-right tabular font-small semibold">{{ Math.round(state.volume * 100) }}</span><span v-show="state.volumeUnsupported" class="font-small weight-light truncate">{{ state.volumeNote }}</span>
    </div>
    <div :key="state.flash.key" class="flash disc flex center" :class="{ on: state.flash.key > 0 && !pausedBadge }" :style="{ color: state.flash.color }"><svg><use :href="'#i-' + state.flash.icon" /></svg></div>
    <div class="toast" :class="{ on: !!state.toast }">{{ state.toast }}</div>
    <div class="offline-screen fill flex-col center"><div class="pulse" /><div class="mt-28 font-medium semibold">Waiting for your Mac</div><div class="mt-10 font-small weight-light muted">Connect by USB and start the bridge</div></div>
  </div>
</template>
