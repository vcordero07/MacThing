<script setup>
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { state, CT, elapsed, durationText, artworkUrl, artworkDirection, hasArt } from '../state.js';
import LeftRail from '../components/LeftRail.vue';
import ScreenStage from '../components/ScreenStage.vue';
import UiProgress from '../components/UiProgress.vue';
import AnalogClock from '../components/AnalogClock.vue';
import Artwork from '../components/Artwork.vue';
const root = ref(null), rail = ref(null);
const np = computed(() => state.np);
const album = computed(() => !np.value.active ? '' : np.value.album || (np.value.kind !== 'music' && np.value.source ? np.value.source.name : '') || '');
const icon = computed(() => np.value.active && np.value.source ? np.value.source.icon : '');
const fraction = ref(0);
function updateProgress() { fraction.value = np.value.duration ? elapsed() / np.value.duration : 0; }
// Measured typography is the only imperative layout here. These inline values
// deliberately override .np-title's fallback font-size/line-height.

/** Width of the title's widest word at the size currently set on it. */
function widestWord(t, words) {
  const probe = document.createElement('span');
  // Absolute and hidden: it measures inside the title's own font without joining its lines.
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:0;top:0';
  t.appendChild(probe);
  let widest = 0;
  for (const word of words) {
    probe.textContent = word;
    widest = Math.max(widest, probe.offsetWidth);
  }
  t.removeChild(probe);
  return widest;
}

function fitTitle() {
  const t = rail.value && rail.value.titleElement;
  if (!t || !root.value) return;
  const content = root.value.querySelector('.left-rail-content');
  t.style.webkitLineClamp = '';
  t.classList.remove('break-word');
  if (!np.value.active) { t.style.fontSize = '32px'; t.style.lineHeight = '40px'; return; }
  // The browser can wrap after a hyphen or en dash, so "Three-Legged" is measured as "Three-"
  // and "Legged" rather than as one word.
  const words = (t.textContent || '').match(/[^\s\-‐–]+[\-‐–]*|[\-‐–]+/g) || [];
  const scale = [[48, 64], [40, 56], [28, 36]];
  // A title is sized down until it fits the rail's height *and* its longest word fits the
  // rail's width: splitting a word across lines reads worse than a smaller title.
  for (const [size, line] of scale) {
    t.style.fontSize = size + 'px'; t.style.lineHeight = line + 'px';
    const last = rail.value.subtitleElement || t;
    if (widestWord(t, words) <= t.clientWidth
      && last.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom
      && t.offsetHeight <= line * 5.01) return;
  }
  // Nothing fit: keep the smallest size, and only now allow a word to break.
  if (widestWord(t, words) > t.clientWidth) t.classList.add('break-word');
  const last = rail.value.subtitleElement || t;
  const overflow = Math.max(0, last.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom);
  t.style.webkitLineClamp = String(Math.max(1, Math.min(5, Math.floor((t.offsetHeight - overflow) / 36))));
}
watch(() => [np.value.active, np.value.artist, np.value.title, album.value, state.current], () => nextTick(fitTitle));
watch(() => [state.np, state.npAt], updateProgress);
const screen = CT.screen('nowplaying');
screen.show = () => { updateProgress(); nextTick(fitTitle); };
let timer;
onMounted(() => {
  fitTitle();
  timer = setInterval(() => { if (state.current === 'nowplaying' && !state.asleep) updateProgress(); }, 250);
  if (document.fonts) document.fonts.ready.then(fitTitle);
});
onUnmounted(() => clearInterval(timer));
</script>
<template>
  <section ref="root" id="screen-nowplaying" class="screen fill flex" :class="{ active: state.current === 'nowplaying', leaving: state.leaving === 'nowplaying', idle: !np.active, paused: np.active && !np.playing, 'no-duration': !np.duration, 'art-wide': state.settings.artFit === 'wide' }">
    <LeftRail ref="rail" variant="media" :eyebrow="np.active ? np.artist : ''" :title="np.active ? np.title : 'Nothing playing'" :subtitle="album" :muted-subtitle="!np.album">
      <template #lower>
        <div class="np-progress flex items-center gap-8 primary"><UiProgress :value="fraction" /><span class="np-duration flex-none regular">{{ np.duration ? durationText(np.duration) : '' }}</span></div>
      </template>
    </LeftRail>
    <ScreenStage :class="{ 'bg-panel': !np.active || hasArt }"><!-- idle, or behind art: one continuous background, so nothing is left as a square when the art fades -->
      <Artwork :url="artworkUrl" :direction="artworkDirection" />
      <AnalogClock v-if="!np.active" :now="state.current === 'nowplaying' ? state.now : 0" />
      <div class="paused-glyph disc fill flex center" :style="{ color: state.flashing ? state.flash.color : '' }"><svg><use :href="'#i-' + (state.flashing ? state.flash.icon : 'pause')" /></svg></div><!-- a flash here swaps its icon into this badge for a moment, in place of a second disc -->
      <img v-if="icon" class="badge" :src="icon" alt="" />
    </ScreenStage>
  </section>
</template>
