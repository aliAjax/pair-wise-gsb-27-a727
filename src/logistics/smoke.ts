import { calcDemurrage, evaluateReduction, round2 } from "./rules";
import type { Consignment, DemurrageVersion, Reduction, ResponsibleParty } from "./types";

const rule = { freeHours: 2, hourlyRate: 60, cap: 800 };
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass += 1; } else { fail += 1; console.error(`FAIL: ${name} ${detail}`); }
}

// 1) 免费时段内
let r = calcDemurrage("2026-09-22T08:00", "2026-09-22T09:30", rule) as any;
check("免费时段内费用为0", r.confirmedAmount === 0 && r.withinFree, JSON.stringify(r));

// 2) 超时 15 分钟按整点进位 1 小时
r = calcDemurrage("2026-09-22T08:00", "2026-09-22T10:15", rule) as any;
check("超时15分钟进位1小时=60", r.chargeableHours === 1 && r.confirmedAmount === 60, JSON.stringify(r));

// 3) 超上限裁剪：等待20h，超免费2h即18计费小时 × 60 = 1080，上限 800，超限 280 不得确认
r = calcDemurrage("2026-09-22T08:00", "2026-09-23T04:00", rule) as any;
check("超上限裁剪800/拒280", r.rawAmount === 1080 && r.confirmedAmount === 800 && r.rejectedExcess === 280, JSON.stringify(r));

// 4) 委托登记更低上限 500：原值 1080，确认 500，拒 580
r = calcDemurrage("2026-09-22T08:00", "2026-09-23T04:00", rule, 500) as any;
check("登记上限500", r.confirmedAmount === 500 && r.rejectedExcess === 580, JSON.stringify(r));

// 5) 结束早于开始报错
r = calcDemurrage("2026-09-22T10:00", "2026-09-22T09:00", rule) as any;
check("时间倒置报错", "error" in r);

// 6) 客户责任减免：运费 1260 → 上限 252；申请 300 整笔拒绝
const v = (party: ResponsibleParty, amount: number): DemurrageVersion => ({
  version: 1, waitStart: "", waitEnd: "", waitedHours: 0, chargeableHours: 0,
  rawAmount: amount, cap: 800, confirmedAmount: amount, rejectedExcess: 0,
  responsibleParty: party, evidence: null, status: "已确认",
  createdAt: "", confirmedAt: null, settledAt: null, reason: "",
});
let reductions: Reduction[] = [];
let chk = evaluateReduction(1260, v("客户", 800), reductions, 300);
check("客户300>252拒绝", !chk.allowed && chk.cap === 252 && chk.remaining === 252, JSON.stringify(chk));

// 7) 客户申请 200 通过，再申请 52.01 拒绝，52 通过（累计 252）
chk = evaluateReduction(1260, v("客户", 800), reductions, 200);
check("客户200通过", chk.allowed, JSON.stringify(chk));
reductions.push({ id: "a", version: 1, requestedAmount: 200, approvedAmount: 200, status: "已减免", reason: "", policyCap: 252, alreadyReduced: 0, rule: "", appliedAt: "" });
chk = evaluateReduction(1260, v("客户", 800), reductions, 52.01);
check("客户累计超限拒绝", !chk.allowed && chk.alreadyReduced === 200 && round2(chk.remaining) === 52, JSON.stringify(chk));
chk = evaluateReduction(1260, v("客户", 800), reductions, 52);
check("客户累计恰好252通过", chk.allowed);

// 8) 系统责任可全额减免（上限=已确认滞留费800）
chk = evaluateReduction(1260, v("系统", 800), [], 800);
check("系统全额800通过", chk.allowed && chk.cap === 800, JSON.stringify(chk));
chk = evaluateReduction(1260, v("系统", 800), [], 800.01);
check("系统800.01拒绝", !chk.allowed);

// 9) 客户滞留费仅 100 时，上限为 min(100, 252)=100
chk = evaluateReduction(1260, v("客户", 100), [], 100);
check("客户减免不超滞留费本身", chk.allowed && chk.cap === 100, JSON.stringify(chk));

// 10) 往返存储：构造委托 JSON 序列化后字段完整
const c: Consignment = {
  id: "x", code: "WT1", quoteId: "q", customer: "海沃", route: "上海-南京", freight: 1260,
  versions: [v("系统", 800)], reductions, createdAt: "",
};
const back = JSON.parse(JSON.stringify(c)) as Consignment;
check("序列化一致", back.versions[0].confirmedAmount === 800 && back.reductions.length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) throw new Error("smoke tests failed");
