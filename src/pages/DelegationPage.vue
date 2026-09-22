<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import {
  RESPONSIBLE_PARTIES,
  calcDetention,
  formatMoney,
  type ResponsibleParty
} from "../detention/rules";
import {
  createDelegation,
  payableOf,
  quotedQuotes,
  state
} from "../detention/storage";
import DelegationCard from "./DelegationCard.vue";

const props = defineProps<{ preselectQuoteId?: string }>();

const filters = ["全部", "待复核", "已确认", "已结算"] as const;
const filter = ref<(typeof filters)[number]>("全部");

const form = reactive({
  quoteId: "",
  start: "",
  end: "",
  party: "系统" as ResponsibleParty,
  cap: 0
});
const error = ref("");

watch(
  () => props.preselectQuoteId,
  (id) => {
    if (id) form.quoteId = id;
  },
  { immediate: true }
);

const eligibleQuotes = computed(() => quotedQuotes());

const selectedQuote = computed(() => state.quotes.find((quote) => quote.id === form.quoteId));
const selectedRoute = computed(() =>
  selectedQuote.value ? state.routes.find((route) => route.name === selectedQuote.value!.route) : undefined
);

watch(
  selectedRoute,
  (route) => {
    if (route) form.cap = route.cap;
  },
  { immediate: true }
);

const preview = computed(() => {
  if (!form.start || !form.end || !selectedRoute.value) return null;
  return calcDetention(form.start, form.end, {
    freeHours: selectedRoute.value.freeHours,
    hourlyRate: selectedRoute.value.hourlyRate,
    cap: Number(form.cap) || 0
  });
});

const filteredDelegations = computed(() => {
  if (filter.value === "全部") return state.delegations;
  return state.delegations.filter((delegation) => delegation.status === filter.value);
});

const count = (status: string) => state.delegations.filter((delegation) => delegation.status === status).length;
const pendingPayable = computed(() =>
  state.delegations
    .filter((delegation) => delegation.status === "已确认")
    .reduce((acc, delegation) => acc + payableOf(delegation), 0)
);
const frozenPayable = computed(() =>
  state.delegations
    .filter((delegation) => delegation.status === "已结算")
    .reduce((acc, delegation) => acc + payableOf(delegation), 0)
);

function submit() {
  error.value = "";
  if (!form.quoteId) {
    error.value = "请选择已报价记录（只有已报价记录才能生成委托）";
    return;
  }
  if (!form.start || !form.end || new Date(form.end).getTime() <= new Date(form.start).getTime()) {
    error.value = "请填写有效的等待起止时间";
    return;
  }
  if (form.cap < 0) {
    error.value = "费用上限不能为负";
    return;
  }
  try {
    createDelegation({
      quoteId: form.quoteId,
      start: form.start,
      end: form.end,
      party: form.party,
      cap: Number(form.cap)
    });
    form.quoteId = "";
    form.start = "";
    form.end = "";
    form.cap = 0;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}
</script>

<template>
  <section class="desk">
    <section class="metrics">
      <article class="metric"><span>委托总数</span><strong>{{ state.delegations.length }}</strong></article>
      <article class="metric"><span>待复核</span><strong>{{ count("待复核") }}</strong></article>
      <article class="metric"><span>已确认待结算</span><strong>{{ count("已确认") }}</strong></article>
      <article class="metric"><span>已结算冻结</span><strong>{{ count("已结算") }}</strong></article>
      <article class="metric"><span>待结算应付</span><strong>{{ formatMoney(pendingPayable) }}</strong></article>
      <article class="metric"><span>已冻结金额</span><strong>{{ formatMoney(frozenPayable) }}</strong></article>
    </section>

    <section class="workspace single">
      <form class="panel" @submit.prevent="submit">
        <h2>登记运输委托</h2>
        <div class="form-grid">
          <label>
            已报价记录
            <select v-model="form.quoteId" required>
              <option value="">请选择</option>
              <option v-for="quote in eligibleQuotes" :key="quote.id" :value="quote.id">
                {{ quote.customer }} / {{ quote.route }} / {{ quote.service }} / {{ formatMoney(quote.fee) }}
              </option>
            </select>
          </label>
          <p v-if="eligibleQuotes.length === 0" class="banner warn">没有「已报价」记录，请先在报价页试算并流转状态。</p>
          <label v-if="selectedQuote">
            登记线路规则
            <input :value="`${selectedQuote.route}：免费 ${selectedRoute?.freeHours ?? '—'} 小时，${selectedRoute ? formatMoney(selectedRoute.hourlyRate) : '—'}/小时`" disabled />
          </label>
          <label>
            等待开始
            <input v-model="form.start" type="datetime-local" required />
          </label>
          <label>
            等待结束
            <input v-model="form.end" type="datetime-local" required />
          </label>
          <label>
            责任方
            <select v-model="form.party">
              <option v-for="party in RESPONSIBLE_PARTIES" :key="party" :value="party">{{ party }}</option>
            </select>
          </label>
          <label>
            滞留费上限（元）
            <input v-model.number="form.cap" type="number" min="0" step="50" required />
          </label>

          <div v-if="preview" class="fee-preview" :class="{ warning: preview.capped }">
            <span>等待 {{ preview.waitingHours }} 小时，免费 {{ preview.freeHours }} 小时，计费 {{ preview.chargeableHours }} 小时</span>
            <span>原值 {{ formatMoney(preview.rawAmount) }}</span>
            <span v-if="preview.capped">超限！按上限确认 {{ formatMoney(preview.amount) }}，超限部分不得确认</span>
            <span v-else>可确认 {{ formatMoney(preview.amount) }}</span>
          </div>

          <p v-if="error" class="banner error">{{ error }}</p>
          <button type="submit">生成委托</button>
        </div>
        <p class="hint">
          系统原因须附线路公告，客户原因须附签收记录，凭据缺失时留待复核；
          非系统责任减免不超过已确认运费两成，系统责任可全额减免。
        </p>
      </form>

      <section class="list-panel">
        <div class="toolbar">
          <h2>滞留费责任确认与减免</h2>
          <select v-model="filter">
            <option v-for="item in filters" :key="item" :value="item">{{ item }}</option>
          </select>
        </div>
        <div class="record-grid">
          <div v-if="filteredDelegations.length === 0" class="empty">暂无委托</div>
          <DelegationCard v-for="delegation in filteredDelegations" :key="delegation.id" :delegation="delegation" />
        </div>
      </section>
    </section>
  </section>
</template>
