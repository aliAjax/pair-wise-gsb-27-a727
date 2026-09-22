<script setup lang="ts">
import { computed, reactive, ref } from "vue";

import {
  CREDENTIAL_TYPES,
  RESPONSIBLE_PARTIES,
  evaluateCredentials,
  evaluateReduction,
  formatMoney,
  type CredentialType,
  type ResponsibleParty
} from "../detention/rules";
import {
  amendDelegation,
  applyReduction,
  approvedReductionTotal,
  attachCredential,
  confirmDelegation,
  credentialsReady,
  detentionOf,
  payableOf,
  removeCredential,
  settleDelegation,
  type Delegation
} from "../detention/storage";

const props = defineProps<{ delegation: Delegation }>();

const credentialForm = reactive<{ type: CredentialType; title: string }>({
  type: "线路公告",
  title: ""
});
const reductionForm = reactive({ requested: 0, reason: "" });
const amendOpen = ref(false);
const amendForm = reactive({ start: "", end: "", cap: 0, party: "系统" as ResponsibleParty, reason: "" });
const message = ref("");

const detention = computed(() => detentionOf(props.delegation));
const credentialRule = computed(() => evaluateCredentials(props.delegation.party, props.delegation.credentials));
const ready = computed(() => credentialsReady(props.delegation));
const approvedTotal = computed(() => approvedReductionTotal(props.delegation));
const payable = computed(() => payableOf(props.delegation));

const rejectedReductions = computed(() => props.delegation.reductions.filter((item) => !item.allowed));
const acceptedReductions = computed(() => props.delegation.reductions.filter((item) => item.allowed));

const reductionPreview = computed(() =>
  evaluateReduction({
    party: props.delegation.party,
    requested: Number(reductionForm.requested) || 0,
    confirmedFreight: props.delegation.confirmedFreight,
    confirmedDetention: detention.value?.amount ?? 0
  })
);

const frozen = computed(() => props.delegation.frozenVersions);
const settled = computed(() => props.delegation.status === "已结算");

function flash(error: unknown) {
  message.value = error instanceof Error ? error.message : String(error);
}

function onAttach() {
  message.value = "";
  try {
    attachCredential(props.delegation.id, credentialForm.type, credentialForm.title.trim());
    credentialForm.title = "";
  } catch (error) {
    flash(error);
  }
}

function onRemoveCredential(credentialId: string) {
  message.value = "";
  try {
    removeCredential(props.delegation.id, credentialId);
  } catch (error) {
    flash(error);
  }
}

function onConfirm() {
  message.value = "";
  try {
    confirmDelegation(props.delegation.id);
  } catch (error) {
    flash(error);
  }
}

function onApplyReduction() {
  message.value = "";
  try {
    applyReduction(props.delegation.id, Number(reductionForm.requested) || 0, reductionForm.reason.trim());
    reductionForm.requested = 0;
    reductionForm.reason = "";
  } catch (error) {
    flash(error);
  }
}

function onSettle() {
  message.value = "";
  try {
    settleDelegation(props.delegation.id);
  } catch (error) {
    flash(error);
  }
}

function openAmend() {
  amendForm.start = props.delegation.start;
  amendForm.end = props.delegation.end;
  amendForm.cap = props.delegation.cap;
  amendForm.party = props.delegation.party;
  amendForm.reason = "";
  amendOpen.value = true;
}

function onAmend() {
  message.value = "";
  try {
    amendDelegation(props.delegation.id, {
      start: amendForm.start,
      end: amendForm.end,
      cap: Number(amendForm.cap),
      party: amendForm.party,
      reason: amendForm.reason
    });
    amendOpen.value = false;
  } catch (error) {
    flash(error);
  }
}

function formatTime(value: string): string {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}
</script>

<template>
  <article class="record delegation" :class="{ frozen: settled }">
    <div class="record-head">
      <p class="record-title">
        {{ delegation.customer }} / {{ delegation.routeName }}
        <span class="version-tag">v{{ delegation.version }}</span>
      </p>
      <span class="status" :class="{
        pending: delegation.status === '待复核',
        settled: settled
      }">{{ delegation.status }}</span>
    </div>

    <div class="details">
      <span>报价运费: {{ formatMoney(delegation.confirmedFreight) }}</span>
      <span>责任方: {{ delegation.party }}</span>
      <span>等待: {{ formatTime(delegation.start) }} → {{ formatTime(delegation.end) }}</span>
      <span>免费时段: {{ delegation.routeFreeHours }} 小时 / {{ formatMoney(delegation.routeHourlyRate) }}每小时</span>
      <span v-if="delegation.amendReason" class="amend-reason">补录原因：{{ delegation.amendReason }}</span>
    </div>

    <div class="fee-box">
      <div class="fee-line">
        <span>计费等待</span>
        <b>{{ detention?.chargeableHours ?? 0 }} 小时</b>
      </div>
      <div class="fee-line">
        <span>滞留费原值</span>
        <b>{{ formatMoney(detention?.rawAmount ?? 0) }}</b>
      </div>
      <div v-if="detention?.capped" class="cap-warning">
        超出路线上限：原值 {{ formatMoney(detention.rawAmount) }}，上限 {{ formatMoney(detention.cap) }}，超限部分不得确认，
        按 <b>{{ formatMoney(detention.amount) }}</b> 确认
      </div>
      <div v-else class="fee-line">
        <span>线路上限</span>
        <b>{{ formatMoney(delegation.cap) }}</b>
      </div>
      <div class="fee-line">
        <span>已批减免</span>
        <b>{{ formatMoney(approvedTotal) }}</b>
      </div>
      <div class="fee-line total">
        <span>应付滞留费</span>
        <b>{{ formatMoney(payable) }}</b>
      </div>
    </div>

    <div class="credential-block">
      <p class="block-title">凭据（{{ credentialRule.ruleText }}）</p>
      <p v-if="!ready" class="banner warn">凭据缺失，留待复核：缺少「{{ credentialRule.requiredType }}」</p>
      <ul v-if="delegation.credentials.length" class="credential-list">
        <li v-for="credential in delegation.credentials" :key="credential.id">
          <span class="credential-type">{{ credential.type }}</span>
          {{ credential.title }}
          <small>{{ formatTime(credential.attachedAt) }}</small>
          <button
            v-if="!settled"
            class="link-danger"
            type="button"
            @click="onRemoveCredential(credential.id)"
          >移除</button>
        </li>
      </ul>
      <div v-if="!settled" class="inline-form">
        <select v-model="credentialForm.type">
          <option v-for="type in CREDENTIAL_TYPES" :key="type" :value="type">{{ type }}</option>
        </select>
        <input v-model="credentialForm.title" placeholder="凭据编号或文件名" />
        <button type="button" @click="onAttach">附凭据</button>
      </div>
    </div>

    <div v-if="delegation.status === '已确认'" class="reduction-block">
      <p class="block-title">责任减免</p>
      <ul v-if="delegation.reductions.length" class="reduction-list">
        <li v-for="record in acceptedReductions" :key="record.id" class="accepted">
          已批准 {{ formatMoney(record.requested) }}｜{{ record.party }}｜{{ record.reason }}
          <small>{{ formatTime(record.appliedAt) }}</small>
        </li>
      </ul>
      <div v-for="record in rejectedReductions" :key="record.id" class="banner rejection">
        <p class="reject-title">减免整笔拒绝</p>
        <dl>
          <div><dt>委托</dt><dd>{{ delegation.id }}</dd></div>
          <div><dt>责任方</dt><dd>{{ record.party }}</dd></div>
          <div><dt>原值</dt><dd>{{ formatMoney(record.requested) }}</dd></div>
          <div><dt>上限</dt><dd>{{ formatMoney(record.cap) }}</dd></div>
          <div class="full"><dt>规则</dt><dd>{{ record.ruleText }}</dd></div>
          <div class="full"><dt>原因</dt><dd>{{ record.reason }}</dd></div>
        </dl>
      </div>
      <div class="inline-form">
        <input v-model.number="reductionForm.requested" type="number" min="0" step="10" placeholder="申请减免金额" />
        <input v-model="reductionForm.reason" placeholder="减免原因" />
        <button type="button" @click="onApplyReduction">申请减免</button>
      </div>
      <p class="hint">{{ reductionPreview.ruleText }}（本次输入上限 {{ formatMoney(reductionPreview.cap) }}）</p>
    </div>

    <div v-if="message" class="banner error">{{ message }}</div>

    <div class="actions">
      <button v-if="delegation.status === '待复核'" type="button" :disabled="!ready" @click="onConfirm">
        确认责任与费用
      </button>
      <button v-if="delegation.status === '待复核' && !ready" class="secondary" type="button" disabled>
        凭据缺失，留待复核
      </button>
      <button v-if="delegation.status === '已确认'" type="button" @click="onSettle">结算并冻结</button>
      <button v-if="settled" class="secondary" type="button" @click="openAmend">补录（新建版本）</button>
    </div>

    <form v-if="amendOpen" class="amend-form" @submit.prevent="onAmend">
      <p class="block-title">新建 v{{ delegation.version + 1 }}（旧值冻结保留）</p>
      <label>等待开始
        <input v-model="amendForm.start" type="datetime-local" required />
      </label>
      <label>等待结束
        <input v-model="amendForm.end" type="datetime-local" required />
      </label>
      <label>费用上限（元）
        <input v-model.number="amendForm.cap" type="number" min="0" step="50" required />
      </label>
      <label>责任方
        <select v-model="amendForm.party">
          <option v-for="party in RESPONSIBLE_PARTIES" :key="party" :value="party">{{ party }}</option>
        </select>
      </label>
      <label>补录原因
        <input v-model="amendForm.reason" required placeholder="必须填写原因" />
      </label>
      <div class="actions">
        <button type="submit">提交新版本</button>
        <button class="secondary" type="button" @click="amendOpen = false">取消</button>
      </div>
    </form>

    <div v-if="frozen.length" class="history">
      <p class="block-title">历史版本（结算冻结，只读）</p>
      <ol>
        <li v-for="snapshot in [...frozen].reverse()" :key="`${snapshot.version}-${snapshot.frozenAt}`">
          <span class="version-tag">v{{ snapshot.version }}</span>
          {{ snapshot.party }} ｜
          等待 {{ formatTime(snapshot.start) }} → {{ formatTime(snapshot.end) }} ｜
          滞留费 {{ formatMoney(snapshot.detention) }}
          <template v-if="snapshot.capped">（原 {{ formatMoney(snapshot.detentionRaw) }} 超限）</template>
          ｜上限 {{ formatMoney(snapshot.cap) }} ｜
          凭据 {{ snapshot.credentials.length }} 份 ｜
          减免 {{ formatMoney(snapshot.reductions.filter((item) => item.allowed).reduce((acc, item) => acc + item.requested, 0)) }} ｜
          {{ snapshot.status }} ｜
          冻结于 {{ formatTime(snapshot.frozenAt ?? "") }}
        </li>
      </ol>
    </div>
  </article>
</template>
