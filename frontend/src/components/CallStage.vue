<script setup lang="ts">
import PeerMedia from './PeerMedia.vue'
import type { PeerTile } from '../composables/useCall'

defineProps<{
  localStream: MediaStream | null
  localLabel: string
  tiles: PeerTile[]
}>()
</script>

<template>
  <div class="call-stage">
    <PeerMedia :stream="localStream" :label="`${localLabel} (you)`" muted />
    <PeerMedia
      v-for="tile in tiles"
      :key="tile.memberId"
      :stream="tile.stream"
      :label="tile.username || tile.memberId"
    />
  </div>
</template>
