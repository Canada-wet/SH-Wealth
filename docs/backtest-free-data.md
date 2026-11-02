# 免费历史行情评估与修复记录

核查日期：2026-11-01。范围：这个双成员私密家庭App的美股、TSX股票/ETF日线回测。不等于投资建议、数据许可意见或可用性承诺；没有替用户开户、购买或配置任何新服务。

## 本次故障的证据

1. 截图里的“缺少 XCV.TO 的历史数据”由浏览器 `runBacktest` 在当前数据包找不到该标的时抛出，不是Yahoo返回“无此证券”。原页面允许修改持仓后继续拿旧数据运行，也允许采用不完整批次；这种状态被误表述成供应商缺数据。
2. 2026-11-01从固定公开Yahoo chart端点请求2020-01-01至2026-10-30：VTV为1,717条、XCV.TO为1,715条日线，均有Adj Close，身份分别为USD/NYSE Arca ETF与CAD/TSX ETF。正式Vercel历史接口在已授权身份下也200并返回同样两只；未读取财富账本、未调用AI，只发送公开代码和日期。此抽样不能保证所有证券、日期或出口都可用。
3. 原一小时缓存也存失败结果；一次超时可能被重复展示一小时。改为只缓存成功结果，失败抛出缓存函数，由当前请求转为逐项错误；没有自动重发。相同进行中请求合并。401/403/429仍冷却并停止后续，不换主机、提取cookie或绕过限制。
4. 手机空权重可产生NaN；触摸候选时Safari可能先触发 `blur` 且 `relatedTarget=null`，使选项在click之前被卸载。新增有限数值处理、就地填写提示、一键等权、触摸保护及visualViewport定位。真机软键盘行为仍需与实际设备核对，模拟WebKit不等于真机。

## 可选数据源

| 来源 | 免费档核查结果 | 对本App的适用性与限制 |
| --- | --- | --- |
| Yahoo公开chart | 本轮VTV、XCV多年复权日线实测成功，无新增key | 当前继续使用。非官方接入，不保证持续可用、数据授权或完整覆盖；Adj Close按含分红总回报处理，不能再加现金分红。搜索结果不等于历史已载入。 |
| [Tiingo Starter](https://www.tiingo.com/about/pricing) | $0，30+年历史；50次/小时、1,000次/天、500代码/月、1GB/月 | 首选评估美股备用。[EOD文档](https://www.tiingo.com/documentation/end-of-day)说明提供原价、复权价、分红及拆股，且须token。不能仅凭全球目录数量认定XCV/TSX可用；个人internal-use不等于可向伴侣/其他用户展示，接入前确认许可。 |
| [Twelve Data Basic](https://twelvedata.com/pricing) | $0，8积分/分钟、800/天，美股/ETF；全球EOD在Grow档 | 可评估美股备份；加拿大覆盖、历史深度、分红/拆股、调整参数及internal-display许可需逐项确认。免费行情并不等于所有全球ETF或所有端点免费。 |
| [EODHD Free](https://eodhd.com/pricing) | 20次/天、20次/分钟、过去1年；分红/拆股列为包含 | 适合短期抽样验证，不能免费进行2008/2020等多年冲击回测。付费全球历史可以评估，但不自动开通。 |
| [Alpha Vantage](https://www.alphavantage.co/support/) | 通常25次/天 | [官方文档](https://www.alphavantage.co/documentation/)将Daily Adjusted和完整日线列为premium；免费compact原始日线仅最近100条。不能当成长期分红总回报的免费替代，也不能用周线冒充日线计算波动率。 |
| [Stooq](https://stooq.com/db/h/) | 有公开历史下载入口，但本轮自动访问未得到可核验数据 | 不预设其XCV覆盖、复权/分红口径或App展示许可，不自动fallback，更不绕过访问限制。用户取得有权使用的数据后可走CSV。 |
| 基金官网/官方宏观 | [Vanguard VTV](https://advisors.vanguard.com/investments/products/vtv/vanguard-value-etf)、[BlackRock XCV资料](https://www.blackrock.com/ca/individual/en/literature/etf-summary/xcv-facts-en-ca.pdf)可核对基金身份、收益/分配；央行/FRED用于宏观 | NAV、基金公布的期间回报与交易所收盘价不同，不混成同一种时间序列。宏观数据不能替代ETF价格。 |

## v0.17.0实际接入

- `lib/backtest-history-server.ts`提供auto / yahoo / tiingo，旧无provider请求保持兼容。auto每标的先Yahoo，失败才调用已配置Tiingo；完整序列择一，不拼接两种Adj Close。固定公开域名，最多两个并发，60秒新任务预算，各供方独立401/403/429冷却，不绕过限制。
- Tiingo仅支持`.US`，使用[官方Token header](https://www.tiingo.com/documentation/general/connecting)，key不进URL、浏览器、日志或导出。元数据核对精确ticker、美国交易所、名称和覆盖日期；EOD只接受有效每日`adjClose`，已含分红拆股，不再次累计分红。成功历史1小时、身份24小时缓存，失败不入成功缓存。每实例50上游请求/小时保护不等于账户分布式硬限额，最终以供方额度为准。
- 添加Vercel Production `TIINGO_API_KEY`并重新部署；UI“检查配置”只显示布尔，不展示key。实际获取成功才能确认凭证与覆盖；不替用户注册或接受协议。未配置时auto继续Yahoo，单选Tiingo明确告知未配置。
- Yahoo搜索失败时，有限常见ETF名单（含VTV、AVUV）支持精确代码Tiingo身份核对；不依赖官方标为beta且不推荐生产的搜索端点，不把模糊名称或任意输入当有效证券。
- [加拿大央行Valet](https://www.bankofcanada.ca/valet/docs)的FXUSDCAD无需key；实测2007–2025请求仅从2017-01-03返回有效观测。严格核对CAD per USD单位。点击将整批预览换算为CAD或USD，不重下股票、不改金额/权重。使用当日或过去4天内汇率，无未来引用；不含外汇点差/税费，日均参考价不等于收盘成交汇率。
- 仅真实total-return按共同价格日对齐，无价格前填；边界无覆盖可缩短并披露省略数，内部FX缺口超过4天、共同日线超过7天空档或稀疏样本拒绝。conversion保存原币种、逐日汇率/rateDate、来源/时间；结果、导出/导入、本机缓存及对照保留审计。已转换包不可再次换币，须重新获取原始预览。
- Stooq一次普通公开下载返回403，未接成可用fallback，未绕过限制。Twelve Data/EODHD/Alpha Vantage仍未接入。

## v0.16.2方案（历史记录，已被上节扩展）

- 先把Yahoo已有覆盖用对：构建时核对证券，数据页逐项列出“已载入/尚未载入”，缺项禁用运行；完整预览可显式“采用并运行”。失败保留旧研究，不静默删标的、改权重或用演示价格补齐。
- 成功缓存一小时，失败不存入该缓存；上游拒绝仍保持本实例15分钟冷却。缓存不是长期数据库，也没有伪装跨设备持久行情。
- VTV.US和XCV.TO分别是USD/CAD；当前只支持单币种回测，拆成独立组合。尚未实现逐日外汇曲线，不能用当前汇率回填多年历史。
- 保留合法CSV/研究包；若以后选定新服务，先取得key与家庭展示许可，再按相同身份、币种、频率、公司行动、缺失日及区间校验接入，不自动拼接不同来源的调整价格。
- 免费不代表完整、永久、免授权或无需维护。零新增凭证的当前方案继续Yahoo；下一步有条件的备用优先评估Tiingo美股覆盖，TSX长期历史还需独立核实。
