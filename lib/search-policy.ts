export type SearchMode = "auto" | "on" | "off";
export const SEARCH_TOPICS = {
  rates: {
    label: "加拿大政策利率",
    query:
      "Bank of Canada current policy interest rate latest official decision effective date",
  },
  mortgage: {
    label: "加拿大房贷利率",
    query:
      "Canada current residential mortgage interest rates official bank posted rates date fixed variable",
  },
  gic: {
    label: "GIC 与储蓄利率",
    query:
      "Canada current GIC savings interest rates official bank terms maturity redemption date",
  },
  tfsa: {
    label: "TFSA 规则与额度",
    query:
      "Canada CRA current year TFSA annual contribution limit eligibility official rules",
  },
  rrsp: {
    label: "RRSP 规则与额度",
    query:
      "Canada CRA current year RRSP deduction contribution limit deadline official rules",
  },
  fhsa: {
    label: "FHSA 规则与额度",
    query:
      "Canada CRA current year FHSA contribution limits eligibility official rules",
  },
  fx: {
    label: "CAD 汇率",
    query:
      "Bank of Canada latest daily exchange rates CAD USD CNY official date",
  },
  inflation: {
    label: "加拿大通胀与经济",
    query:
      "Statistics Canada latest consumer price index inflation official release date",
  },
  tax: {
    label: "加拿大个人税务规则",
    query:
      "Canada CRA current year personal income tax official changes rates rules",
  },
} as const;
export type SearchTopic = keyof typeof SEARCH_TOPICS;
export type SearchPlan = {
  topic: SearchTopic | null;
  query: string;
  needed: boolean;
  enabled: boolean;
};
export function searchPlan(
  question: string,
  mode: SearchMode = "auto",
  selected: SearchTopic | "auto" = "auto",
): SearchPlan {
  const tests: [SearchTopic, RegExp][] = [
    ["fhsa", /fhsa|首次购房储蓄/i],
    ["tfsa", /tfsa|免税储蓄/i],
    ["rrsp", /rrsp|注册退休储蓄/i],
    ["mortgage", /房贷|mortgage/i],
    ["gic", /\bgic\b|定存|储蓄利率|saving.*rate/i],
    ["fx", /汇率|exchange.rate|cad.*usd|usd.*cad|加币.*人民币/i],
    ["inflation", /通胀|通货膨胀|inflation|\bcpi\b/i],
    ["tax", /税率|税务|报税|income.tax/i],
    ["rates", /央行|政策利率|基准利率|降息|加息|bank.of.canada|policy.rate/i],
  ];
  const topic =
    mode === "on" &&
    selected !== "auto" &&
    Object.prototype.hasOwnProperty.call(SEARCH_TOPICS, selected)
      ? selected
      : (tests.find(([, regex]) => regex.test(question))?.[0] ?? null);
  const timeSensitive =
    /最新|实时|今天|现在|目前|当前|今年|查|搜索|联网|利率|汇率|额度|截止|资格|规则|条件|\b(20\d{2}|latest|current|today|search|rate|limit|deadline|eligibility|rules)\b/i.test(
      question,
    );
  const explicit = /联网|上网|搜索|实时查|web.search|search.the.web/i.test(
    question,
  );
  const ledgerOnly =
    !topic &&
    /净资产|总资产|账户|账本|余额|月结余|成员贡献|家庭|财务状况|财政状况|收支|预算|本年回报|net.worth|balance/i.test(
      question,
    );
  const editOnly =
    /^(?:请)?(?:把|将|修改|添加|新增|删除|移除|记录|更新|update|delete|add|set)/i.test(
      question.trim(),
    ) && !explicit;
  const freshUnknown =
    !ledgerOnly &&
    /最新|实时|今天|今年|现在|目前|当前|latest|today|current/i.test(question);
  const needed =
    mode === "on" ||
    explicit ||
    (!editOnly && (Boolean(topic && timeSensitive) || freshUnknown));
  return {
    topic,
    query: topic ? SEARCH_TOPICS[topic].query : "",
    needed,
    enabled: needed && mode !== "off" && Boolean(topic),
  };
}
