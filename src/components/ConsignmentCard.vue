<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  evidenceLabel,
  requiredEvidenceKind,
  versionApprovedReduction,
  versionReductions,
} from "../logistics/rules";
import { useLogisticsStore } from "../stores/logistics";
import type { Consignment, RejectionInfo } from "../logistics/types";

const props = defineProps<{ consignment: Consignment; routeCap: number | null }>();

const store = useLogisticsStore();

const current = computed(() => props.consignment.versions[props.consignment.versions.length - 1]);
const isFrozen = computed(() => current.value.status === "已结算");
const approvedReduction = computed(() => versionApprovedReduction(props.consignment, current.value.version));
const receivable = computed(() => Math.max(0, current.value.confirmedAmount - approvedReduction.value));
const currentReductionRecords = computed(() => versionReductions(props.consignment, current.value.version));
const requiredKind = computed(() => requiredEvidenceKind(current.value.responsibleParty));

function fmtTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

// ---------------- 责任确认 / 复核 ----------------

const evidenceRef = ref("");
const confirmError = ref("");
const confirmHint = ref("");

watch(
  () => props.consignment.id,
  () => {
    evidenceRef.value = "";
    confirmError.value = "";
    confirmHint.value = "";
  },
);

function confirmWithEvidence() {
  if (current.value.confirmedAmount === 0) {
    const result = store.submitConfirmation({
      consignmentId: props.consignment.id,
      evidenceReference: "",
      pendingReview: false,
    });
    confirmError.value = result.ok ? "" : result.error;
    return;
  }
  if (!evidenceRef.value.trim()) {
    confirmError.value = `请填写${requiredKind.value}编号；凭据缺失时请选择“凭据缺失，留待复核”`;
    return;
  }
  const result = store.submitConfirmation({
    consignmentId: props.consignment.id,
    evidenceReference: evidenceRef.value.trim(),
    pendingReview: false,
  });
  if (!result.ok) confirmError.value = result.error;
  else {
    confirmError.value = "";
    evidenceRef.value = "";
  }
}

function holdForReview() {
  const result = store.submitConfirmation({
    consignmentId: props.consignment.id,
    evidenceReference: evidenceRef.value.trim(),
    pendingReview: true,
  });
  if (result.ok) {
    confirmHint.value = "凭据缺失，已留待复核；补齐凭据后可重新确认";
    confirmError.value = "";
  }
}

function resolveReview() {
  if (!evidenceRef.value.trim()) {
    confirmError.value = `补齐${requiredKind.value}编号后才能复核通过`;
    return;
  }
  const result = store.submitConfirmation({
    consignmentId: props.consignment.id,
    evidenceReference: evidenceRef.value.trim(),
    pendingReview: false,
  });
  confirmError.value = result.ok ? "" : result.error;
  if (result.ok) confirmHint.value = "";
}

function settle() {
  const result = store.settleConsignment(props.consignment.id);
  if (!result.ok) confirmError.value = result.error;
}

// ---------------- 减免 ----------------

const reductionForm = reactive({ amount: 0, reason: "" });
const rejection = ref<RejectionInfo | null>(null);
const reductionHint = ref("");

function submitReduction() {
  rejection.value = null;
  reductionHint.value = "";
  const result = store.applyReduction({
    consignmentId: props.consignment.id,
    requestedAmount: Number(reductionForm.amount) || 0,
    reason: reductionForm.reason,
  });
  if (!result.ok && result.data) {
    rejection.value = {
      consignmentCode: props.consignment.code,
      responsibleParty: current.value.responsibleParty,
      demurrageRaw: current.value.rawAmount,
      confirmedAmount: current.value.confirmedAmount,
      requestedAmount: result.data.requestedAmount,
      cap: result.data.policyCap,
      rule: result.data.rule,
    };
  } else if (result.ok) {
    reductionHint.value = "减免已通过并入账";
    reductionForm.amount = 0;
    reductionForm.reason = "";
  } else {
    reductionHint.value = result.error;
  }
}

// ---------------- 结算后补录（新建版本） ----------------

const showAppend = ref(false);
const appendForm = reactive({
  waitStart: "",
  waitEnd: "",
  responsibleParty: "系统" as "系统" | "客户",
  cap: props.routeCap ?? 0,
  reason: "",
});
const appendError = ref("");

watch(showAppend, (visible) => {
  if (visible && props.routeCap != null) appendForm.cap = props.routeCap;
});

function openAppend() {
  if (props.routeCap != null) appendForm.cap = props.routeCap;
  showAppend.value = true;
}

function submitAppend() {
  appendError.value = "";
  const result = store.appendVersion({
    consignmentId: props.consignment.id,
    waitStart: appendForm.waitStart,
    waitEnd: appendForm.waitEnd,
    responsibleParty: appendForm.responsibleParty,
    cap: Number(appendForm.cap) || 0,
    reason: appendForm.reason,
  });
  if (!result.ok) {
    appendError.value = result.error;
    return;
  }
  showAppend.value = false;
  Object.assign(appendForm, { waitStart: "", waitEnd: "", responsibleParty: "系统", cap: props.routeCap ?? 0, reason: "" });
}
</script>

<template>
  <article class="record consignment" :class="{ frozen: isFrozen }">
    <div class="record-head">
      <div>
        <p class="record-title">{{ consignment.code }} · {{ consignment.customer }} / {{ consignment.route }}</p>
        <p class="sub">委托版本 v{{ current.version }} · 已确认运费 ¥{{ consignment.freight.toFixed(2) }}</p>
      </div>
      <span class="status" :class="`vstatus-${current.status}`">{{ current.status }}{{ isFrozen ? "（冻结）" : "" }}</span>
    </div>

    <div class="details">
      <span>等待起: {{ fmtTime(current.waitStart) }}</span>
      <span>等待止: {{ fmtTime(current.waitEnd) }}</span>
      <span>等待时长: {{ current.waitedHours }} 小时</span>
      <span>计费时长: {{ current.chargeableHours }} 小时（整点进位）</span>
      <span>责任方: <strong>{{ current.responsibleParty }}责任</strong></span>
      <span>登记上限: ¥{{ current.cap.toFixed(2) }}</span>
    </div>

    <div class="fee-row">
      <div class="fee-item">
        <span>滞留费原值</span>
        <strong>¥{{ current.rawAmount.toFixed(2) }}</strong>
      </div>
      <div class="fee-item">
        <span>可确认</span>
        <strong class="ok">¥{{ current.confirmedAmount.toFixed(2) }}</strong>
      </div>
      <div class="fee-item">
        <span>超限不得确认</span>
        <strong :class="current.rejectedExcess > 0 ? 'warn' : ''">¥{{ current.rejectedExcess.toFixed(2) }}</strong>
      </div>
      <div class="fee-item">
        <span>已减免 / 应收</span>
        <strong>¥{{ approvedReduction.toFixed(2) }} / ¥{{ receivable.toFixed(2) }}</strong>
      </div>
    </div>

    <p v-if="current.rawAmount > 0 && current.chargeableHours === 0" class="note">
      等待未超出免费时段，不产生滞留费。
    </p>
    <p v-if="current.rejectedExcess > 0" class="note warn-note">
      按路线上限裁剪：原值 ¥{{ current.rawAmount.toFixed(2) }}，超限部分 ¥{{ current.rejectedExcess.toFixed(2) }}
      不得确认，仅可确认 ¥{{ current.confirmedAmount.toFixed(2) }}。
    </p>

    <div v-if="current.evidence" class="evidence">
      <span class="badge">凭据：{{ current.evidence.kind }}</span>
      <span>编号 {{ current.evidence.reference }}</span>
      <span class="muted">{{ fmtTime(current.evidence.attachedAt) }}</span>
    </div>

    <!-- 责任确认 / 复核 -->
    <div v-if="(current.status === '待确认' || current.status === '待复核') && current.confirmedAmount === 0" class="action-block">
      <p class="block-title">等待未超免费时段，无滞留费，可直接确认</p>
      <button type="button" class="accent" @click="confirmWithEvidence">确认（无需凭据）</button>
      <p v-if="confirmError" class="error-text">{{ confirmError }}</p>
    </div>
    <div v-else-if="current.status === '待确认' || current.status === '待复核'" class="action-block">
      <p class="block-title">
        {{ current.responsibleParty }}责任须附「{{ requiredKind }}」
        <em v-if="current.status === '待复核'" class="pending-tag">当前：留待复核</em>
      </p>
      <div class="inline-form">
        <input
          v-model="evidenceRef"
          :placeholder="`${evidenceLabel(current.responsibleParty)}（如 GG20260922-01 / SRP-8842）`"
        />
        <button type="button" class="accent" @click="current.status === '待复核' ? resolveReview() : confirmWithEvidence()">
          {{ current.status === '待复核' ? '补齐凭据，复核通过' : '确认责任' }}
        </button>
        <button type="button" class="secondary" @click="holdForReview">凭据缺失，留待复核</button>
      </div>
      <p v-if="confirmHint" class="hint">{{ confirmHint }}</p>
      <p v-if="confirmError" class="error-text">{{ confirmError }}</p>
    </div>

    <!-- 减免 -->
    <div v-if="current.status === '已确认'" class="action-block">
      <p class="block-title">
        减免申请 ——
        {{ current.responsibleParty === '系统'
          ? '系统责任可全额减免（上限=已确认滞留费）'
          : '非系统责任减免不得超过已确认运费两成（20%）' }}
      </p>
      <div class="inline-form">
        <input v-model.number="reductionForm.amount" type="number" min="0" step="0.01" placeholder="申请减免金额（元）" />
        <input v-model="reductionForm.reason" placeholder="减免原因（必填）" />
        <button type="button" class="accent" @click="submitReduction">提交减免</button>
        <button type="button" @click="settle">结算并冻结</button>
      </div>
      <p v-if="reductionHint" class="hint">{{ reductionHint }}</p>

      <div v-if="rejection" class="reject-banner">
        <p class="reject-title">超额度整笔拒绝</p>
        <div class="reject-grid">
          <span>委托：<strong>{{ rejection.consignmentCode }}</strong></span>
          <span>责任方：<strong>{{ rejection.responsibleParty }}责任</strong></span>
          <span>滞留费原值：<strong>¥{{ rejection.demurrageRaw.toFixed(2) }}</strong></span>
          <span>可确认滞留费：<strong>¥{{ rejection.confirmedAmount.toFixed(2) }}</strong></span>
          <span>本次申请原值：<strong>¥{{ rejection.requestedAmount.toFixed(2) }}</strong></span>
          <span>减免上限：<strong>¥{{ rejection.cap.toFixed(2) }}</strong></span>
        </div>
        <p class="reject-rule">规则：{{ rejection.rule }}</p>
      </div>
    </div>

    <!-- 减免留痕 -->
    <div v-if="currentReductionRecords.length" class="reduction-log">
      <p class="block-title">本版本减免记录</p>
      <div v-for="item in currentReductionRecords" :key="item.id" class="log-row" :class="item.status === '已拒绝' ? 'denied' : 'granted'">
        <span class="dot" />
        <span>{{ item.status }}</span>
        <span>申请 ¥{{ item.requestedAmount.toFixed(2) }}</span>
        <span v-if="item.status === '已减免'">批准 ¥{{ item.approvedAmount.toFixed(2) }}</span>
        <span>上限 ¥{{ item.policyCap.toFixed(2) }}</span>
        <span class="muted">{{ item.reason }}</span>
        <span class="muted">{{ fmtTime(item.appliedAt) }}</span>
      </div>
      <p v-if="currentReductionRecords.some((item) => item.status === '已拒绝')" class="reject-rule">
        拒绝规则：{{ currentReductionRecords.find((item) => item.status === '已拒绝')?.rule }}
      </p>
    </div>

    <!-- 结算后补录 -->
    <div v-if="isFrozen" class="action-block frozen-block">
      <p class="block-title">已结算冻结：补录只能新建带原因版本，旧版本与旧值只读保留。</p>
      <button type="button" class="secondary" @click="openAppend">{{ showAppend ? '收起补录' : '补录新版本' }}</button>

      <div v-if="showAppend" class="append-form">
        <label>
          等待开始
          <input v-model="appendForm.waitStart" type="datetime-local" />
        </label>
        <label>
          等待结束
          <input v-model="appendForm.waitEnd" type="datetime-local" />
        </label>
        <label>
          责任方
          <select v-model="appendForm.responsibleParty">
            <option value="系统">系统责任（须附线路公告）</option>
            <option value="客户">客户责任（须附签收记录）</option>
          </select>
        </label>
        <label>
          费用上限（元，默认取当前线路上限）
          <input v-model.number="appendForm.cap" type="number" min="0" step="0.01" />
        </label>
        <label class="full">
          补录原因（必填）
          <textarea v-model="appendForm.reason" placeholder="如：签收单延迟回收，重新核定等待时长" />
        </label>
        <div class="actions">
          <button type="button" class="accent" @click="submitAppend">确认新建版本</button>
          <button type="button" class="secondary" @click="showAppend = false">取消</button>
        </div>
        <p v-if="appendError" class="error-text">{{ appendError }}</p>
      </div>
    </div>

    <!-- 版本历史（旧值保留） -->
    <details class="history">
      <summary>版本历史（{{ consignment.versions.length }}）与凭据留痕</summary>
      <div v-for="version in [...consignment.versions].reverse()" :key="version.version" class="version-row">
        <header>
          <strong>v{{ version.version }}</strong>
          <span class="status" :class="`vstatus-${version.status}`">{{ version.status }}</span>
          <span v-if="version.version < current.version" class="muted">（旧值只读保留）</span>
          <span v-if="version.reason" class="muted">补录原因：{{ version.reason }}</span>
        </header>
        <div class="version-grid">
          <span>{{ fmtTime(version.waitStart) }} → {{ fmtTime(version.waitEnd) }}</span>
          <span>等待 {{ version.waitedHours }}h / 计费 {{ version.chargeableHours }}h</span>
          <span>{{ version.responsibleParty }}责任</span>
          <span>原值 ¥{{ version.rawAmount.toFixed(2) }}</span>
          <span>上限 ¥{{ version.cap.toFixed(2) }}</span>
          <span>确认 ¥{{ version.confirmedAmount.toFixed(2) }}</span>
          <span class="warn-text">超限 ¥{{ version.rejectedExcess.toFixed(2) }}</span>
          <span>
            凭据：
            <template v-if="version.evidence">{{ version.evidence.kind }} / {{ version.evidence.reference }}</template>
            <template v-else>缺失</template>
          </span>
          <span>确认于 {{ fmtTime(version.confirmedAt) }}</span>
          <span>结算于 {{ fmtTime(version.settledAt) }}</span>
        </div>
      </div>
    </details>
  </article>
</template>
