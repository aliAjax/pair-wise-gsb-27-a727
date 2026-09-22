// 滞留费业务规则（纯函数层，不依赖存储与页面）
import type {
  Consignment,
  DemurrageVersion,
  EvidenceKind,
  Reduction,
  ResponsibleParty,
  RouteRule,
} from "./types";

export const DEFAULT_ROUTE_RULES: RouteRule[] = [
  { route: "上海-南京", freeHours: 2, hourlyRate: 60, cap: 800 },
  { route: "杭州-合肥", freeHours: 3, hourlyRate: 50, cap: 600 },
  { route: "广州-长沙", freeHours: 2, hourlyRate: 70, cap: 900 },
  { route: "北京-济南", freeHours: 4, hourlyRate: 45, cap: 500 },
];

/** 非系统责任（客户等）减免上限：已确认运费的两成（20%） */
export const NON_SYSTEM_REDUCTION_RATE = 0.2;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface DemurrageCalc {
  waitedHours: number;
  chargeableHours: number;
  rawAmount: number;
  confirmedAmount: number;
  rejectedExcess: number;
  withinFree: boolean;
}

/**
 * 计算滞留费：
 * 1. 超出免费时段的等待时间按整点向上取整计费；
 * 2. 滞留费 = 计费小时 × 线路单价；
 * 3. 费用上限按委托登记值（默认取线路上限）裁剪，超限部分不得确认。
 */
export function calcDemurrage(
  waitStart: string,
  waitEnd: string,
  rule: Pick<RouteRule, "freeHours" | "hourlyRate" | "cap">,
  registeredCap?: number,
): DemurrageCalc | { error: string } {
  const startMs = Date.parse(waitStart);
  const endMs = Date.parse(waitEnd);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return { error: "等待起止时间不完整" };
  }
  if (endMs <= startMs) {
    return { error: "等待结束时间必须晚于开始时间" };
  }
  const waitedHours = round2((endMs - startMs) / 3_600_000);
  const overHours = Math.max(0, waitedHours - rule.freeHours);
  const chargeableHours = overHours > 0 ? Math.ceil(overHours) : 0;
  if (chargeableHours === 0) {
    return { waitedHours, chargeableHours: 0, rawAmount: 0, confirmedAmount: 0, rejectedExcess: 0, withinFree: true };
  }
  const cap = round2(registeredCap ?? rule.cap);
  const rawAmount = round2(chargeableHours * rule.hourlyRate);
  const confirmedAmount = round2(Math.min(rawAmount, cap));
  return {
    waitedHours,
    chargeableHours,
    rawAmount,
    confirmedAmount,
    rejectedExcess: round2(Math.max(0, rawAmount - cap)),
    withinFree: false,
  };
}

/** 责任方对应的凭据类型：系统原因须附线路公告，客户原因须附签收记录 */
export function requiredEvidenceKind(party: ResponsibleParty): EvidenceKind {
  return party === "系统" ? "线路公告" : "签收记录";
}

export function evidenceLabel(party: ResponsibleParty): string {
  return party === "系统" ? "线路公告编号" : "签收记录编号";
}

/** 凭据是否齐备；免费时段内费用为 0 无需凭据，缺失时留待复核，不得直接确认 */
export function isEvidenceSatisfied(version: DemurrageVersion, party: ResponsibleParty): boolean {
  if (version.confirmedAmount === 0) return true;
  return !!version.evidence && version.evidence.kind === requiredEvidenceKind(party) && version.evidence.reference.trim() !== "";
}

/**
 * 减免上限：
 * - 系统责任：可全额减免（上限=已确认滞留费）；
 * - 非系统责任：不得超过已确认运费的两成，且不得超过滞留费本身。
 */
export function reductionCap(freight: number, confirmedAmount: number, party: ResponsibleParty): number {
  if (party === "系统") return round2(confirmedAmount);
  return round2(Math.min(confirmedAmount, freight * NON_SYSTEM_REDUCTION_RATE));
}

export interface ReductionCheck {
  allowed: boolean;
  cap: number;
  alreadyReduced: number;
  remaining: number;
  rule: string;
}

/**
 * 校验整笔减免申请：累计已减免 + 本次申请不得超过责任方对应上限。
 * 超额度整笔拒绝（不做部分批准）。
 */
export function evaluateReduction(
  freight: number,
  version: DemurrageVersion,
  reductions: Reduction[],
  requestedAmount: number,
): ReductionCheck {
  const cap = reductionCap(freight, version.confirmedAmount, version.responsibleParty);
  const alreadyReduced = round2(
    reductions
      .filter((item) => item.version === version.version && item.status === "已减免")
      .reduce((sum, item) => sum + item.approvedAmount, 0),
  );
  const remaining = round2(Math.max(0, cap - alreadyReduced));
  const requested = round2(requestedAmount);
  const rule =
    version.responsibleParty === "系统"
      ? "系统责任可全额减免，申请额度不得超过已确认滞留费"
      : "非系统责任减免不得超过已确认运费的两成（20%）";
  if (!(requested > 0)) {
    return { allowed: false, cap, alreadyReduced, remaining, rule: "减免金额必须大于 0" };
  }
  if (round2(alreadyReduced + requested) > cap) {
    return { allowed: false, cap, alreadyReduced, remaining, rule };
  }
  return { allowed: true, cap, alreadyReduced, remaining, rule };
}

/** 委托当前（最新）版本 */
export function latestVersion(consignment: Consignment): DemurrageVersion {
  return consignment.versions.reduce((a, b) => (b.version > a.version ? b : a), consignment.versions[0]);
}

/** 本版本已批准减免合计 */
export function versionReductions(consignment: Consignment, versionNo: number): Reduction[] {
  return consignment.reductions.filter((item) => item.version === versionNo);
}

export function versionApprovedReduction(consignment: Consignment, versionNo: number): number {
  return round2(
    versionReductions(consignment, versionNo)
      .filter((item) => item.status === "已减免")
      .reduce((sum, item) => sum + item.approvedAmount, 0),
  );
}
