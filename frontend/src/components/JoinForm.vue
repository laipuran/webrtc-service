<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  join: [roomId: string, auth: string, username: string]
}>()

const roomId = ref('')
const auth = ref('')
const username = ref('')

function submit(): void {
  if (!roomId.value || !auth.value || !username.value) {
    return
  }
  emit('join', roomId.value, auth.value, username.value)
}
</script>

<template>
  <form class="join-form" @submit.prevent="submit">
    <label>
      Room ID
      <input v-model="roomId" placeholder="e.g. demo" />
    </label>
    <label>
      Room Key
      <input v-model="auth" placeholder="shared secret" />
    </label>
    <label>
      Display name
      <input v-model="username" placeholder="your name" />
    </label>
    <button type="submit">Join</button>
  </form>
</template>
