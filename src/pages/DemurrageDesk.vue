<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useLogisticsStore } from "../stores/logistics";
import ConsignmentCard from "../components/ConsignmentCard.vue";

const props = defineProps<{ draftQuoteId: string | null }>();
const emit = defineEmits<{ (event: "clear-draft"): void }>();

const store = useLogisticsStore();
const { quotes, consignments, routeRules, consignedQuoteIds } = storeToRefs(store);

// ---------------- 委托登记 ----------------

const draft = reactive({
  quoteId: "",
  waitStart: "",
  waitEnd: "",
  responsibleParty: "系统" as "系统" | "客户",
  cap: 0,
});
const createError = ref("");
const createHint = ref("");

const availableQuotes = computed(() =>
  store.quotedRecords.filter((quote) => !consignedQuoteIds.value.has(quote.id)),
);

const selectedQuote = computed(() => quotes.value.find((quote) => quote.id === draft.quoteId) ?? null);
const selectedRule = computed(() => (selectedQuote.value ? store.findRule(selectedQuote.value.route) : undefined));

watch(
  () => props.draftQuoteId,
  (id) => {
    if (id && availableQuotes.value.some((quote) => quote.id === id)) {
      draft.quoteId = id;
      syncCap();
    }
  },
  { immediate: true },
);

watch(
  () => draft.quoteId,
  () => syncCap(),
);

function syncCap() {
  const quote = quotes.value.find((item) => item.id === draft.quoteId);
  const rule = quote ? store.findRule(quote.route) : undefined;
  draft.cap = rule?.cap ?? 0;
}

function submitConsignment() {
  createError.value = "";
  createHint.value = "";
  if (!draft.quoteId) {
    createError.value = "请选择一条“已报价”记录";
    return;
  }
  if (!draft.waitStart || !draft.waitEnd) {
    createError.value = "请填写等待起止时间";
    return;
  }
  const result = store.createConsignment({
    quoteId: draft.quoteId,
    waitStart: draft.waitStart,
    waitEnd: draft.waitEnd,
    responsibleParty: draft.responsibleParty,
    cap: Number(draft.cap) || 0,
  });
  if (!result.ok) {
    createError.value = result.error;
    return;
  }
  createHint.value = `委托 ${result.data?.code ?? ""} 已生成，请在下方完成责任确认`;
  Object.assign(draft, { quoteId: "", waitStart: "", waitEnd: "", responsibleParty: "系统", cap: 0 });
  emit("clear-draft");
  statusFilter.value = "全部";
}

// ---------------- 线路规则登记 ----------------

const ruleForm = reactive({ route: "", freeHours: 2, hourlyRate: 60, cap: 500 });
const ruleError = ref("");
const ruleHint = ref("");

function submitRule() {
  ruleError.value = "";
  ruleHint.value = "";
  const result = store.registerRouteRule({
    route: ruleForm.route.trim(),
    freeHours: Number(ruleForm.freeHours),
    hourlyRate: Number(ruleForm.hourlyRate),
    cap: Number(ruleForm.cap),
  });
  if (!result.ok) {
    ruleError.value = result.error;
    return;
  }
  ruleHint.value = `线路“${ruleForm.route.trim()}”已登记/更新`;
  ruleForm.route = "";
}

// ---------------- 列表与指标 ----------------

const filters = ["全部", "待确认", "待复核", "已确认", "已结算"] as const;
const statusFilter = ref<(typeof filters)[number]>("全部");

function currentStatus(consignment: (typeof consignments.value)[number]): string {
  return consignment.versions[consignment.versions.length - 1].status;
}

const filteredConsignments = computed(() => {
  if (statusFilter.value === "全部") return consignments.value;
  return consignments.value.filter((item) => currentStatus(item) === statusFilter.value);
});

const metrics = computed(() => {
  let pending = 0;
  let review = 0;
  let settled = 0;
  let receivable = 0;
  for (const consignment of consignments.value) {
    const version = consignment.versions[consignment.versions.length - 1];
    if (version.status === "待确认") pending += 1;
    if (version.status === "待复核") review += 1;
    if (version.status === "已结算") settled += 1;
    const approved = consignment.reductions
      .filter((item) => item.version === version.version && item.status === "已减免")
      .reduce((sum, item) => sum + item.approvedAmount, 0);
    receivable += Math.max(0, version.confirmedAmount - approved);
  }
  return [
    { label: "委托总数", value: consignments.value.length },
    { label: "待确认 / 待复核", value: `${pending} / ${review}` },
    { label: "已结算冻结", value: settled },
    { label: "当前应收滞留费", value: `¥${receivable.toFixed(2)}` },
  ];
});

function routeCap(route: string): number | null {
  return store.findRule(route)?.cap ?? null;
}
</script>

<template>
  <section class="desk">
    <section class="metrics">
      <article v-for="item in metrics" :key="item.label" class="metric">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </article>
    </section>

    <section class="workspace desk-workspace">
      <form class="panel" @submit.prevent="submitConsignment">
        <h2>登记运输委托</h2>
        <p class="panel-tip">仅“已报价”记录可生成委托；一条报价只能生成一次。</p>
        <div class="form-grid">
          <label>
            已报价记录
            <select v-model="draft.quoteId" required>
              <option value="">请选择</option>
              <option v-for="quote in availableQuotes" :key="quote.id" :value="quote.id">
                {{ quote.customer }} / {{ quote.route }} / ¥{{ quote.freight.toFixed(2) }}
              </option>
            </select>
          </label>
          <p v-if="availableQuotes.length === 0" class="error-text">暂无可生成委托的已报价记录，请到费用试算页将报价流转为“已报价”。</p>
          <p v-else-if="selectedQuote && !selectedRule" class="error-text">
            线路“{{ selectedQuote.route }}”尚未登记规则，请先在下方登记，否则无法生成委托。
          </p>
          <p v-else-if="selectedRule" class="hint">
            线路规则：免费等待 {{ selectedRule.freeHours }} 小时，超时 ¥{{ selectedRule.hourlyRate }}/小时，
            上限 ¥{{ selectedRule.cap.toFixed(2) }}
          </p>
          <label>
            等待开始
            <input v-model="draft.waitStart" type="datetime-local" required />
          </label>
          <label>
            等待结束
            <input v-model="draft.waitEnd" type="datetime-local" required />
          </label>
          <label>
            责任方
            <select v-model="draft.responsibleParty">
              <option value="系统">系统责任（须附线路公告）</option>
              <option value="客户">客户责任（须附签收记录）</option>
            </select>
          </label>
          <label>
            费用上限（元）
            <input v-model.number="draft.cap" type="number" min="0" step="0.01" required />
          </label>
          <button type="submit" class="accent">生成委托</button>
          <p v-if="createError" class="error-text">{{ createError }}</p>
          <p v-if="createHint" class="hint">{{ createHint }}</p>
        </div>
      </form>

      <form class="panel" @submit.prevent="submitRule">
        <h2>登记滞留规则（按线路）</h2>
        <p class="panel-tip">免费时段内不计费；超出按整点进位、线路上限裁剪。</p>
        <div class="form-grid">
          <label>
            线路名称
            <input v-model="ruleForm.route" placeholder="如 成都-重庆" required />
          </label>
          <label>
            免费等待（小时）
            <input v-model.number="ruleForm.freeHours" type="number" min="0" step="0.5" required />
          </label>
          <label>
            超时单价（元/小时）
            <input v-model.number="ruleForm.hourlyRate" type="number" min="0" step="0.01" required />
          </label>
          <label>
            滞留费上限（元）
            <input v-model.number="ruleForm.cap" type="number" min="0" step="0.01" required />
          </label>
          <button type="submit" class="secondary">登记 / 更新线路</button>
          <p v-if="ruleError" class="error-text">{{ ruleError }}</p>
          <p v-if="ruleHint" class="hint">{{ ruleHint }}</p>
        </div>

        <div class="rule-table">
          <div v-for="rule in routeRules" :key="rule.route" class="rule-row">
            <strong>{{ rule.route }}</strong>
            <span>免费 {{ rule.freeHours }}h</span>
            <span>¥{{ rule.hourlyRate }}/h</span>
            <span>上限 ¥{{ rule.cap.toFixed(2) }}</span>
          </div>
        </div>
      </form>
    </section>

    <section class="list-panel consignment-list">
      <div class="toolbar">
        <h2>责任确认与减免台</h2>
        <select v-model="statusFilter">
          <option v-for="item in filters" :key="item">{{ item }}</option>
        </select>
      </div>
      <div class="record-grid">
        <div v-if="filteredConsignments.length === 0" class="empty">暂无委托，请从上方登记表单或费用试算页生成</div>
        <ConsignmentCard
          v-for="consignment in filteredConsignments"
          :key="consignment.id"
          :consignment="consignment"
          :route-cap="routeCap(consignment.route)"
        />
      </div>
    </section>
  </section>
</template>
