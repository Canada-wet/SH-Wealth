import { instrumentKey, type MarketInstrument } from "./market";

// Editorial research buckets, not GICS sectors or measured portfolio exposure.
export const RESEARCH_THEMES = {
  semis: {
    label: "半导体",
    question:
      "订单与库存周期是否同步？资本开支、出口限制和客户集中度如何影响盈利？",
  },
  digital: {
    label: "软件与数字平台",
    question:
      "收入增长能否转化为自由现金流？估值是否已经计入增长、股权激励与资本开支？",
  },
  infrastructure: {
    label: "工业与基础设施",
    question:
      "在手订单能否兑现为收入和现金流？交付、融资与客户资本开支有哪些约束？",
  },
  defensive: {
    label: "公用事业与医疗",
    question:
      "监管、政策和负债成本如何影响现金流？行业标签不等于低波动或保本。",
  },
  regional: {
    label: "区域与金融",
    question:
      "国家、政策、信用与利率周期如何影响标的？挂牌币种不等于经济风险所在地区。",
  },
  funds: {
    label: "宽基与主题基金",
    question:
      "先核对最新持仓、指数方法、费用与对冲规则，再检查是否与单股重复；基金数量不等于分散程度。",
  },
  alternatives: {
    label: "黄金与比特币",
    question:
      "底层价格、保管安排与流动性有哪些风险？与股票的相关性并不固定，不能假定始终提供保护。",
  },
  other: {
    label: "待分类",
    question:
      "先核实发行人、业务、证券类型、上市地点和产品文件，再形成研究判断。",
  },
} as const;
export type ResearchTheme = keyof typeof RESEARCH_THEMES;
const GROUPS: [ResearchTheme, string[]][] = [
  [
    "semis",
    [
      "NASDAQ:NVDA",
      "NASDAQ:AVGO",
      "NASDAQ:KLAC",
      "NASDAQ:MU",
      "NYSE:ONTO",
      "NYSE:TSM",
    ],
  ],
  [
    "digital",
    [
      "NASDAQ:META",
      "NASDAQ:IQ",
      "NASDAQ:MSFT",
      "NASDAQ:NBIS",
      "NYSE:SNOW",
      "NASDAQ:TEAM",
    ],
  ],
  [
    "infrastructure",
    ["NYSE:APH", "NYSE:CLS", "TSX:CLS", "NASDAQ:SPCX", "NYSE:VRT"],
  ],
  ["defensive", ["NYSE:PCG", "NYSE:UNH"]],
  ["regional", ["NASDAQ:KBWB", "NASDAQ:UAE", "AMEX:YINN"]],
  [
    "funds",
    [
      "TSX:DATA.B",
      "TSX:RBOT",
      "TSX:XIC",
      "TSX:XST",
      "TSX:ZGIN",
      "TSX:ZQQ",
      "TSX:ZSP",
    ],
  ],
  ["alternatives", ["TSX:BTCC", "TSX:CGL.C"]],
];
export function researchTheme(row: MarketInstrument): ResearchTheme {
  return (
    GROUPS.find(([, keys]) => keys.includes(instrumentKey(row)))?.[0] ?? "other"
  );
}
export function productCaution(row: MarketInstrument) {
  if (instrumentKey(row) === "AMEX:YINN")
    return {
      title: "每日 3× · 需单独研究复利路径",
      text: "YINN 的目标是 FTSE China 50 指数单日回报的 300%（费前），不是长期累计回报的三倍。波动、每日重置与费用可能显著改变多日结果。",
      url: "https://www.direxion.com/product/daily-ftse-china-bull-bear-3x-etfs",
    };
  if (instrumentKey(row) === "TSX:ZQQ")
    return {
      title: "加币对冲 · 不重复叠加美元涨跌",
      text: "ZQQ 是 Nasdaq 100 加币对冲指数 ETF。对冲不代表消除所有风险；若用 CAD 报价收益试算，不应再叠加 USD/CAD 变动。",
      url: "https://www.bmoetfs.ca/etfs/zqq-bmo-nasdaq-100-equity-hedged-to-cad-index-etf",
    };
  return null;
}
export type ResearchNote = {
  thesis: string;
  risk: string;
  invalidation: string;
  reviewDate: string;
  updatedAt: string;
};
export type ResearchNotes = Record<string, ResearchNote>;
export const EMPTY_RESEARCH_NOTE: ResearchNote = {
  thesis: "",
  risk: "",
  invalidation: "",
  reviewDate: "",
  updatedAt: "",
};
export function validReviewDate(value: string) {
  return (
    value === "" ||
    (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value)
  );
}
export function validResearchNotes(raw: unknown): raw is ResearchNotes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const entries = Object.entries(raw);
  return (
    entries.length <= 120 &&
    entries.every(([key, value]) => {
      const note = value as ResearchNote;
      return (
        /^(NASDAQ|NYSE|AMEX|TSX):[A-Z0-9][A-Z0-9._-]{0,14}$/.test(key) &&
        !!note &&
        [note.thesis, note.risk, note.invalidation].every(
          (v) => typeof v === "string" && v.length <= 2000,
        ) &&
        typeof note.reviewDate === "string" &&
        validReviewDate(note.reviewDate) &&
        typeof note.updatedAt === "string" &&
        !Number.isNaN(Date.parse(note.updatedAt))
      );
    })
  );
}
export function saveResearchNote(
  notes: ResearchNotes,
  row: MarketInstrument,
  baseline: ResearchNote | undefined,
  draft: ResearchNote,
): ResearchNotes {
  const key = instrumentKey(row);
  const current = notes[key];
  const same =
    current === baseline ||
    (!!current &&
      !!baseline &&
      (
        ["thesis", "risk", "invalidation", "reviewDate", "updatedAt"] as const
      ).every((field) => current[field] === baseline[field]));
  if (!same)
    throw new Error(
      "此标的的研究记录已被更新。请保留草稿，或放弃草稿后读取最新记录。",
    );
  const next = {
    ...notes,
    [key]: { ...draft, updatedAt: new Date().toISOString() },
  };
  if (!validResearchNotes(next))
    throw new Error(
      "研究记录格式无效：每项最多 2000 字，日期须有效，最多保留 120 只标的记录。",
    );
  return next;
}
export function cadScenario(
  amount: number,
  assetReturn: number,
  fxReturn: number,
) {
  if (
    ![amount, assetReturn, fxReturn].every(Number.isFinite) ||
    amount <= 0 ||
    amount > 1e12 ||
    assetReturn < -100 ||
    assetReturn > 1000 ||
    fxReturn <= -100 ||
    fxReturn > 1000
  )
    return null;
  const rate = (1 + assetReturn / 100) * (1 + fxReturn / 100) - 1;
  const end = amount * (1 + rate);
  return {
    rate,
    end,
    pnl: end - amount,
    recovery: rate < 0 && rate > -1 ? 1 / (1 + rate) - 1 : null,
  };
}
