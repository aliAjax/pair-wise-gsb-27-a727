// 滞留费责任确认与减免台 —— 领域类型定义

/** 责任方：系统（承运方系统原因）/ 客户（委托客户原因） */
export type ResponsibleParty = "系统" | "客户";

export type ServiceType = "标准达" | "次日达" | "冷链";

/** 报价记录：只有“已报价”状态的记录才能生成运输委托 */
export interface QuoteRecord {
  id: string;
  customer: string;
  route: string;
  weight: number;
  /** 已确认运费（元），作为减免额度计算基数 */
  freight: number;
  service: ServiceType;
  status: "草稿" | "已报价" | "已复制";
  notes: string;
  createdAt: string;
}

/** 线路规则：免费等待时段、超时单价、滞留费上限 */
export interface RouteRule {
  route: string;
  /** 免费等待时长（小时） */
  freeHours: number;
  /** 超时单价（元/小时），按整点进位 */
  hourlyRate: number;
  /** 该线路单趟滞留费上限（元），超出上限的部分不得确认 */
  cap: number;
}

export type EvidenceKind = "线路公告" | "签收记录";

/** 凭据：系统责任须附线路公告，客户责任须附签收记录 */
export interface Evidence {
  kind: EvidenceKind;
  reference: string;
  attachedAt: string;
}

export type VersionStatus = "待确认" | "待复核" | "已确认" | "已结算";

/**
 * 滞留费版本：委托结算冻结后，补录只能新建带原因的版本，
 * 旧版本（含旧值与减免）原样保留、只读。
 */
export interface DemurrageVersion {
  version: number;
  waitStart: string;
  waitEnd: string;
  waitedHours: number;
  chargeableHours: number;
  /** 按规则试算的滞留费原值 */
  rawAmount: number;
  /** 委托登记的费用上限 */
  cap: number;
  /** 可确认金额（不超过上限） */
  confirmedAmount: number;
  /** 超出上限、不得确认的部分 */
  rejectedExcess: number;
  responsibleParty: ResponsibleParty;
  evidence: Evidence | null;
  status: VersionStatus;
  createdAt: string;
  confirmedAt: string | null;
  settledAt: string | null;
  /** 新版本相对上一版本的补录原因 */
  reason: string;
}

export type ReductionStatus = "已减免" | "已拒绝";

/** 减免申请记录：无论通过或拒绝都留痕，拒绝时记录命中规则 */
export interface Reduction {
  id: string;
  version: number;
  requestedAmount: number;
  approvedAmount: number;
  status: ReductionStatus;
  reason: string;
  /** 申请时该责任方对应的减免上限（系统责任=滞留原值；其他责任=已确认运费两成） */
  policyCap: number;
  /** 申请前本版本已累计减免，便于复核额度构成 */
  alreadyReduced: number;
  /** 超额度整笔拒绝时命中的规则说明 */
  rule: string;
  appliedAt: string;
}

/** 运输委托：由“已报价”记录生成，冻结点在当前版本结算时 */
export interface Consignment {
  id: string;
  code: string;
  quoteId: string;
  customer: string;
  route: string;
  /** 已确认运费快照（取自报价记录） */
  freight: number;
  versions: DemurrageVersion[];
  reductions: Reduction[];
  createdAt: string;
}

export interface RejectionInfo {
  consignmentCode: string;
  responsibleParty: ResponsibleParty;
  /** 滞留费原值（试算值，未裁剪） */
  demurrageRaw: number;
  /** 可确认滞留费（上限裁剪后） */
  confirmedAmount: number;
  /** 本次申请减免的原值 */
  requestedAmount: number;
  cap: number;
  rule: string;
}
