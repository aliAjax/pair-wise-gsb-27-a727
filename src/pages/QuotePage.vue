<script setup lang="ts">
import { computed, reactive, ref } from "vue";

import { calcFreight } from "../detention/rules";
import {
  addQuote,
  advanceQuote,
  quoteStatuses,
  quotedQuotes,
  quoteUsedByDelegation,
  removeQuote,
  state
} from "../detention/storage";
import { formatMoney } from "../detention/rules";

const emit = defineEmits<{ (event: "create-delegation", quoteId: string): void }>();

const filters = ["全部服务", "标准达", "次日达", "冷链"] as const;
const filter = ref<(typeof filters)[number]>("全部服务");

const services = ["标准达", "次日达", "冷链"] as const;
const form = reactive({ customer: "", route: "", weight: 0, service: "" as string });
const notes = ref("");

const routeNames = computed(() => state.routes.map((route) => route.name));

const previewFee = computed(() =>
  form.service ? calcFreight(Number(form.weight) || 0, form.service) : null
);

const filteredQuotes = computed(() => {
  if (filter.value.startsWith("全部")) return state.quotes;
  return state.quotes.filter((quote) => quote.service === filter.value);
});

const statusCount = (status: string) => state.quotes.filter((quote) => quote.status === status).length;

function submit() {
  addQuote({
    customer: form.customer,
    route: form.route,
    weight: Number(form.weight) || 0,
    service: form.service,
    notes: notes.value || "暂无备注"
  });
  form.customer = "";
  form.route = "";
  form.weight = 0;
  form.service = "";
  notes.value = "";
}

function canUse(quoteId: string): boolean {
  return quotedQuotes().some((quote) => quote.id === quoteId);
}
</script>

<template>
  <section class="workspace">
    <form class="panel" @submit.prevent="submit">
      <h2>运费试算与报价</h2>
      <div class="form-grid">
        <label>
          客户名称
          <input v-model="form.customer" required placeholder="请输入客户名称" />
        </label>
        <label>
          运输线路
          <input v-model="form.route" list="route-options" required placeholder="选择或填写线路" />
          <datalist id="route-options">
            <option v-for="name in routeNames" :key="name" :value="name" />
          </datalist>
        </label>
        <label>
          重量kg
          <input v-model.number="form.weight" type="number" min="0" step="1" required />
        </label>
        <label>
          服务类型
          <select v-model="form.service" required>
            <option value="">请选择</option>
            <option v-for="item in services" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label>
          备注
          <textarea v-model="notes" placeholder="填写处理说明或现场备注" />
        </label>
        <div v-if="previewFee !== null" class="fee-preview">试算运费：{{ formatMoney(previewFee) }}</div>
        <button type="submit">计算并保存</button>
      </div>
      <p class="hint">报价需经「流转状态」变为「已报价」后，才能在委托台生成运输委托。</p>
    </form>

    <section class="list-panel">
      <div class="toolbar">
        <h2>报价列表</h2>
        <select v-model="filter">
          <option v-for="item in filters" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>

      <div class="metrics compact">
        <article class="metric"><span>报价数</span><strong>{{ state.quotes.length }}</strong></article>
        <article class="metric"><span>已报价</span><strong>{{ statusCount("已报价") }}</strong></article>
        <article class="metric"><span>草稿</span><strong>{{ statusCount("草稿") }}</strong></article>
      </div>

      <div class="record-grid">
        <div v-if="filteredQuotes.length === 0" class="empty">暂无匹配数据</div>
        <article v-for="quote in filteredQuotes" :key="quote.id" class="record">
          <div class="record-head">
            <p class="record-title">{{ quote.customer }} / {{ quote.route }}</p>
            <span class="status">{{ quote.status }}</span>
          </div>
          <div class="details">
            <span>重量: {{ quote.weight }}kg</span>
            <span>服务: {{ quote.service }}</span>
            <span>确认运费: <b>{{ formatMoney(quote.fee) }}</b></span>
            <span v-if="quoteUsedByDelegation(quote.id)" class="linked">已生成委托</span>
          </div>
          <p class="note">{{ quote.notes }}</p>
          <div class="actions">
            <button type="button" @click="advanceQuote(quote.id)">
              流转至{{ quoteStatuses[(quoteStatuses.indexOf(quote.status as never) + 1) % quoteStatuses.length] }}
            </button>
            <button type="button" :disabled="!canUse(quote.id)" @click="emit('create-delegation', quote.id)">
              生成运输委托
            </button>
            <button class="secondary" type="button" @click="navigator.clipboard?.writeText(`${quote.customer}/${quote.route}`)">
              复制摘要
            </button>
            <button class="danger" type="button" @click="removeQuote(quote.id)">删除</button>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>
