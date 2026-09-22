// 存储层：报价、线路、委托的持久化与状态流转。
// 规则判断全部委托 rules.ts，本文件只负责数据读写与快照版本管理。

import { reactive } from "vue";

import {
  calcDetention,
  calcFreight,
  evaluateCredentials,
  evaluateReduction,
  type Credential,
  type CredentialType,
  type DelegationStatus,
  type DetentionCalc,
  type ReductionRuleResult,
  type ResponsibleParty,
  type RouteRule
} from "./rules";

export interface QuoteRecord {
  id: string;
  customer: string;
  route: string;
  weight: number;
  service: string;
  fee: number;
  status: string;
  notes: string;
  createdAt: string;
}

export interface ReductionRecord {
  id: string;
  party: ResponsibleParty;
  requested: number;
  cap: number;
  allowed: boolean;
  ruleText: string;
  reason: string;
  appliedAt: string;
}

export interface DelegationSnapshot {
  version: number;
  start: string;
  end: string;
  party: ResponsibleParty;
  cap: number;
  detentionRaw: number;
  detention: number;
  capped: boolean;
  credentials: Credential[];
  reductions: ReductionRecord[];
  status: DelegationStatus;
  amendReason: string;
  frozenAt: string | null;
}

export interface Delegation {
  id: string;
  quoteId: string;
  customer: string;
  routeName: string;
  service: string;
  confirmedFreight: number;
  routeFreeHours: number;
  routeHourlyRate: number;
  version: number;
  start: string;
  end: string;
  party: ResponsibleParty;
  cap: number;
  credentials: Credential[];
  reductions: ReductionRecord[];
  status: DelegationStatus;
  amendReason: string;
  createdAt: string;
  /** 结算后冻结的历史版本（含本次结算前的全部内容） */
  frozenVersions: DelegationSnapshot[];
}

export interface DeskState {
  quotes: QuoteRecord[];
  routes: RouteRule[];
  delegations: Delegation[];
}

const QUOTE_KEY = "hxwlfront-13-freight";
const ROUTE_KEY = "hxwlfront-13-routes";
const DELEGATION_KEY = "hxwlfront-13-delegations";
const VERSION = 1;

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function fixedIso(date: string, hours: number, minutes = 0): string {
  return new Date(`${date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+08:00`).toISOString();
}

// ---------- 种子数据 ----------

function seedRoutes(): RouteRule[] {
  return [
    { id: "route-seed-1", name: "上海-南京", freeHours: 2, hourlyRate: 120, cap: 600 },
    { id: "route-seed-2", name: "杭州-合肥", freeHours: 1, hourlyRate: 100, cap: 500 },
    { id: "route-seed-3", name: "广州-深圳", freeHours: 3, hourlyRate: 150, cap: 800 }
  ];
}

function seedQuotes(): QuoteRecord[] {
  const base = (index: number) => new Date(Date.now() - index * 86400000).toISOString();
  return [
    {
      id: "seed-1",
      customer: "海沃商贸",
      route: "上海-南京",
      weight: 180,
      service: "标准达",
      fee: calcFreight(180, "标准达"),
      status: "已报价",
      notes: "预估费用1260元",
      createdAt: base(1)
    },
    {
      id: "seed-2",
      customer: "云仓食品",
      route: "杭州-合肥",
      weight: 95,
      service: "冷链",
      fee: calcFreight(95, "冷链"),
      status: "草稿",
      notes: "待确认温区",
      createdAt: base(2)
    },
    {
      id: "seed-3",
      customer: "远东建材",
      route: "杭州-合肥",
      weight: 220,
      service: "标准达",
      fee: calcFreight(220, "标准达"),
      status: "已报价",
      notes: "整批瓷砖，已签回单",
      createdAt: base(3)
    },
    {
      id: "seed-4",
      customer: "岭南鲜果",
      route: "广州-深圳",
      weight: 130,
      service: "次日达",
      fee: calcFreight(130, "次日达"),
      status: "已报价",
      notes: "午班发车",
      createdAt: base(4)
    }
  ];
}

function credential(id: string, type: CredentialType, title: string, day: string, hours: number, minutes = 0): Credential {
  return { id, type, title, attachedAt: fixedIso(day, hours, minutes) };
}

function snapshotOf(delegation: Delegation, frozenAt: string | null): DelegationSnapshot {
  return {
    version: delegation.version,
    start: delegation.start,
    end: delegation.end,
    party: delegation.party,
    cap: delegation.cap,
    detentionRaw: detentionOf(delegation)?.rawAmount ?? 0,
    detention: detentionOf(delegation)?.amount ?? 0,
    capped: detentionOf(delegation)?.capped ?? false,
    credentials: delegation.credentials.map((item) => ({ ...item })),
    reductions: delegation.reductions.map((item) => ({ ...item })),
    status: delegation.status,
    amendReason: delegation.amendReason,
    frozenAt
  };
}

function seedDelegations(routes: RouteRule[]): Delegation[] {
  const find = (name: string) => routes.find((route) => route.name === name)!;

  // 委托1：已确认，客户责任，签收记录齐全，6 小时等待 → 4×120=480（未超 600 上限）
  const d1: Delegation = {
    id: "dlg-seed-1",
    quoteId: "seed-1",
    customer: "海沃商贸",
    routeName: "上海-南京",
    service: "标准达",
    confirmedFreight: calcFreight(180, "标准达"),
    routeFreeHours: find("上海-南京").freeHours,
    routeHourlyRate: find("上海-南京").hourlyRate,
    version: 1,
    start: fixedIso("2026-09-18", 8),
    end: fixedIso("2026-09-18", 14),
    party: "客户",
    cap: 600,
    credentials: [credential("crd-seed-1", "签收记录", "POD-20260918-海沃商贸签收单.pdf", "2026-09-18", 15)],
    reductions: [],
    status: "已确认",
    amendReason: "",
    createdAt: fixedIso("2026-09-18", 16),
    frozenVersions: []
  };

  // 委托2：待复核，系统责任，线路公告缺失
  const d2: Delegation = {
    id: "dlg-seed-2",
    quoteId: "seed-3",
    customer: "远东建材",
    routeName: "杭州-合肥",
    service: "标准达",
    confirmedFreight: calcFreight(220, "标准达"),
    routeFreeHours: find("杭州-合肥").freeHours,
    routeHourlyRate: find("杭州-合肥").hourlyRate,
    version: 1,
    start: fixedIso("2026-09-19", 7, 30),
    end: fixedIso("2026-09-19", 17, 30),
    party: "系统",
    cap: 500,
    credentials: [],
    reductions: [],
    status: "待复核",
    amendReason: "",
    createdAt: fixedIso("2026-09-19", 18),
    frozenVersions: []
  };

  // 委托3：已结算，曾因结算后补录新建 v2，旧值冻结保留
  const v1Frozen: DelegationSnapshot = {
    version: 1,
    start: fixedIso("2026-09-16", 6),
    end: fixedIso("2026-09-16", 14),
    party: "客户",
    cap: 800,
    detentionRaw: 750,
    detention: 750,
    capped: false,
    credentials: [credential("crd-seed-2", "签收记录", "POD-20260916-岭南鲜果签收单.pdf", "2026-09-16", 14, 30)],
    reductions: [],
    status: "已结算",
    amendReason: "",
    frozenAt: fixedIso("2026-09-16", 20)
  };
  const d3: Delegation = {
    id: "dlg-seed-3",
    quoteId: "seed-4",
    customer: "岭南鲜果",
    routeName: "广州-深圳",
    service: "次日达",
    confirmedFreight: calcFreight(130, "次日达"),
    routeFreeHours: find("广州-深圳").freeHours,
    routeHourlyRate: find("广州-深圳").hourlyRate,
    version: 2,
    start: fixedIso("2026-09-16", 6),
    end: fixedIso("2026-09-17", 0, 30),
    party: "客户",
    cap: 800,
    credentials: [credential("crd-seed-2", "签收记录", "POD-20260916-岭南鲜果签收单.pdf", "2026-09-16", 14, 30)],
    reductions: [
      {
        id: "red-seed-1",
        party: "客户",
        requested: 200,
        cap: Math.round(calcFreight(130, "次日达") * 0.2 * 100) / 100,
        allowed: true,
        ruleText: "非系统责任减免不得超过已确认运费的两成（上限 ¥234.00）",
        reason: "长期客户，协商减免",
        appliedAt: fixedIso("2026-09-17", 11)
      }
    ],
    status: "已结算",
    amendReason: "现场补录实际离场时间为 00:30",
    createdAt: fixedIso("2026-09-16", 18),
    frozenVersions: [v1Frozen]
  };

  return [d1, d2, d3];
}

// ---------- 加载 / 保存 ----------

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadState(): DeskState {
  const seededRoutes = seedRoutes();
  const routes = readJson<RouteRule[]>(ROUTE_KEY) ?? seededRoutes;

  // 兼容旧版试算器：旧报价记录缺少 fee 字段时按规则补算
  const legacy = readJson<QuoteRecord[]>(QUOTE_KEY);
  const quotes = (legacy ?? seedQuotes()).map((quote) => ({
    ...quote,
    fee: typeof quote.fee === "number" ? quote.fee : calcFreight(Number(quote.weight) || 0, String(quote.service))
  }));

  const delegations = readJson<Delegation[]>(DELEGATION_KEY) ?? seedDelegations(routes);

  return { quotes, routes, delegations };
}

export const state = reactive<DeskState>(loadState());

function persistQuotes() {
  localStorage.setItem(QUOTE_KEY, JSON.stringify(state.quotes));
}
function persistRoutes() {
  localStorage.setItem(ROUTE_KEY, JSON.stringify(state.routes));
}
function persistDelegations() {
  localStorage.setItem(DELEGATION_KEY, JSON.stringify(state.delegations));
}

// ---------- 派生计算 ----------

export function detentionOf(delegation: Delegation): DetentionCalc | null {
  return calcDetention(delegation.start, delegation.end, {
    freeHours: delegation.routeFreeHours,
    hourlyRate: delegation.routeHourlyRate,
    cap: delegation.cap
  });
}

export function credentialsReady(delegation: Delegation): boolean {
  return evaluateCredentials(delegation.party, delegation.credentials).satisfied;
}

export function approvedReductionTotal(delegation: Delegation): number {
  return delegation.reductions
    .filter((item) => item.allowed)
    .reduce((acc, item) => acc + item.requested, 0);
}

export function payableOf(delegation: Delegation): number {
  const detention = detentionOf(delegation)?.amount ?? 0;
  return Math.max(0, detention - approvedReductionTotal(delegation));
}

// ---------- 报价 ----------

export const quoteStatuses = ["草稿", "已报价", "已复制"] as const;

export function addQuote(input: Omit<QuoteRecord, "id" | "status" | "createdAt" | "fee"> & { status?: string }): QuoteRecord {
  const record: QuoteRecord = {
    ...input,
    id: uid("quote"),
    fee: calcFreight(Number(input.weight) || 0, input.service),
    status: input.status ?? "草稿",
    createdAt: nowIso()
  };
  state.quotes = [record, ...state.quotes];
  persistQuotes();
  return record;
}

export function advanceQuote(id: string): void {
  const quote = state.quotes.find((item) => item.id === id);
  if (!quote) return;
  const index = quoteStatuses.indexOf(quote.status as (typeof quoteStatuses)[number]);
  quote.status = quoteStatuses[(index + 1) % quoteStatuses.length];
  persistQuotes();
}

export function removeQuote(id: string): void {
  state.quotes = state.quotes.filter((item) => item.id !== id);
  persistQuotes();
}

export function quotedQuotes(): QuoteRecord[] {
  return state.quotes.filter((quote) => quote.status === "已报价");
}

export function quoteUsedByDelegation(quoteId: string): boolean {
  return state.delegations.some((delegation) => delegation.quoteId === quoteId);
}

// ---------- 线路 ----------

export function addRoute(input: Omit<RouteRule, "id">): RouteRule {
  const route: RouteRule = { ...input, id: uid("route") };
  state.routes = [route, ...state.routes];
  persistRoutes();
  return route;
}

export function removeRoute(id: string): void {
  state.routes = state.routes.filter((item) => item.id !== id);
  persistRoutes();
}

export function routeByName(name: string): RouteRule | undefined {
  return state.routes.find((route) => route.name === name);
}

// ---------- 委托 ----------

function findDelegation(id: string): Delegation {
  const delegation = state.delegations.find((item) => item.id === id);
  if (!delegation) throw new Error("委托不存在");
  return delegation;
}

export function canCreateDelegation(quoteId: string): boolean {
  const quote = state.quotes.find((item) => item.id === quoteId);
  return quote?.status === "已报价";
}

export interface CreateDelegationInput {
  quoteId: string;
  start: string;
  end: string;
  party: ResponsibleParty;
  cap: number;
}

export function createDelegation(input: CreateDelegationInput): Delegation {
  const quote = state.quotes.find((item) => item.id === input.quoteId);
  if (!quote) throw new Error("报价记录不存在");
  if (quote.status !== "已报价") throw new Error("只有已报价记录才能生成委托");
  if (waitingHoursInvalid(input.start, input.end)) throw new Error("等待起止时间无效");

  const route = routeByName(quote.route);
  const delegation: Delegation = {
    id: uid("dlg"),
    quoteId: quote.id,
    customer: quote.customer,
    routeName: quote.route,
    service: quote.service,
    confirmedFreight: quote.fee,
    routeFreeHours: route?.freeHours ?? 0,
    routeHourlyRate: route?.hourlyRate ?? 0,
    version: 1,
    start: input.start,
    end: input.end,
    party: input.party,
    cap: input.cap,
    credentials: [],
    reductions: [],
    status: "待复核",
    amendReason: "",
    createdAt: nowIso(),
    frozenVersions: []
  };
  state.delegations = [delegation, ...state.delegations];
  persistDelegations();
  return delegation;
}

function waitingHoursInvalid(start: string, end: string): boolean {
  return new Date(end).getTime() <= new Date(start).getTime();
}

/** 凭据缺失时留待复核：仅凭据齐全的委托可以确认 */
export function attachCredential(id: string, type: CredentialType, title: string): Credential {
  const delegation = findDelegation(id);
  const credentialRecord: Credential = { id: uid("crd"), type, title: title || `${type}-未命名凭据`, attachedAt: nowIso() };
  delegation.credentials = [...delegation.credentials, credentialRecord];
  persistDelegations();
  return credentialRecord;
}

export function removeCredential(id: string, credentialId: string): void {
  const delegation = findDelegation(id);
  if (delegation.status === "已结算") throw new Error("已结算委托费用冻结，不能修改凭据");
  delegation.credentials = delegation.credentials.filter((item) => item.id !== credentialId);
  persistDelegations();
}

export function confirmDelegation(id: string): void {
  const delegation = findDelegation(id);
  if (delegation.status !== "待复核") throw new Error("仅待复核委托可以确认");
  if (!credentialsReady(delegation)) {
    throw new Error(evaluateCredentials(delegation.party, delegation.credentials).ruleText + "，凭据缺失时留待复核");
  }
  delegation.status = "已确认";
  persistDelegations();
}

/** 申请减免；超额度整笔拒绝并留痕（委托、责任方、原值、上限、规则） */
export function applyReduction(id: string, requested: number, reason: string): ReductionRecord {
  const delegation = findDelegation(id);
  if (delegation.status !== "已确认") throw new Error("仅已确认委托可以申请减免");

  const detention = detentionOf(delegation);
  const result: ReductionRuleResult = evaluateReduction({
    party: delegation.party,
    requested,
    confirmedFreight: delegation.confirmedFreight,
    confirmedDetention: detention?.amount ?? 0
  });

  const record: ReductionRecord = {
    id: uid("red"),
    party: result.party,
    requested: result.requested,
    cap: result.cap,
    allowed: result.allowed,
    ruleText: result.ruleText,
    reason: reason || "未填写减免原因",
    appliedAt: nowIso()
  };
  delegation.reductions = [...delegation.reductions, record];
  persistDelegations();

  if (!result.allowed) {
    throw new Error(
      `减免整笔拒绝｜委托 ${delegation.id}｜责任方 ${result.party}｜原值 ${result.requested}｜上限 ${result.cap}｜规则：${result.ruleText}`
    );
  }
  return record;
}

/** 结算后费用冻结 */
export function settleDelegation(id: string): DelegationSnapshot {
  const delegation = findDelegation(id);
  if (delegation.status !== "已确认") throw new Error("仅已确认委托可以结算");
  const frozenAt = nowIso();
  delegation.status = "已结算";
  const snapshot = snapshotOf(delegation, frozenAt);
  delegation.frozenVersions = [...delegation.frozenVersions, snapshot];
  persistDelegations();
  return snapshot;
}

/** 结算后补录：只能新建带原因版本并保留旧值 */
export function amendDelegation(
  id: string,
  input: Partial<Pick<Delegation, "start" | "end" | "cap" | "party">> & { reason: string }
): Delegation {
  const delegation = findDelegation(id);
  if (delegation.status !== "已结算") throw new Error("仅已结算委托需要补录新版本");
  if (!input.reason.trim()) throw new Error("补录必须填写原因");

  const next: Delegation = {
    ...delegation,
    version: delegation.version + 1,
    start: input.start ?? delegation.start,
    end: input.end ?? delegation.end,
    cap: input.cap ?? delegation.cap,
    party: input.party ?? delegation.party,
    credentials: delegation.credentials.map((item) => ({ ...item })),
    reductions: [],
    status: "待复核",
    amendReason: input.reason.trim(),
    frozenVersions: delegation.frozenVersions.map((item) => ({ ...item }))
  };
  Object.assign(delegation, next);
  persistDelegations();
  return delegation;
}

export { VERSION as STORAGE_VERSION };
