import { torontoDay } from "./market-briefing";
export type Lesson = {
  id: string;
  title: string;
  model: string;
  research: string;
  finding: string;
  investment: string;
  work: string;
  life: string;
  exercise: string;
  limit: string;
  source: string;
};
// Versioned editorial library. Never reorder existing entries: archived day-to-card mappings stay stable.
export const LESSONS: readonly Lesson[] = [
  {
    id: "if-then-v1",
    title: "把愿望变成「如果…就…」",
    model: "实施意图",
    research: "Gollwitzer & Sheeran · 2006 · 元分析",
    finding:
      "把行动连接到具体情境，可能有助于把目标转成行为；仅有强烈愿望不等于执行。",
    investment:
      "把复盘写成时间与动作，而不是看到涨跌就临时决定；交易条件仍需独立研究。",
    work: "如果晨会结束，就先做最重要任务的第一步。",
    life: "如果晚饭收拾完，就一起核对一笔本周支出。",
    exercise: "写一个可控的触发条件和一个 5 分钟动作，明天回看有没有执行。",
    limit: "不同情境效果不一；行为目标的证据不是投资超额收益证明。",
    source: "https://doi.org/10.1016/S0065-2601(06)38002-1",
  },
  {
    id: "opposite-v1",
    title: "先替相反观点找证据",
    model: "考虑反面",
    research: "Lord, Lepper & Preston · 1984 · 两项实验",
    finding:
      "在社会判断任务中，明确考虑相反可能性，比笼统要求自己公平更能纠正部分偏差。",
    investment: "为持仓研究补一条可观察的失效条件，而不只收藏支持它的新闻。",
    work: "评估方案时，请同事讲出它最可能失败的原因。",
    life: "发生分歧时，先复述一个对方可能合理的解释。",
    exercise: "写下「什么新证据会让我改变看法」，同时记录核对日期。",
    limit:
      "原研究是社会判断实验；这里的投资与生活用法是应用推演，不保证消除偏见。",
    source: "https://pubmed.ncbi.nlm.nih.gov/6527215/",
  },
  {
    id: "loss-aversion-v1",
    title: "不让买入价替你做决定",
    model: "参照点与损失厌恶",
    research: "Kahneman · 2002 诺贝尔讲座；前景理论",
    finding: "人们常相对参照点评价得失，对损失与同额收益的反应可能不对称。",
    investment:
      "区分买入成本、当前投资逻辑和未来风险；不因为回本愿望自动加仓。",
    work: "评估换岗时，把未来机会与约束写出，不只盯着已付出的成本。",
    life: "讨论预算调整时，说明双方关心的参照点。",
    exercise:
      "把一个决定重写成「从今天开始，可选方案各有什么未来成本与收益」。",
    limit: "这是描述决策的模型，不是人人固定的损失倍数，也不是买卖规则。",
    source: "https://www.nobelprize.org/uploads/2018/06/kahnemann-lecture.pdf",
  },
  {
    id: "progress-v1",
    title: "记录可控过程，不盯每日结果",
    model: "进度监测",
    research: "Harkin 等 · 2016 · 实验研究元分析",
    finding:
      "汇总研究发现，提高目标进度监测通常有助于目标实现，但效果随任务和监测方式而异。",
    investment:
      "记录是否按计划核对估值、配置和资金安排，不把短期涨跌当执行质量。",
    work: "每周记下交付的具体成果，而非只记忙碌时长。",
    life: "共同复盘时比较已完成动作与原计划，不用相互评价代替记录。",
    exercise: "选一个可控动作，用本周「计划 / 实际 / 下一步」三列做一次核对。",
    limit: "监测不等于越频繁越好；研究不是频繁看盘能提高收益的证据。",
    source: "https://pubmed.ncbi.nlm.nih.gov/26479070/",
  },
  {
    id: "sunk-cost-v1",
    title: "已付出的，不必决定下一笔投入",
    model: "沉没成本",
    research: "Arkes & Blumer · 1985 · 场域与问卷研究",
    finding:
      "已投入金钱、时间或努力后，人们可能更倾向继续某项行动，即使未来条件已经变化。",
    investment: "新增资金应重新比较未来风险收益，而非只为证明过去买入正确。",
    work: "项目复盘把不可收回的过去成本与下一阶段资源决策分开。",
    life: "已买票不等于身体不适时也必须赴约；仍要考虑可取消费用和现实约束。",
    exercise: "问自己「如果今天尚未开始，我还会投入下一小时或下一笔钱吗？」",
    limit:
      "过去信息可能仍有预测价值；税费、合同和退出成本不是应忽略的沉没成本。",
    source: "https://doi.org/10.1016/0749-5978(85)90049-4",
  },
  {
    id: "planning-v1",
    title: "用过去实际耗时校准计划",
    model: "规划谬误与外部视角",
    research: "Buehler, Griffin & Ross · 1994 · 任务时间预测实验",
    finding:
      "参与者预测完成时间时容易偏向理想过程；明确连接相关过去经历，有时能减轻过度乐观。",
    investment:
      "目标路径同时比较无收益基线、现金需求和不利情景，不只选最顺利的假设。",
    work: "报工期前先看三次相似任务的实际交付时间。",
    life: "旅行或搬家安排留出等待、返工与协调时间。",
    exercise: "找一个真正类似的历史记录，把理想时间与实际时间并列。",
    limit: "相似任务也可能有结构差异；历史类比不保证未来准时或投资达标。",
    source: "https://doi.org/10.1037/0022-3514.67.3.366",
  },
  {
    id: "label-emotion-v1",
    title: "先给情绪一个名字，再行动",
    model: "情绪标记",
    research: "Lieberman 等 · 2007 · 实验室 fMRI 研究",
    finding: "给负面图片相关感受贴上情绪标签，与部分情绪反应脑区活动变化相关。",
    investment: "冲动下单前区分「害怕错过」与新的基本面证据。",
    work: "遇到反馈先描述「我现在紧张 / 失望」，再确认具体问题。",
    life: "谈钱前说出自己的感受和需要，不把感受直接变成对伴侣的判断。",
    exercise: "用一句「我注意到自己感到…，我需要先核对…」推迟一次非紧急决定。",
    limit: "脑活动结果不等于治疗效果或人人都有效；不是心理诊断或危机处理方法。",
    source: "https://pubmed.ncbi.nlm.nih.gov/17576282/",
  },
  {
    id: "distance-v1",
    title: "像给朋友建议那样看问题",
    model: "自我距离",
    research: "Ayduk & Kross · 2010 · 自我反思研究",
    finding:
      "研究探索从较有距离的视角反思负面经历，与更适应性的情绪和人际反应之间的关系。",
    investment: "把投资理由交给「另一位审阅者」检查，区分事实、假设和情绪。",
    work: "问「如果同事面临这个问题，我会建议先确认什么？」",
    life: "冲突后尝试描述双方处境，而不反复重播输赢。",
    exercise: "第三人称写三句：发生了什么、还有什么解释、下一步可以核对什么。",
    limit: "不是逃避情绪或压抑感受；不把研究直接外推成投资表现提升。",
    source: "https://pubmed.ncbi.nlm.nih.gov/20438226/",
  },
];
export const LEARNING_START = "2026-10-15";
// Freeze this edition's length when extending the catalog; publish a new schedule edition instead.
const EDITION_LENGTH = 8;
export function lessonForDay(day = torontoDay()): Lesson | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(day)) ||
    new Date(day).toISOString().slice(0, 10) !== day ||
    day < LEARNING_START
  )
    return null;
  const offset = Math.floor(
    (Date.parse(day) - Date.parse(LEARNING_START)) / 86400000,
  );
  return LESSONS[offset % EDITION_LENGTH];
}
export function lessonArchive(now = new Date(), count = 60) {
  const day = torontoDay(now),
    result: { day: string; lesson: Lesson }[] = [];
  for (let i = 0; i < Math.min(365, Math.max(0, count)); i++) {
    const date = new Date(Date.parse(day) - i * 86400000)
      .toISOString()
      .slice(0, 10);
    const lesson = lessonForDay(date);
    if (!lesson) break;
    result.push({ day: date, lesson });
  }
  return result;
}
export type LearningPreferences = {
  version: number;
  daily: boolean;
  favorites: string[];
};
export const EMPTY_LEARNING: LearningPreferences = {
  version: 0,
  daily: false,
  favorites: [],
};
export function validLearningPreferences(p: unknown): p is LearningPreferences {
  const r = p as LearningPreferences;
  return (
    !!r &&
    Number.isSafeInteger(r.version) &&
    r.version >= 0 &&
    r.version < 1e9 &&
    typeof r.daily === "boolean" &&
    Array.isArray(r.favorites) &&
    r.favorites.length <= LESSONS.length &&
    new Set(r.favorites).size === r.favorites.length &&
    r.favorites.every((id) => LESSONS.some((l) => l.id === id))
  );
}
