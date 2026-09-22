<script setup lang="ts">
import { reactive, ref } from "vue";

import { addRoute, removeRoute, state } from "../detention/storage";
import { formatMoney } from "../detention/rules";

const form = reactive({
  name: "",
  freeHours: 2,
  hourlyRate: 100,
  cap: 500
});

const error = ref("");

function submit() {
  error.value = "";
  if (!form.name.trim()) {
    error.value = "请填写线路名称";
    return;
  }
  if (state.routes.some((route) => route.name === form.name.trim())) {
    error.value = "线路已登记，请勿重复";
    return;
  }
  if (form.freeHours < 0 || form.hourlyRate <= 0 || form.cap < 0) {
    error.value = "免费时段、小时费率和费用上限需为非负数，且费率大于 0";
    return;
  }
  addRoute({
    name: form.name.trim(),
    freeHours: Number(form.freeHours),
    hourlyRate: Number(form.hourlyRate),
    cap: Number(form.cap)
  });
  form.name = "";
}
</script>

<template>
  <section class="workspace">
    <form class="panel" @submit.prevent="submit">
      <h2>登记滞留线路</h2>
      <div class="form-grid">
        <label>
          线路名称
          <input v-model="form.name" required placeholder="如：上海-南京" />
        </label>
        <label>
          免费等待小时
          <input v-model.number="form.freeHours" type="number" min="0" step="1" required />
        </label>
        <label>
          超时费率（元/小时）
          <input v-model.number="form.hourlyRate" type="number" min="0" step="10" required />
        </label>
        <label>
          滞留费上限（元）
          <input v-model.number="form.cap" type="number" min="0" step="50" required />
        </label>
        <p v-if="error" class="banner error">{{ error }}</p>
        <button type="submit">登记线路</button>
      </div>
      <p class="hint">规则：超出免费时段按小时费率计费；费用超过线路上限的部分不得确认。</p>
    </form>

    <section class="list-panel">
      <div class="toolbar"><h2>已登记线路（{{ state.routes.length }}）</h2></div>
      <div class="record-grid">
        <div v-if="state.routes.length === 0" class="empty">暂无线路，请先登记</div>
        <article v-for="route in state.routes" :key="route.id" class="record">
          <div class="record-head">
            <p class="record-title">{{ route.name }}</p>
            <span class="status neutral">上限 {{ formatMoney(route.cap) }}</span>
          </div>
          <div class="details">
            <span>免费等待: {{ route.freeHours }} 小时</span>
            <span>超时费率: {{ formatMoney(route.hourlyRate) }}/小时</span>
          </div>
          <div class="actions">
            <button class="danger" type="button" @click="removeRoute(route.id)">删除线路</button>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>
