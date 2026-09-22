// 滞留费业务规则层：纯函数，不依赖存储与页面。

export type ResponsibleParty = "系统" | "客户" | "承运商";

export type CredentialType = "线路公告" | "签收记录";

export type DelegationStatus = "待复核" | "已确认" | "已结算";

export type ReviewStage = "待复核" | "已确认";

export interface RouteRule {
  id: string;
  name: string;
  /** 免费等待小时数 */
  freeHours: number;
  /** 超时后每小时滞留费（元） */
  hourlyRate: number;
  /** 单次滞留费上限（元） */
  cap: number;
}

export interface Credential {
  id: string;
  type: CredentialType;
  title: string;
  attachedAt: string;
}

export interface DetentionCalc {
  waitingHours: number;
  freeHours: number;
  chargeableHours: number;
  hourlyRate: number;
  rawAmount: number;
  capped: boolean;
  cap: number;
  /** 实际可确认金额：超限部分不得确认 */
  amount: number;
}

export interface CredentialRequirement {
  party: ResponsibleParty;
  requiredType: CredentialType | null;
  satisfied: boolean;
  ruleText: string;
}

export interface ReductionRuleResult {
  party: ResponsibleParty;
  /** 规则允许的减免比例 */
  maxRate: number;
  /** 规则允许的减免金额上限 */
  cap: number;
  allowed: boolean;
  requested: number;
  ruleText: string;
}

export const RESPONSIBLE_PARTIES: readonly ResponsibleParty[] = ["系统", "客户", "承运商"];
export const CREDENTIAL_TYPES: readonly CredentialType[] = ["线路公告", "签收记录"];

export const NON_SYSTEM_REDUCTION_RATE = 0.2;

const SERVICE_UNIT_PRICE: Record<string, number> = {
  标准达: 7,
  次日达: 9,
  冷链: 12
};

/** 运费试算（复用原报价能力，作为已确认运费的数值来源） */
export function calcFreight(weight: number, service: string): number {
  const rate = SERVICE_UNIT_PRICE[service] ?? 7;
  return Math.max(100, Math.round(weight * rate));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 等待小时数：起止时间差，不足 1 小时按 1 小时计 */
export function waitingHoursBetween(start: string, end: string): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  return Math.max(1, Math.ceil((endMs - startMs) / 3600000));
}

/** 滞留费：超过免费时段按线路费率计算，超过线路上限的部分不得确认 */
export function calcDetention(
  start: string,
  end: string,
  route: Pick<RouteRule, "freeHours" | "hourlyRate" | "cap">
): DetentionCalc | null {
  const waitingHours = waitingHoursBetween(start, end);
  if (waitingHours === null) return null;
  const chargeableHours = Math.max(0, waitingHours - route.freeHours);
  const rawAmount = round2(chargeableHours * route.hourlyRate);
  const capped = rawAmount > route.cap;
  return {
    waitingHours,
    freeHours: route.freeHours,
    chargeableHours,
    hourlyRate: route.hourlyRate,
    rawAmount,
    capped,
    cap: route.cap,
    amount: Math.min(rawAmount, route.cap)
  };
}

/** 凭据规则：系统原因须附线路公告，客户原因须附签收记录，承运商无强制凭据 */
export function evaluateCredentials(
  party: ResponsibleParty,
  credentials: Credential[]
): CredentialRequirement {
  if (party === "系统") {
    const satisfied = credentials.some((item) => item.type === "线路公告");
    return {
      party,
      requiredType: "线路公告",
      satisfied,
      ruleText: "系统原因须附线路公告"
    };
  }
  if (party === "客户") {
    const satisfied = credentials.some((item) => item.type === "签收记录");
    return {
      party,
      requiredType: "签收记录",
      satisfied,
      ruleText: "客户原因须附签收记录"
    };
  }
  return {
    party,
    requiredType: null,
    satisfied: true,
    ruleText: "承运商责任无强制凭据，凭据缺失不影响确认"
  };
}

/**
 * 减免规则：
 * - 非系统责任减免不得超过已确认运费的两成；
 * - 系统责任可全额减免（以已确认滞留费为上限）；
 * - 超额度整笔拒绝（不做部分减免）。
 */
export function evaluateReduction(params: {
  party: ResponsibleParty;
  requested: number;
  confirmedFreight: number;
  confirmedDetention: number;
}): ReductionRuleResult {
  const { party, requested, confirmedFreight, confirmedDetention } = params;
  if (party === "系统") {
    const cap = round2(confirmedDetention);
    return {
      party,
      maxRate: 1,
      cap,
      allowed: requested > 0 && requested <= cap,
      requested,
      ruleText: "系统责任可全额减免（不超过已确认滞留费）"
    };
  }
  const cap = round2(confirmedFreight * NON_SYSTEM_REDUCTION_RATE);
  return {
    party,
    maxRate: NON_SYSTEM_REDUCTION_RATE,
    cap,
    allowed: requested > 0 && requested <= cap,
    requested,
    ruleText: `非系统责任减免不得超过已确认运费的两成（上限 ${formatMoney(cap)}）`
  };
}

export function formatMoney(value: number): string {
  return `¥${(Math.round(value * 100) / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}
