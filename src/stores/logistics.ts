import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  calcDemurrage,
  evaluateReduction,
  isEvidenceSatisfied,
  requiredEvidenceKind,
  round2,
} from "../logistics/rules";
import {
  loadConsignments,
  loadQuotes,
  loadRouteRules,
  saveConsignments,
  saveQuotes,
  saveRouteRules,
} from "../logistics/storage";
import type {
  Consignment,
  EvidenceKind,
  QuoteRecord,
  Reduction,
  ResponsibleParty,
  RouteRule,
  ServiceType,
} from "../logistics/types";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; data?: T };

function uid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function consignmentCode(): string {
  const date = new Date().toISOString().slice(0, 10).split("-").join("");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WT${date}${suffix}`;
}

/** 首次使用时的种子报价（含已确认运费，兼容旧版无 freight 字段的存储） */
function seedQuotes(): QuoteRecord[] {
  const seeds: Array<Omit<QuoteRecord, "id" | "createdAt">> = [
    {
      customer: "海沃商贸",
      route: "上海-南京",
      weight: 180,
      freight: 1260,
      service: "标准达",
      status: "已报价",
      notes: "预估费用1260元",
    },
    {
      customer: "云仓食品",
      route: "杭州-合肥",
      weight: 95,
      freight: 880,
      service: "冷链",
      status: "草稿",
      notes: "待确认温区",
    },
  ];
  return seeds.map((seed, index) => ({
    ...seed,
    id: `seed-${index + 1}`,
    createdAt: new Date(Date.now() - index * 86_400_000).toISOString(),
  }));
}

/** 迁移旧版记录：补齐 freight 字段，避免历史数据破坏计算 */
function normalize(raw: unknown): QuoteRecord[] {
  const list = Array.isArray(raw) ? (raw as unknown[]) : [];
  return list.map((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    return {
      id: String(item.id ?? `legacy-${index + 1}`),
      customer: String(item.customer ?? ""),
      route: String(item.route ?? ""),
      weight: Number(item.weight ?? 0) || 0,
      freight: Number(item.freight ?? 0) || 0,
      service: String(item.service ?? "标准达") as ServiceType,
      status: String(item.status ?? "草稿") as QuoteRecord["status"],
      notes: String(item.notes ?? ""),
      createdAt: String(item.createdAt ?? now()),
    };
  });
}

export interface NewQuoteInput {
  customer: string;
  route: string;
  weight: number;
  freight: number;
  service: ServiceType;
  notes: string;
}

export interface CreateConsignmentInput {
  quoteId: string;
  waitStart: string;
  waitEnd: string;
  responsibleParty: ResponsibleParty;
  cap: number;
}

export interface SubmitConfirmationInput {
  consignmentId: string;
  evidenceReference: string;
  /** true=留待复核（凭据缺失），false=按凭据确认 */
  pendingReview: boolean;
}

export interface ApplyReductionInput {
  consignmentId: string;
  requestedAmount: number;
  reason: string;
}

export interface AppendVersionInput {
  consignmentId: string;
  waitStart: string;
  waitEnd: string;
  responsibleParty: ResponsibleParty;
  cap: number;
  reason: string;
}

export const useLogisticsStore = defineStore("logistics", () => {
  const storedQuotes = loadQuotes();
  const quotes = ref<QuoteRecord[]>(storedQuotes === null ? seedQuotes() : normalize(storedQuotes));
  const consignments = ref<Consignment[]>(loadConsignments());
  const routeRules = ref<RouteRule[]>(loadRouteRules());

  function persistQuotes() {
    saveQuotes(quotes.value);
  }
  function persistConsignments() {
    saveConsignments(consignments.value);
  }
  function persistRules() {
    saveRouteRules(routeRules.value);
  }

  const quotedRecords = computed(() => quotes.value.filter((item) => item.status === "已报价"));

  /** 已生成委托的报价 id：已报价记录只能生成一次委托 */
  const consignedQuoteIds = computed(() => new Set(consignments.value.map((item) => item.quoteId)));

  function findRule(route: string): RouteRule | undefined {
    return routeRules.value.find((rule) => rule.route === route);
  }

  function findConsignment(id: string): Consignment | undefined {
    return consignments.value.find((item) => item.id === id);
  }

  // ---------------- 报价 ----------------

  function addQuote(input: NewQuoteInput) {
    quotes.value = [
      { ...input, id: uid(), status: "草稿", createdAt: now() },
      ...quotes.value,
    ];
    persistQuotes();
  }

  function advanceQuoteStatus(id: string) {
    const quote = quotes.value.find((item) => item.id === id);
    if (!quote) return;
    const flow: QuoteRecord["status"][] = ["草稿", "已报价", "已复制"];
    quote.status = flow[(flow.indexOf(quote.status) + 1) % flow.length];
    persistQuotes();
  }

  function removeQuote(id: string) {
    quotes.value = quotes.value.filter((item) => item.id !== id);
    persistQuotes();
  }

  // ---------------- 线路规则 ----------------

  function registerRouteRule(rule: RouteRule): Result {
    if (!rule.route.trim()) return { ok: false, error: "请填写线路名称" };
    if (!(rule.freeHours >= 0) || !(rule.hourlyRate > 0) || !(rule.cap > 0)) {
      return { ok: false, error: "免费时段需≥0，单价与上限需大于0" };
    }
    const index = routeRules.value.findIndex((item) => item.route === rule.route);
    if (index >= 0) {
      routeRules.value[index] = { ...rule };
    } else {
      routeRules.value = [...routeRules.value, { ...rule }];
    }
    persistRules();
    return { ok: true };
  }

  // ---------------- 运输委托 ----------------

  function createConsignment(input: CreateConsignmentInput): Result<Consignment> {
    const quote = quotes.value.find((item) => item.id === input.quoteId);
    if (!quote) return { ok: false, error: "报价记录不存在" };
    if (quote.status !== "已报价") return { ok: false, error: "只有“已报价”记录才能生成委托" };
    if (consignedQuoteIds.value.has(quote.id)) return { ok: false, error: "该报价已生成委托，不能重复生成" };

    const rule = findRule(quote.route);
    if (!rule) return { ok: false, error: `线路“${quote.route}”尚未登记规则，请先在下方登记线路` };
    if (!(input.cap > 0)) return { ok: false, error: "费用上限必须大于 0" };

    const calc = calcDemurrage(input.waitStart, input.waitEnd, rule, input.cap);
    if ("error" in calc) return { ok: false, error: calc.error };

    const consignment: Consignment = {
      id: uid(),
      code: consignmentCode(),
      quoteId: quote.id,
      customer: quote.customer,
      route: quote.route,
      freight: quote.freight,
      versions: [
        {
          version: 1,
          waitStart: input.waitStart,
          waitEnd: input.waitEnd,
          waitedHours: calc.waitedHours,
          chargeableHours: calc.chargeableHours,
          rawAmount: calc.rawAmount,
          cap: round2(input.cap),
          confirmedAmount: calc.confirmedAmount,
          rejectedExcess: calc.rejectedExcess,
          responsibleParty: input.responsibleParty,
          evidence: null,
          status: "待确认",
          createdAt: now(),
          confirmedAt: null,
          settledAt: null,
          reason: "",
        },
      ],
      reductions: [],
      createdAt: now(),
    };
    consignments.value = [consignment, ...consignments.value];
    persistConsignments();
    return { ok: true, data: consignment };
  }

  /** 责任确认：凭据齐备则已确认；凭据缺失留待复核；复核时补齐凭据可转为已确认 */
  function submitConfirmation(input: SubmitConfirmationInput): Result {
    const consignment = findConsignment(input.consignmentId);
    if (!consignment) return { ok: false, error: "委托不存在" };
    const version = consignment.versions[consignment.versions.length - 1];
    if (version.settledAt) return { ok: false, error: "该版本已结算冻结，补录请新建版本" };
    if (version.status === "已确认") return { ok: false, error: "该版本已确认" };

    const reference = input.evidenceReference.trim();

    // 免费时段内无滞留费，无需凭据即可确认
    if (version.confirmedAmount === 0) {
      version.status = "已确认";
      version.confirmedAt = now();
      persistConsignments();
      return { ok: true };
    }

    if (input.pendingReview || !reference) {
      version.evidence = reference
        ? { kind: requiredEvidenceKind(version.responsibleParty), reference, attachedAt: now() }
        : null;
      version.status = "待复核";
      persistConsignments();
      return { ok: true };
    }

    version.evidence = {
      kind: requiredEvidenceKind(version.responsibleParty) as EvidenceKind,
      reference,
      attachedAt: now(),
    };
    if (!isEvidenceSatisfied(version, version.responsibleParty)) {
      version.status = "待复核";
      persistConsignments();
      return { ok: false, error: "凭据类型与责任方不符，已留待复核" };
    }
    version.status = "已确认";
    version.confirmedAt = now();
    persistConsignments();
    return { ok: true };
  }

  /** 结算后费用冻结：已确认版本方可结算 */
  function settleConsignment(consignmentId: string): Result {
    const consignment = findConsignment(consignmentId);
    if (!consignment) return { ok: false, error: "委托不存在" };
    const version = consignment.versions[consignment.versions.length - 1];
    if (version.status !== "已确认") return { ok: false, error: "只有已确认的版本可以结算" };
    version.status = "已结算";
    version.settledAt = now();
    persistConsignments();
    return { ok: true };
  }

  /**
   * 减免申请：超额度整笔拒绝，并保留委托、责任方、原值、上限与命中规则。
   * 非系统责任≤已确认运费两成；系统责任可全额减免。
   */
  function applyReduction(input: ApplyReductionInput): Result<Reduction> {
    const consignment = findConsignment(input.consignmentId);
    if (!consignment) return { ok: false, error: "委托不存在" };
    const version = consignment.versions[consignment.versions.length - 1];
    if (version.status !== "已确认") return { ok: false, error: "只有已确认、未结算的版本可申请减免" };

    const check = evaluateReduction(consignment.freight, version, consignment.reductions, input.requestedAmount);
    const requested = round2(input.requestedAmount);
    const record: Reduction = {
      id: uid(),
      version: version.version,
      requestedAmount: requested,
      approvedAmount: check.allowed ? requested : 0,
      status: check.allowed ? "已减免" : "已拒绝",
      reason: input.reason.trim() || (check.allowed ? "额度内减免" : "超额度整笔拒绝"),
      policyCap: check.cap,
      alreadyReduced: check.alreadyReduced,
      rule: check.rule,
      appliedAt: now(),
    };
    consignment.reductions.push(record);
    persistConsignments();
    if (!check.allowed) return { ok: false, error: check.rule, data: record };
    return { ok: true, data: record };
  }

  /** 结算后补录：新建带原因版本，旧版本与旧值原样冻结保留 */
  function appendVersion(input: AppendVersionInput): Result<Consignment> {
    const consignment = findConsignment(input.consignmentId);
    if (!consignment) return { ok: false, error: "委托不存在" };
    const current = consignment.versions[consignment.versions.length - 1];
    if (current.status !== "已结算") return { ok: false, error: "只有结算冻结后的委托需要补录新版本" };
    if (!input.reason.trim()) return { ok: false, error: "补录必须填写原因" };

    const rule = findRule(consignment.route);
    if (!rule) return { ok: false, error: `线路“${consignment.route}”规则缺失` };
    if (!(input.cap > 0)) return { ok: false, error: "费用上限必须大于 0" };

    const calc = calcDemurrage(input.waitStart, input.waitEnd, rule, input.cap);
    if ("error" in calc) return { ok: false, error: calc.error };

    consignment.versions.push({
      version: current.version + 1,
      waitStart: input.waitStart,
      waitEnd: input.waitEnd,
      waitedHours: calc.waitedHours,
      chargeableHours: calc.chargeableHours,
      rawAmount: calc.rawAmount,
      cap: round2(input.cap),
      confirmedAmount: calc.confirmedAmount,
      rejectedExcess: calc.rejectedExcess,
      responsibleParty: input.responsibleParty,
      evidence: null,
      status: "待确认",
      createdAt: now(),
      confirmedAt: null,
      settledAt: null,
      reason: input.reason.trim(),
    });
    persistConsignments();
    return { ok: true, data: consignment };
  }

  return {
    quotes,
    consignments,
    routeRules,
    quotedRecords,
    consignedQuoteIds,
    findRule,
    findConsignment,
    addQuote,
    advanceQuoteStatus,
    removeQuote,
    registerRouteRule,
    createConsignment,
    submitConfirmation,
    settleConsignment,
    applyReduction,
    appendVersion,
  };
});
