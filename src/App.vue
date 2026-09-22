<script setup lang="ts">
import { ref } from "vue";

import QuotePage from "./pages/QuotePage.vue";
import RoutePage from "./pages/RoutePage.vue";
import DelegationPage from "./pages/DelegationPage.vue";

const tabs = [
  { key: "delegation", label: "滞留费责任台" },
  { key: "quote", label: "报价试算" },
  { key: "route", label: "线路登记" }
] as const;

type TabKey = (typeof tabs)[number]["key"];
const active = ref<TabKey>("delegation");
const preselectQuoteId = ref<string | undefined>(undefined);

function goCreateDelegation(quoteId: string) {
  preselectQuoteId.value = quoteId;
  active.value = "delegation";
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流行业前端最小闭环</p>
          <h1>运输委托滞留费责任确认与减免台</h1>
          <p class="subtitle">
            已报价记录生成委托；登记线路、等待起止、责任方与费用上限；
            超免费时段按路线上限计算，超限不得确认；按责任方核验凭据与减免额度，结算冻结、补录留版本，数据本地持久化。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">规则/存储/页面分离</span>
          <span class="tag">localStorage</span>
        </div>
      </header>

      <nav class="tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="tab"
          :class="{ active: active === tab.key }"
          @click="active = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <DelegationPage v-if="active === 'delegation'" :preselect-quote-id="preselectQuoteId" />
      <QuotePage v-else-if="active === 'quote'" @create-delegation="goCreateDelegation" />
      <RoutePage v-else />
    </div>
  </main>
</template>
