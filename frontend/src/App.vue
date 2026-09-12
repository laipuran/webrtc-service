<script setup lang="ts">
import CallStage from './components/CallStage.vue'
import JoinForm from './components/JoinForm.vue'
import { useCall } from './composables/useCall'

const SIGNALING_URL = `wss://${location.host}/ws`
const isDev = import.meta.env.DEV

const {
  status,
  errorMessage,
  selfId,
  selfUsername,
  tiles,
  localStream,
  muted,
  join,
  leave,
  toggleMute,
} = useCall(SIGNALING_URL)
</script>

<template>
  <main class="app">
    <h1>WebRTC Call</h1>

    <p v-if="errorMessage" class="app__error">{{ errorMessage }}</p>

    <JoinForm v-if="status === 'idle' || status === 'error'" @join="join" />
    <p v-else-if="status === 'connecting'">Connecting…</p>

    <template v-else>
      <div class="app__toolbar">
        <span v-if="isDev">You: {{ selfUsername }} ({{ selfId }})</span>
        <span v-else>You: {{ selfUsername }}</span>
        <button type="button" @click="toggleMute">
          {{ muted ? 'Unmute' : 'Mute' }}
        </button>
        <button type="button" @click="leave">Leave</button>
      </div>
      <CallStage
        :local-stream="localStream"
        :local-label="selfUsername || 'you'"
        :tiles="tiles"
      />
    </template>
  </main>
</template>
