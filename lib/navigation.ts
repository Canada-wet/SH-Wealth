// One catalogue for the sidebar, command search, deep links and related workflows.
export const NAV_GROUPS = [
  "家庭空间",
  "家庭财富",
  "市场投资",
  "思考与成长",
  "兴趣生活",
  "空间设置",
] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];
export type Feature = {
  id: string;
  title: string;
  description: string;
  href: string;
  group: NavGroup;
  keywords: string;
  icon: string;
  primary?: boolean;
  parent?: string;
  related?: string[];
};
export const FEATURES: Feature[] = [
  {
    id: "space",
    title: "家庭首页",
    description: "关注今天要紧的事，继续财富、思考与生活",
    href: "/space",
    group: "家庭空间",
    keywords: "首页 home space 家庭 生活 工作台 今天 继续",
    icon: "home",
    primary: true,
    related: ["action-center", "markets", "growth", "learn", "lifestyle"],
  },
  {
    id: "action-center",
    title: "行动中心",
    description: "把研究、研讨和家庭计划连接到可跟进的下一步",
    href: "/space#actions",
    group: "家庭空间",
    keywords: "action task todo 待办 行动 跟进 计划 负责人 到期 决策",
    icon: "review",
    parent: "space",
    related: ["council", "investment-desk", "quarterly-review"],
  },
  {
    id: "overview",
    title: "财富总览",
    description: "资产、目标与家庭进展，一起看见",
    href: "/#overview",
    group: "家庭财富",
    keywords: "家庭全景 财富 overview 总览 净资产 dashboard",
    icon: "home",
    primary: true,
    related: ["growth", "quarterly-review", "lifestyle"],
  },
  {
    id: "assets",
    title: "资产与负债",
    description: "灵活编辑账户、估值与本年回报",
    href: "/#assets",
    group: "家庭财富",
    keywords: "asset debt 账户 房贷 编辑 回报 收益率",
    icon: "wallet",
    primary: true,
    related: ["market-wealth", "contributions", "history"],
  },
  {
    id: "cashflow",
    title: "每月现金流",
    description: "共同收支、结余与应急金",
    href: "/#cashflow",
    group: "家庭财富",
    keywords: "budget income expense 预算 工资 收入 支出 储蓄",
    icon: "cash",
    primary: true,
    related: ["growth", "framework", "quarterly-review"],
  },
  {
    id: "growth",
    title: "增长行动",
    description: "让现金流、目标和行动形成闭环",
    href: "/#growth",
    group: "家庭财富",
    keywords: "目标 goal wealth growth 财务自由 储蓄",
    icon: "target",
    primary: true,
    related: ["cashflow", "market-wealth", "quarterly-review"],
  },
  {
    id: "contributions",
    title: "成员贡献",
    description: "两个人与共同账户的投入和取出",
    href: "/#contributions",
    group: "家庭财富",
    keywords: "contribution 夫妻 出资 分摊 共同 比例",
    icon: "users",
    primary: true,
    related: ["assets", "cashflow", "framework"],
  },
  {
    id: "framework",
    title: "家庭计划",
    description: "一起约定规则，安排生活与财富",
    href: "/#framework",
    group: "家庭财富",
    keywords: "plan 规划 规则 婚后 保险 税务",
    icon: "plan",
    primary: true,
    related: ["quarterly-review", "growth", "lifestyle"],
  },
  {
    id: "quarterly-review",
    title: "季度复盘",
    description: "核对变化、讨论分歧、约定下一步",
    href: "/#quarterly-review",
    group: "家庭财富",
    keywords: "quarter review 季度 总结 复盘 提醒",
    icon: "review",
    primary: true,
    related: ["market-wealth", "cashflow", "learn"],
  },
  {
    id: "markets",
    title: "市场看板",
    description: "行情、宏观与家庭投资联动",
    href: "/markets",
    group: "市场投资",
    keywords: "market 股票 etf 汇率 投资 dashboard",
    icon: "globe",
    primary: true,
    related: ["market-wealth", "growth", "council"],
  },
  {
    id: "watchlist-pulse",
    title: "自选涨跌",
    description: "一眼浏览全部自选证券表现",
    href: "/markets#watchlist-pulse",
    group: "市场投资",
    keywords: "watchlist 股票 stock etf nvda meta 价格 涨幅 跌幅",
    icon: "chart",
    parent: "markets",
  },
  {
    id: "market-intelligence",
    title: "每日市场简报",
    description: "市场、情绪与 AI 供需观察",
    href: "/markets#market-intelligence",
    group: "市场投资",
    keywords: "briefing vix 情绪 前瞻 ai 芯片 供需 每日",
    icon: "sparkles",
    parent: "markets",
  },
  {
    id: "market-wealth",
    title: "市场 × 家庭联动",
    description: "持仓敞口、压力情景与家庭目标",
    href: "/markets#market-wealth",
    group: "市场投资",
    keywords: "sync portfolio 持仓 敞口 压力 风险 allocation 联动",
    icon: "link",
    parent: "markets",
  },
  {
    id: "investment-desk",
    title: "投资研究",
    description: "把观点落为可核验的投资假设",
    href: "/markets#investment-desk",
    group: "市场投资",
    keywords: "investment research 投资 专业 研究 假设",
    icon: "chart",
    parent: "markets",
  },
  {
    id: "macro-research",
    title: "宏观研究",
    description: "CPI、GDP、非农与经济环境",
    href: "/markets#macro-research",
    group: "市场投资",
    keywords: "macro cpi gdp payroll 非农 通胀 失业 经济",
    icon: "globe",
    parent: "markets",
  },
  {
    id: "rates-research",
    title: "美债收益率曲线",
    description: "长短端利率与期限结构",
    href: "/markets#rates-research",
    group: "市场投资",
    keywords: "treasury yield 美债 国债 利率 收益率 倒挂",
    icon: "chart",
    parent: "markets",
  },
  {
    id: "fx-research",
    title: "加币汇率",
    description: "CAD 对人民币、美元和日元",
    href: "/markets#fx-research",
    group: "市场投资",
    keywords: "fx cad cny rmb usd jpy 加元 加币 美元 人民币 日元 汇率",
    icon: "cash",
    parent: "markets",
  },
  {
    id: "securities",
    title: "自选管理",
    description: "维护关注的股票与 ETF",
    href: "/markets#securities",
    group: "市场投资",
    keywords: "watchlist 股票 etf 添加 删除 代码 自选",
    icon: "wallet",
    parent: "markets",
  },
  {
    id: "research-archive",
    title: "市场研究归档",
    description: "回看 Funda 开盘、收盘与历史趋势",
    href: "/markets#research-archive",
    group: "市场投资",
    keywords: "funda archive 开盘 收盘 研究 历史",
    icon: "history",
    parent: "markets",
  },
  {
    id: "council",
    title: "多模型研讨",
    description: "深度研讨、历史搜索、私人判断与定期复核",
    href: "/council",
    group: "思考与成长",
    keywords:
      "debate llm ai qwen glm claude gpt 深度研讨 讨论 辩论 证据 工具 追问 图片 附件 研讨历史 知识库 搜索 归档 决策 笔记 标签 复核",
    icon: "messages",
    primary: true,
    related: ["investment-desk", "learn", "framework"],
  },
  {
    id: "learn",
    title: "每日心理学",
    description: "把一个研究模型用于投资与生活",
    href: "/learn",
    group: "思考与成长",
    keywords: "psychology learning 心理 决策 工作 生活 收藏 认知",
    icon: "book",
    primary: true,
    related: ["council", "quarterly-review", "lifestyle"],
  },
  {
    id: "learning-favorites",
    title: "心理学收藏",
    description: "回看你收藏的研究和决策模型",
    href: "/learn#favorites",
    group: "思考与成长",
    keywords: "favorites bookmark 心理学 收藏 回看",
    icon: "book",
    parent: "learn",
  },
  {
    id: "lifestyle",
    title: "兴趣与生活",
    description: "曲库、编排与属于自己的练习",
    href: "/lifestyle",
    group: "兴趣生活",
    keywords: "hobby lifestyle dj 音乐 生活 爱好",
    icon: "headphones",
    primary: true,
    related: ["framework", "learn", "cashflow"],
  },
  {
    id: "library",
    title: "DJ 曲库",
    description: "拖入曲库、评分与 Cue 管理",
    href: "/lifestyle#library",
    group: "兴趣生活",
    keywords: "dj track library bpm key cue 曲目 曲库 导入",
    icon: "music",
    parent: "lifestyle",
  },
  {
    id: "sets",
    title: "DJ Set 编排",
    description: "智能排序、能量曲线与时长计划",
    href: "/lifestyle#sets",
    group: "兴趣生活",
    keywords: "dj set sequencing 编排 混音 过渡 能量 排序",
    icon: "headphones",
    parent: "lifestyle",
  },
  {
    id: "practice",
    title: "练习记录",
    description: "记录 DJ 练习，积累个人经验",
    href: "/lifestyle#practice",
    group: "兴趣生活",
    keywords: "dj practice journal 练习 记录 历史",
    icon: "review",
    parent: "lifestyle",
  },
  {
    id: "rekordbox",
    title: "rekordbox 连接",
    description: "XML 导入、导出与标记兼容",
    href: "/lifestyle#rekordbox",
    group: "兴趣生活",
    keywords: "rekordbox xml import export 导入 导出 cue 同步",
    icon: "link",
    parent: "lifestyle",
  },
  {
    id: "advisor",
    title: "财富顾问",
    description: "对话、语音和待确认的数据修改",
    href: "/#advisor",
    group: "思考与成长",
    keywords: "assistant chatbot bot ai 语音 助理 聊天 顾问",
    icon: "sparkles",
  },
  {
    id: "history",
    title: "财富历史",
    description: "回看估值与家庭数据的变化",
    href: "/#history",
    group: "家庭财富",
    keywords: "history 历史 快照 变更 时间线",
    icon: "history",
  },
  {
    id: "settings",
    title: "数据与同步",
    description: "云端连接、备份与恢复",
    href: "/#settings",
    group: "空间设置",
    keywords: "data sync cloud backup 数据 备份 导出 导入 恢复 supabase 设置",
    icon: "database",
  },
  {
    id: "members",
    title: "家庭成员",
    description: "自定义你们在共同空间里的名字",
    href: "/#members",
    group: "空间设置",
    keywords: "members name 用户 成员 名字 名称 夫妻",
    icon: "users",
  },
  {
    id: "alerts",
    title: "提醒与消息渠道",
    description: "主动建议、推送及 Telegram / 邮箱",
    href: "/#alerts",
    group: "空间设置",
    keywords: "notification telegram whatsapp email 提醒 推送 邮箱 消息 渠道",
    icon: "bell",
  },
  {
    id: "updates",
    title: "版本更新 · Admin",
    description: "两位管理员都能查看的发布记录",
    href: "/updates",
    group: "空间设置",
    keywords: "release version admin 版本 更新 管理员",
    icon: "history",
  },
];
export type NavEntry = {
  feature_id: string;
  pinned: boolean;
  last_used_at: string | null;
  pinned_at: string | null;
};
export type NavAction = "visit" | "pin" | "unpin";
export const featureById = (id: string) => FEATURES.find((f) => f.id === id);
export const SPACE_ROOT_IDS = [
  "space",
  "overview",
  "markets",
  "council",
  "learn",
  "lifestyle",
] as const;
const WEALTH_FEATURE_IDS = new Set([
  "assets",
  "cashflow",
  "growth",
  "contributions",
  "framework",
  "quarterly-review",
  "history",
  "settings",
  "members",
  "alerts",
  "advisor",
]);
export function navigationSpaceId(featureId: string): string {
  if (WEALTH_FEATURE_IDS.has(featureId)) return "overview";
  return featureById(featureId)?.parent ?? featureId;
}
const stamp = (value: string | null | undefined) =>
  value ? Date.parse(value) || 0 : 0;
export function validNavEntries(value: unknown): value is NavEntry[] {
  return (
    Array.isArray(value) &&
    value.length <= FEATURES.length &&
    new Set(value.map((r) => r?.feature_id)).size === value.length &&
    value.every(
      (r) =>
        r &&
        featureById(r.feature_id) &&
        typeof r.pinned === "boolean" &&
        [r.last_used_at, r.pinned_at].every(
          (d) =>
            d === null ||
            (typeof d === "string" && Number.isFinite(Date.parse(d))),
        ),
    )
  );
}
export function featureForLocation(
  path: string,
  hash: string,
): Feature | undefined {
  const exact = FEATURES.find((f) => f.href === path + hash);
  if (exact) return exact;
  return FEATURES.find((f) => f.href === (path === "/" ? "/#overview" : path));
}
export function recentTime(feature: Feature, entries: NavEntry[]): number {
  return Math.max(
    0,
    ...entries
      .filter(
        (r) =>
          r.feature_id === feature.id ||
          featureById(r.feature_id)?.parent === feature.id,
      )
      .map((r) => stamp(r.last_used_at)),
  );
}
export function orderedFeatures(
  items: Feature[],
  entries: NavEntry[],
): Feature[] {
  const entry = (id: string) => entries.find((r) => r.feature_id === id);
  return [...items].sort((a, b) => {
    const ap = entry(a.id)?.pinned,
      bp = entry(b.id)?.pinned;
    if (!!ap !== !!bp) return ap ? -1 : 1;
    if (ap && bp)
      return (
        stamp(entry(a.id)?.pinned_at) - stamp(entry(b.id)?.pinned_at) ||
        FEATURES.indexOf(a) - FEATURES.indexOf(b)
      );
    return (
      recentTime(b, entries) - recentTime(a, entries) ||
      stamp(entry(b.id)?.last_used_at) - stamp(entry(a.id)?.last_used_at) ||
      FEATURES.indexOf(a) - FEATURES.indexOf(b)
    );
  });
}
export function spaceFeatures(entries: NavEntry[] = []): Feature[] {
  const roots = SPACE_ROOT_IDS.map((id) => featureById(id)!);
  // Usage of an internal feature brings its space forward. A pinned internal
  // feature remains a shortcut, not an implicit pin of the whole space.
  const spaces = roots.map((feature): NavEntry => {
    const own = entries.find((entry) => entry.feature_id === feature.id);
    const latest = entries
      .filter((entry) => navigationSpaceId(entry.feature_id) === feature.id)
      .sort((a, b) => stamp(b.last_used_at) - stamp(a.last_used_at))[0];
    return {
      feature_id: feature.id,
      pinned: own?.pinned ?? false,
      pinned_at: own?.pinned_at ?? null,
      last_used_at: latest?.last_used_at ?? null,
    };
  });
  return [roots[0], ...orderedFeatures(roots.slice(1), spaces)];
}
export function continueFeatures(
  entries: NavEntry[] = [],
  limit = 3,
): Feature[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const usedAt = (feature: Feature) =>
    entries.find((entry) => entry.feature_id === feature.id)?.last_used_at;
  return FEATURES.filter((feature) => {
    const at = usedAt(feature);
    return (
      feature.id !== "space" &&
      typeof at === "string" &&
      Number.isFinite(Date.parse(at))
    );
  })
    .sort(
      (a, b) =>
        stamp(usedAt(b)) - stamp(usedAt(a)) ||
        FEATURES.indexOf(a) - FEATURES.indexOf(b),
    )
    .slice(0, Math.floor(limit));
}
const normalize = (s: string) => s.normalize("NFKC").trim().toLowerCase();
export function searchFeatures(
  query: string,
  entries: NavEntry[] = [],
  group?: NavGroup,
): Feature[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const matching = FEATURES.filter(
    (f) =>
      (!group || f.group === group) &&
      words.every((w) =>
        normalize(
          `${f.title} ${f.description} ${f.group} ${f.keywords}`,
        ).includes(w),
      ),
  );
  const score = (f: Feature) =>
    words.length
      ? (normalize(f.title) === normalize(query) ? 30 : 0) +
        words.reduce(
          (s, w) =>
            s +
            (normalize(f.title).includes(w)
              ? 8
              : normalize(f.keywords).includes(w)
                ? 3
                : 1),
          0,
        )
      : 0;
  return orderedFeatures(matching, entries).sort((a, b) => score(b) - score(a));
}
export function relatedFeatures(id: string): Feature[] {
  const current = featureById(id);
  const root = current?.parent ? featureById(current.parent) : current;
  return (current?.related ?? root?.related ?? [])
    .map(featureById)
    .filter((f): f is Feature => !!f && f.id !== id);
}
