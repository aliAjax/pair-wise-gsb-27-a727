<script setup lang="ts">
import { ref } from "vue";
import QuotePage from "./pages/QuotePage.vue";
import DemurrageDesk from "./pages/DemurrageDesk.vue";

const stack = ["Vue3", "Vite", "TypeScript", "Pinia", "Element Plus"];

const tabs = [
  { key: "quote", label: "费用试算" },
  { key: "demurrage", label: "滞留费责任确认与减免台" },
] as const;

type TabKey = (typeof tabs)[number]["key"];
const activeTab = ref<TabKey>("quote");
const draftQuoteId = ref<string | null>(null);

function goCreateConsignment(quoteId: string) {
  draftQuoteId.value = quoteId;
  activeTab.value = "demurrage";
}

function clearDraft() {
  draftQuoteId.value = null;
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流行业前端最小闭环 · 运输委托滞留费管理</p>
          <h1>物流费用试算 / 滞留费责任确认与减免台</h1>
          <p class="subtitle">
            已报价记录生成运输委托；按线路免费时段与上限确认滞留费，凭据缺失留待复核；
            非系统责任减免不超过已确认运费两成，系统责任可全额减免，结算后冻结，补录新建版本并保留旧值。
          </p>
        </div>
        <div class="stack">
          <span v-for="item in stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <nav class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="tab"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <QuotePage v-show="activeTab === 'quote'" @create-consignment="goCreateConsignment" />
      <DemurrageDesk
        v-show="activeTab === 'demurrage'"
        :draft-quote-id="draftQuoteId"
        @clear-draft="clearDraft"
      />
    </div>
  </main>
</template>
