"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  money,
  ownerLabel,
  type Asset,
  type BudgetItem,
  type Debt,
  type WealthState,
} from "@/lib/wealth";

type Field = { key: string; label: string; placeholder?: string };
type CheckItem = { id: string; text: string };

const sections: {
  id: string;
  title: string;
  intro: string;
  fields?: Field[];
  checks?: CheckItem[];
  points?: string[];
}[] = [
  {
    id: "inventory",
    title: "01 · 先补齐信息",
    intro:
      "先把家庭全貌放到同一张桌面上。无需一次填完，收入和余额可以先写范围。",
    fields: [
      {
        key: "income_a",
        label: "成员一收入情况（现金流表自动汇总税后月收入）",
      },
      {
        key: "income_b",
        label: "成员二收入情况（现金流表自动汇总税后月收入）",
      },
      {
        key: "location_status",
        label: "居住地与婚姻 / 税务状态",
        placeholder: "例如 Toronto, Ontario；记录需要核对或更新的状态",
      },
      {
        key: "monthly_costs",
        label: "每月固定与浮动开销",
        placeholder: "住房、车、保险、食物、订阅、父母支持等",
      },
      {
        key: "assets_list",
        label: "资产账户清单",
        placeholder:
          "Joint chequing、个人 chequing、HISA、GIC、TFSA、RRSP、FHSA、非注册投资、公司股权、房产、车等",
      },
      {
        key: "debts_list",
        label: "债务清单",
        placeholder:
          "信用卡、学生贷款、车贷、LOC、房贷；尽量记录余额、利率和最低还款",
      },
      {
        key: "goals_horizon",
        label: "未来 1–5 年目标",
        placeholder:
          "买房 / 换房、生育、移民、创业、读书、赡养父母、大额旅行等",
      },
      {
        key: "risk_experience",
        label: "投资经验与可接受亏损",
        placeholder: "账户一年下跌 20% 时，我们会怎么做？",
      },
      {
        key: "legacy_notes",
        label: "遗嘱、保险、受益人、婚前资产、家庭赠与 / 继承现状",
      },
    ],
  },
  {
    id: "accounts",
    title: "02 · 共同账户与现金流",
    intro:
      "采用“共同生活账户 + 个人独立账户”的混合模式，既把家庭责任放在一起，也保留个人空间。",
    fields: [
      {
        key: "joint_use",
        label: "共同运营账户用途",
        placeholder:
          "例如 BMO joint chequing：房贷 / 房租、物业费、水电网、共同食物、旅行储蓄、保险、家庭订阅",
      },
      {
        key: "split_method",
        label: "共同开销分摊方式",
        placeholder:
          "50/50、按税后收入比例，或其他约定；收入差距明显时可记录按收入比例的理由",
      },
      {
        key: "transfer_rule",
        label: "自动转账规则",
        placeholder:
          "发薪后 24–48 小时，各自转入共同运营账户与储蓄账户的金额 / 比例",
      },
      {
        key: "large_purchase",
        label: "大额支出双方确认门槛",
        placeholder: "超过多少金额需要先共同确认？",
      },
      {
        key: "credit_rule",
        label: "信用卡、账单负责人和备用负责人",
        placeholder: "共同开销使用哪张卡、如何报销 / 还款、谁负责核对",
      },
      { key: "meeting_date", label: "每月 30 分钟家庭财务会议日期与分工" },
    ],
    points: [
      "joint operating：支付共同账单。",
      "joint emergency：共同应急金，放在流动性较好的储蓄工具中。",
      "short-term goals：1–3 年内要用的旅行、搬家、买车资金。",
      "long-term investing：TFSA / RRSP / FHSA / 非注册投资。",
      "personal freedom：双方个人账户和约定的自由支出。",
      "joint account 的共有人通常共享使用权，也可能共同承担账户相关责任；讨论是否关闭或限制 overdraft。",
    ],
  },
  {
    id: "balance",
    title: "03 · 家庭资产负债表",
    intro:
      "建议每季度更新一次。资产与债务分开记录，避免只看投资账户而漏掉责任。",
    fields: [
      {
        key: "cash_accounts",
        label: "现金：joint / personal chequing、HISA、GIC",
      },
      {
        key: "registered_accounts",
        label: "注册账户：TFSA、RRSP、FHSA、RESP（如适用）",
      },
      {
        key: "investments",
        label: "非注册投资：brokerage、股票、ETF、crypto、公司股权",
      },
      {
        key: "physical_assets",
        label: "实物 / 权益：房产、车、贵重物品、养老金、保险现金价值",
      },
      { key: "debt_high", label: "负债余额（与账户明细联动）" },
      {
        key: "debt_other",
        label: "债务利率、最低还款与清偿优先级备注",
      },
      {
        key: "hidden_obligations",
        label: "隐性义务：父母支持、学费、婚礼尾款、税款、租约违约成本等",
      },
    ],
    points: [
      "净资产 = 总资产 − 总债务。",
      "流动净资产 = 现金 + 可快速变现投资 − 短期债务。",
      "固定支出率 = 必要开支 ÷ 税后收入。",
      "储蓄投资率 = 每月储蓄和投资 ÷ 税后收入。",
      "债务服务率 = 每月债务还款 ÷ 收入；买房准备时尤其值得关注。",
    ],
  },
  {
    id: "emergency",
    title: "04 · 应急金",
    intro:
      "用必要开支来设目标，并把共同责任与个人责任区分开。应急金不应承担股票市场波动。",
    fields: [
      {
        key: "essential_monthly",
        label: "每月必要开支（CAD）",
        placeholder: "住房、食物、水电、保险、交通、最低债务还款",
      },
      {
        key: "emergency_months",
        label: "目标覆盖月数",
        placeholder:
          "双收入且稳定：3–6；单收入、收入波动、自雇、有房贷或计划生育：6–12",
      },
      { key: "emergency_current", label: "当前可用应急金（CAD）" },
      {
        key: "emergency_location",
        label: "存放账户与每月投入计划",
        placeholder: "共同 HISA / 个人应急金 / 每月自动储蓄",
      },
    ],
    points: [
      "共同应急金覆盖共同责任；个人应急金覆盖个人信用卡、家庭支持、个人医疗或职业空档。",
      "可考虑 HISA、cash ETF 或短期 GIC ladder，但要兼顾流动性和 CDIC 保障类别。",
    ],
  },
  {
    id: "goals",
    title: "05 · 目标分层",
    intro:
      "每个目标写清金额、时间、负责人、账户和每月投入；资金期限决定可承受的波动。",
    fields: [
      {
        key: "short_goals",
        label: "短期目标 · 0–2 年",
        placeholder:
          "应急金、清高息债、旅行、搬家、买车；金额 / 日期 / 账户 / 每月投入",
      },
      {
        key: "medium_goals",
        label: "中期目标 · 2–7 年",
        placeholder:
          "买房首付、育儿基金、职业转型；金额 / 日期 / 账户 / 每月投入",
      },
      {
        key: "long_goals",
        label: "长期目标 · 7 年以上",
        placeholder:
          "退休、财务自由、孩子教育、长期家庭资产；金额 / 日期 / 账户 / 每月投入",
      },
    ],
    points: [
      "短期目标通常优先考虑现金 / HISA / GIC，避免承担无法承受的市场波动。",
      "中期目标可结合 FHSA、HISA、GIC 或保守型组合，并按目标期限评估。",
      "长期目标可评估 TFSA、RRSP、非注册投资组合等账户。",
    ],
  },
  {
    id: "ips",
    title: "06 · 家庭投资政策（IPS）",
    intro:
      "把原则写下来，避免在市场大幅波动或临时冲动时临场决定。先记录风险能力与风险意愿，配置取更保守的一边。",
    fields: [
      { key: "ips_purpose", label: "投资目的与各账户对应目标" },
      {
        key: "ips_horizon",
        label: "时间范围",
        placeholder: "逐个目标记录，而不是只写一个家庭期限",
      },
      {
        key: "ips_capacity",
        label: "风险能力",
        placeholder: "收入稳定性、房贷压力、应急金、目标时间",
      },
      {
        key: "ips_comfort",
        label: "风险意愿",
        placeholder: "我们心理上能接受多大回撤？账户跌 20% 时如何行动？",
      },
      {
        key: "ips_allocation",
        label: "目标资产配置",
        placeholder: "等双方风险能力和意愿确认后再填写，不预设比例",
      },
      {
        key: "ips_allowed",
        label: "允许的投资产品",
        placeholder: "例如低成本 ETF、GIC、HISA、雇主计划",
      },
      {
        key: "ips_excluded",
        label: "不做的事情",
        placeholder: "例如借钱炒股、短线频繁交易、单一股票超过约定比例",
      },
      {
        key: "ips_rebalance",
        label: "再平衡规则",
        placeholder: "例如每半年检查，或偏离目标比例 5 个百分点时讨论调整",
      },
      {
        key: "ips_decision",
        label: "重大投资 / 卖出决策规则",
        placeholder: "超过约定金额的新增投资或卖出需要双方讨论",
      },
    ],
  },
  {
    id: "canada",
    title: "07 · 加拿大账户与税务协作",
    intro:
      "以下是规划思路，不代替 CRA 对个人额度的记录。额度、资格与税务规则请以 CRA 账户和官方页面为准。",
    points: [
      "常见优先顺序：先评估高息信用卡债；有雇主 RRSP / DPSP match 时了解如何拿满 match；符合首次购房条件时评估 FHSA；再结合当前和未来税率比较 TFSA 与 RRSP；注册账户用满后再看非注册账户。",
      "TFSA：灵活目标与长期增长常会考虑；供款额度以 CRA My Account 为准。",
      "RRSP：退休长期资产；实际 deduction limit 查看 CRA Notice of Assessment，并考虑 pension adjustment。",
      "FHSA：符合条件的首次购房者可评估；年度与终身额度、资格及 room 以 CRA 记录为准。",
      "非注册账户：注意记录 ACB、分红和资本利得；夫妻转钱投资可能涉及 attribution rules，可请 CPA 确认。",
      "材料中列出的 2026 参考额度：TFSA 年度额度 $7,000；RRSP dollar limit $33,810；FHSA 通常每年 $8,000、终身 $40,000。个人实际 room 和资格可能不同，请以 CRA 为准。",
      "每年 2–4 月整理 T4、T5、T3、RRSP receipts、FHSA slips、医疗、捐赠、学费和 childcare 文件。",
      "CRA marital status 通常需在状态变化后按规定及时更新；医疗费用、捐赠、RRSP 与 spousal RRSP 安排可请 CPA 核对。",
    ],
    checks: [
      { id: "cra_status", text: "已核对并更新 CRA marital status（如适用）" },
      {
        id: "cra_room",
        text: "已查看双方 TFSA room、RRSP deduction limit、FHSA 资格与 room",
      },
      {
        id: "tax_folder",
        text: "已建立家庭税务文件夹并分工收集 slips / receipts",
      },
      {
        id: "tax_review",
        text: "已讨论医疗费用、捐赠、RRSP 与 spousal RRSP 的申报安排",
      },
    ],
  },
  {
    id: "protection",
    title: "08 · 保险、房产与法律",
    intro: "把需要专业确认的事项列出来，逐项约谈并记录结论。",
    fields: [
      {
        key: "home_insurance",
        label: "租客 / 房屋 / 公寓保险：双方财物是否都覆盖？",
      },
      {
        key: "auto_insurance",
        label: "汽车保险：共用车辆或地址变化是否已更新？",
      },
      {
        key: "work_benefits",
        label: "工作福利：extended health / dental 是否协调？",
      },
      {
        key: "life_disability",
        label: "寿险与伤残险缺口：若一方无法工作或去世，另一方需覆盖多久？",
      },
      { key: "beneficiaries", label: "受益人指定核查与更新记录" },
      {
        key: "property_plan",
        label: "房产计划：首付来源、产权形式、出资比例、父母赠与 / 借款",
      },
      {
        key: "marriage_contract",
        label: "婚姻合同讨论与法律咨询记录",
        placeholder:
          "若有明显婚前资产、公司股权、赠与 / 继承、育儿停工或房产安排，可记录需咨询的问题",
      },
      {
        key: "will_poa",
        label: "遗嘱、Power of Attorney for Property / Personal Care 进度",
      },
    ],
    checks: [
      { id: "ins_home", text: "已核查 tenant / home / condo insurance" },
      { id: "ins_auto", text: "已核查 auto insurance 与地址信息" },
      { id: "ins_benefits", text: "已比较双方工作福利并核查受益人" },
      { id: "ins_life", text: "已讨论寿险、伤残险与家庭收入保障需求" },
      {
        id: "will_done",
        text: "遗嘱与两类 Power of Attorney 已完成或已预约专业咨询",
      },
      {
        id: "lawyer",
        text: "房产 / 婚姻合同 / 赠与继承问题已列出律师咨询清单",
      },
    ],
    points: [
      "若在 Toronto 买房，单独规划首付来源、贷款准备、land transfer tax / municipal land transfer tax 与可能适用的 rebate。",
      "材料提及的 CMHC 首付比例、价格上限及 rebate 资格会受规则和个人条件影响，购房前应向 CMHC、贷款机构或专业人士核实。",
      "安省婚姻财产与 matrimonial home 规则较复杂；如涉及婚前房产、家庭赠与或一方承担大额首付，可在购房 / 签约前咨询安省 family lawyer。婚姻合同应有充分披露并由双方独立律师审阅。",
    ],
  },
  {
    id: "execution",
    title: "09 · 30 / 60 / 90 天执行计划",
    intro:
      "先建立共同视图，再写规则，最后把自动化和复盘落地。勾选进度会自动保存。",
    checks: [
      { id: "d30_balance", text: "30 天：完成资产负债表与现金流表" },
      {
        id: "d30_joint",
        text: "30 天：确认共同账户用途、月转账金额、账单清单与 overdraft 规则",
      },
      {
        id: "d30_debt",
        text: "30 天：列出信用卡、贷款、投资账户、保险与受益人",
      },
      {
        id: "d30_room",
        text: "30 天：查看 CRA TFSA / RRSP / FHSA room 并确定每月家庭财务会议",
      },
      {
        id: "d60_split",
        text: "60 天：确定共同开销分摊方式与大额支出确认门槛",
      },
      {
        id: "d60_emergency",
        text: "60 天：确定应急金目标、储蓄账户与自动投入",
      },
      {
        id: "d60_debtplan",
        text: "60 天：写下高息债清偿计划与家庭 IPS 第一版",
      },
      {
        id: "d60_protection",
        text: "60 天：检查福利、保险缺口、受益人；需要时预约 family lawyer / CPA",
      },
      { id: "d90_auto", text: "90 天：设置自动转账、自动投资或定投" },
      {
        id: "d90_estate",
        text: "90 天：处理遗嘱、Power of Attorney 与受益人更新",
      },
      { id: "d90_tax", text: "90 天：建立税务文件夹与年度报税分工" },
      {
        id: "d90_review",
        text: "90 天：首次季度复盘净资产、储蓄率、预算偏差、投资配置与下季度目标",
      },
    ],
  },
];

const sourceLinks = [
  [
    "CRA · TFSA / RRSP 2026 limits",
    "https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html",
  ],
  [
    "CRA · TFSA contribution room",
    "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributing.html",
  ],
  [
    "CRA · FHSA rules",
    "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account/tax-deductions-fhsa-contributions.html",
  ],
  [
    "FCAC · Couples money management",
    "https://www.canada.ca/en/financial-consumer-agency/services/living-as-couple.html",
  ],
  [
    "FCAC · Joint accounts",
    "https://www.canada.ca/en/financial-consumer-agency/services/banking/bank-accounts/joint-bank-account.html",
  ],
  [
    "CMHC · Mortgage insurance and down payment",
    "https://www.cmhc-schl.gc.ca/consumers/home-buying/mortgage-loan-insurance-for-consumers/faqs-mortgage-loan-insurance?ap=a1-p4",
  ],
  [
    "Ontario · Dividing property",
    "https://www.ontario.ca/page/dividing-property-when-marriage-or-common-law-relationship-ends",
  ],
] as const;

export default function FinancialFramework({
  plan,
  assets,
  debts,
  members,
  budget,
  onChange,
}: {
  plan: WealthState["plan"];
  assets: Asset[];
  debts: Debt[];
  members: WealthState["members"];
  budget: BudgetItem[];
  onChange: (plan: WealthState["plan"]) => void;
}) {
  const { values, checks } = plan;
  const cash = assets
    .filter((asset) => /现金|储蓄|cash|hisa/i.test(asset.category))
    .reduce((sum, asset) => sum + asset.value, 0);
  const list = (rows: (Asset | Debt)[]) =>
    rows
      .map(
        (row) =>
          `${row.name} · ${ownerLabel(row.owner, members)} · ${money(row.value)}`,
      )
      .join("\n") || "尚未录入；请在家庭资产负债表添加。";
  const linked: Record<string, string> = {
    assets_list: list(assets),
    debts_list: list(debts),
    cash_accounts: list(
      assets.filter((asset) => /现金|储蓄|cash|hisa|gic/i.test(asset.category)),
    ),
    registered_accounts: list(
      assets.filter((asset) =>
        /退休|rrsp|tfsa|fhsa|resp/i.test(`${asset.category} ${asset.name}`),
      ),
    ),
    investments: list(
      assets.filter((asset) => /投资|investment/i.test(asset.category)),
    ),
    physical_assets: list(
      assets.filter((asset) => /房产|实物|property/i.test(asset.category)),
    ),
    debt_high: list(debts),
    emergency_current: String(cash),
  };
  if (budget.length) {
    linked.monthly_costs = budget
      .filter((row) => row.kind === "expense")
      .map(
        (row) =>
          `${row.name} · ${money(row.amount)}/月${row.essential ? " · 必要开支" : ""}`,
      )
      .join("\n");
    linked.income_a =
      money(
        budget
          .filter((row) => row.kind === "income" && row.owner === "first")
          .reduce((sum, row) => sum + row.amount, 0),
      ) + "/月（税后）";
    linked.income_b =
      money(
        budget
          .filter((row) => row.kind === "income" && row.owner === "second")
          .reduce((sum, row) => sum + row.amount, 0),
      ) + "/月（税后）";
  }
  if (budget.some((row) => row.kind === "expense"))
    linked.essential_monthly = String(
      budget
        .filter((row) => row.kind === "expense" && row.essential)
        .reduce((sum, row) => sum + row.amount, 0),
    );
  const updateValue = (key: string, value: string) => {
    onChange({ values: { ...values, [key]: value }, checks });
  };
  const toggleCheck = (id: string) =>
    onChange({ values, checks: { ...checks, [id]: !checks[id] } });
  const count = sections
    .flatMap((section) => section.checks ?? [])
    .filter((item) => checks[item.id]).length;
  const totalChecks = sections.reduce(
    (sum, section) => sum + (section.checks?.length ?? 0),
    0,
  );
  const monthly =
    Number(linked.essential_monthly ?? values.essential_monthly) || 0;
  const months = Number(values.emergency_months) || 0;
  const current = cash;

  return (
    <section id="framework" className="framework">
      <div className="framework-heading">
        <div>
          <p className="eyebrow">TOGETHER · FAMILY PLAYBOOK</p>
          <h2>家庭财务规划</h2>
          <p>账户清单自动联动；约定和执行进度随填写保存。</p>
        </div>
        <div className="progress-chip">
          <Check size={15} />
          {count} / {totalChecks} 项已完成
        </div>
      </div>
      <div className="framework-callout">
        <b>使用方式</b>
        <span>
          先打开“补齐信息”和“家庭资产负债表”，再和伴侣一起确定共同账户规则、应急金与目标。后面的投资、税务和法律条目用作讨论清单。
        </span>
      </div>
      <div className="framework-sections">
        {sections.map((section, index) => {
          const sectionChecks = section.checks ?? [];
          const done = sectionChecks.filter((item) => checks[item.id]).length;
          return (
            <details
              className="framework-card"
              id={section.id}
              key={section.id}
            >
              <summary>
                <span className="section-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="section-title">
                  <b>{section.title.replace(/^\d+ · /, "")}</b>
                  <small>{section.intro}</small>
                </span>
                {sectionChecks.length > 0 && (
                  <span className="section-progress">
                    {done}/{sectionChecks.length}
                  </span>
                )}
                <ChevronDown className="section-chevron" size={18} />
              </summary>
              <div className="framework-body">
                {section.points && (
                  <ul className="framework-points">
                    {section.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                )}
                {section.fields && (
                  <div className="framework-fields">
                    {section.fields.map((field) => (
                      <label key={field.key}>
                        {field.label}
                        {field.key in linked ? (
                          <>
                            <textarea
                              readOnly
                              value={linked[field.key]}
                              rows={3}
                            />
                            <a
                              href={
                                [
                                  "essential_monthly",
                                  "monthly_costs",
                                  "income_a",
                                  "income_b",
                                ].includes(field.key)
                                  ? "#cashflow"
                                  : "#assets"
                              }
                              className="linked-field"
                            >
                              自动汇总 · 前往明细编辑 ↗
                            </a>
                          </>
                        ) : ["essential_monthly", "emergency_months"].includes(
                            field.key,
                          ) ? (
                          <input
                            type="number"
                            min="0"
                            step={
                              field.key === "emergency_months" ? "1" : "0.01"
                            }
                            value={values[field.key] ?? ""}
                            onChange={(event) =>
                              updateValue(field.key, event.target.value)
                            }
                            placeholder="填写数字"
                          />
                        ) : (
                          <textarea
                            value={values[field.key] ?? ""}
                            onChange={(event) =>
                              updateValue(field.key, event.target.value)
                            }
                            placeholder={field.placeholder ?? "点击填写…"}
                            rows={
                              field.key.includes("goals") ||
                              field.key.includes("notes")
                                ? 3
                                : 2
                            }
                          />
                        )}
                      </label>
                    ))}
                  </div>
                )}
                {section.id === "emergency" && (
                  <div className="emergency-result">
                    <span>应急金目标估算</span>
                    <b>
                      {monthly && months
                        ? `$${(monthly * months).toLocaleString("en-CA", { maximumFractionDigits: 0 })} CAD`
                        : "填写月必要开支与目标月数"}
                    </b>
                    {monthly && months > 0 && (
                      <small>
                        按当前金额计算，距离目标还差 $
                        {Math.max(monthly * months - current, 0).toLocaleString(
                          "en-CA",
                          { maximumFractionDigits: 0 },
                        )}{" "}
                        CAD
                      </small>
                    )}
                  </div>
                )}
                {section.checks && (
                  <div className="framework-checks">
                    {section.checks.map((item) => (
                      <label
                        className={checks[item.id] ? "checked" : ""}
                        key={item.id}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(checks[item.id])}
                          onChange={() => toggleCheck(item.id)}
                        />
                        <span>{item.text}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
      <div className="framework-sources">
        <h3>官方参考来源</h3>
        <div>
          {sourceLinks.map(([label, url]) => (
            <a key={label} href={url} target="_blank" rel="noreferrer">
              {label} ↗
            </a>
          ))}
        </div>
        <p>
          框架内容为一般规划信息，不构成个人法律、税务或投资建议。涉及安省婚姻合同、房产归属、遗嘱、报税与账户资格时，请按情况向
          family / estate lawyer 或 CPA 确认。
        </p>
      </div>
    </section>
  );
}
