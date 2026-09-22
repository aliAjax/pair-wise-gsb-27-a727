<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { storeToRefs } from "pinia";
import { useLogisticsStore } from "../stores/logistics";
import type { QuoteRecord, ServiceType } from "../logistics/types";

const emit = defineEmits<{ (event: "create-consignment", quoteId: string): void }>();

const store = useLogisticsStore();
const { quotes, consignments } = storeToRefs(store);

const statuses: QuoteRecord["status"][] = ["草稿", "已报价", "已复制"];
const filters = ["全部服务", "标准达", "次日达", "冷链"] as const;
const services: ServiceType[] = ["标准达", "次日达", "冷链"];

const form = reactive({
  customer: "",
  route: "",
  weight: 0,
  freight: 0,
  service: "" as ServiceType | "",
});
const note = ref("");
const filter = ref<string>(filters[0]);

const consignmentByQuote = computed(() => {
  const map = new Map<string, string>();
  for (const item of consignments.value) map.set(item.quoteId, item.code);
  return map;
});

const filteredRecords = computed(() => {
  if (filter.value.startsWith("全部")) return quotes.value;
  return quotes.value.filter((record) => record.service === filter.value);
});

const metrics = computed(() => [
  quotes.value.length,
  quotes.value.filter((record) => record.status === "已报价").length,
  quotes.value.length
    ? Math.round(quotes.value.reduce((sum, record) => sum + record.weight, 0) / quotes.value.length)
    : 0,
]);

const chartRows = computed(() =>
  statuses.map((status) => ({
    status,
    value: quotes.value.filter((record) => record.status === status).length,
  })),
);
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

function submit() {
  if (!form.service) return;
  store.addQuote({
    customer: form.customer,
    route: form.route,
    weight: Number(form.weight) || 0,
    freight: Number(form.freight) || 0,
    service: form.service,
    notes: note.value || "暂无备注",
  });
  Object.assign(form, { customer: "", route: "", weight: 0, freight: 0, service: "" });
  note.value = "";
}

function primaryText(record: QuoteRecord) {
  return [record.customer, record.route].filter(Boolean).join(" / ") || "报价";
}

function startConsignment(record: QuoteRecord) {
  emit("create-consignment", record.id);
}
</script>

<template>
  <section class="workspace">
    <form class="panel" @submit.prevent="submit">
      <h2>新增报价</h2>
      <div class="form-grid">
        <label>
          客户名称
          <input v-model="form.customer" required />
        </label>
        <label>
          运输线路
          <input v-model="form.route" placeholder="如 上海-南京" required />
        </label>
        <label>
          重量kg
          <input v-model.number="form.weight" type="number" min="0" required />
        </label>
        <label>
          已确认运费（元）
          <input v-model.number="form.freight" type="number" min="0" step="0.01" required />
        </label>
        <label>
          服务类型
          <select v-model="form.service" required>
            <option value="">请选择</option>
            <option v-for="option in services" :key="option">{{ option }}</option>
          </select>
        </label>
        <label>
          备注
          <textarea v-model="note" placeholder="填写处理说明或现场备注" />
        </label>
        <button type="submit">计算并保存</button>
      </div>
    </form>

    <section class="list-panel">
      <div class="toolbar">
        <h2>报价列表</h2>
        <select v-model="filter">
          <option v-for="item in filters" :key="item">{{ item }}</option>
        </select>
      </div>

      <div class="record-grid">
        <div v-if="filteredRecords.length === 0" class="empty">暂无匹配数据</div>
        <article v-for="record in filteredRecords" :key="record.id" class="record">
          <div class="record-head">
            <p class="record-title">{{ primaryText(record) }}</p>
            <span class="status" :class="`status-${record.status}`">{{ record.status }}</span>
          </div>
          <div class="details">
            <span>重量kg: {{ record.weight }}</span>
            <span>运费: ¥{{ record.freight.toFixed(2) }}</span>
            <span>服务: {{ record.service }}</span>
            <span v-if="consignmentByQuote.get(record.id)">
              委托: <strong>{{ consignmentByQuote.get(record.id) }}</strong>
            </span>
          </div>
          <p class="note">{{ record.notes }}</p>
          <div class="actions">
            <button type="button" @click="store.advanceQuoteStatus(record.id)">流转状态</button>
            <button class="secondary" type="button" @click="navigator.clipboard?.writeText(primaryText(record))">
              复制摘要
            </button>
            <button
              v-if="record.status === '已报价' && !consignmentByQuote.has(record.id)"
              class="accent"
              type="button"
              @click="startConsignment(record)"
            >
              生成运输委托
            </button>
            <button class="danger" type="button" @click="store.removeQuote(record.id)">删除</button>
          </div>
        </article>
      </div>

      <div class="mini-chart">
        <div v-for="row in chartRows" :key="row.status" class="bar">
          <span>{{ row.status }}</span>
          <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
          <strong>{{ row.value }}</strong>
        </div>
      </div>
    </section>
  </section>
</template>
