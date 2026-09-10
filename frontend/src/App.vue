<script setup lang="ts">
import CallStage from './components/CallStage.vue'
import JoinForm from './components/JoinForm.vue'
import { useCall } from './composables/useCall'

const SIGNALING_URL = 'ws://127.0.0.1:9001'

const {
  status,
  errorMessage,
  selfId,
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
        <span>You: {{ selfId }}</span>
        <button type="button" @click="toggleMute">
          {{ muted ? 'Unmute' : 'Mute' }}
        </button>
        <button type="button" @click="leave">Leave</button>
      </div>
      <CallStage
        :local-stream="localStream"
        :local-label="selfId ?? 'you'"
        :tiles="tiles"
      />
    </template>
  </main>
</template>
