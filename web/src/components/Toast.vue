<template>
  <div :class="['toast', { show: visible }]">{{ message }}</div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const visible = ref(false);
const message = ref('');
let timer: any = null;

function show(msg: string) {
  message.value = msg;
  visible.value = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    visible.value = false;
  }, 2000);
}

defineExpose({
  show,
});
</script>

<style scoped>
.toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: #0f172a;
  color: #ffffff;
  padding: 8px 14px;
  border-radius: 5px;
  font-size: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  display: none;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.toast.show {
  display: block;
  opacity: 1;
}
</style>
