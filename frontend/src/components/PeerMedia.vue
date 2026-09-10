<script setup lang="ts">
import { ref, watchEffect } from 'vue'

const props = defineProps<{
  stream: MediaStream | null
  label: string
  muted?: boolean
}>()

const element = ref<HTMLVideoElement | null>(null)

watchEffect(() => {
  if (element.value) {
    element.value.srcObject = props.stream
  }
})
</script>

<template>
  <figure class="peer-media">
    <video ref="element" autoplay playsinline :muted="muted"></video>
    <figcaption class="peer-media__label">{{ label }}</figcaption>
  </figure>
</template>
