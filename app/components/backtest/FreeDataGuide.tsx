export default function FreeDataGuide() {
  return (
    <details className="bt-details bt-free-data">
      <summary>免费数据怎么选？覆盖、额度与分红口径</summary>
      <p>
        核查于2026-11-01。没有一个已验证的免费官方API同时保证美股、加拿大ETF、多年复权历史及家庭共享许可。以下备选尚未接入，也未替你开户或升级。
      </p>
      <dl>
        <div>
          <dt>当前：Yahoo公开日线 · 无需key</dt>
          <dd>
            本次实测VTV.US、XCV.TO均有多年含分红复权日线。先获取→核对逐项结果→采用并运行；搜索选中不等于已经下载历史。非官方接入，可能限流、缺失，不保证持续可用或商用许可。
          </dd>
        </div>
        <div>
          <dt>
            <a
              href="https://www.tiingo.com/about/pricing"
              target="_blank"
              rel="noreferrer"
            >
              Tiingo Starter
            </a>
          </dt>
          <dd>
            免费档列出30+年历史、50次/小时、1,000次/天及500个代码/月；EOD提供复权价与公司行动。适合优先评估美股ETF；XCV等TSX覆盖与两人共享展示许可需另行确认，不能仅凭“免费”自动接入。
          </dd>
        </div>
        <div>
          <dt>
            <a
              href="https://twelvedata.com/pricing"
              target="_blank"
              rel="noreferrer"
            >
              Twelve Data Basic
            </a>
          </dt>
          <dd>
            免费档8积分/分钟、800/天，覆盖美股与ETF。全球EOD在付费档；不能据此承诺加拿大ETF免费覆盖。分红端点、调整口径和展示权限需按具体套餐核查。
          </dd>
        </div>
        <div>
          <dt>
            <a
              href="https://eodhd.com/pricing"
              target="_blank"
              rel="noreferrer"
            >
              EODHD Free
            </a>
          </dt>
          <dd>
            免费档20次/天，历史仅过去1年。可评估短期跨市场研究，但不能免费覆盖2008股灾、2020疫情等长期回测。
          </dd>
        </div>
        <div>
          <dt>
            <a
              href="https://www.alphavantage.co/documentation/"
              target="_blank"
              rel="noreferrer"
            >
              Alpha Vantage
            </a>
          </dt>
          <dd>
            免费额度25次/天，但完整日线与Daily
            Adjusted为付费权限；不适合作为本页多年分红总回报的免费替代。
          </dd>
        </div>
      </dl>
      <p>
        Stooq可作手动交叉核查，但本轮未验证XCV覆盖与可用分红总回报口径，不会自动把未知调整价混入当前总回报。基金官网NAV也不等于交易所成交价。已有合法CSV仍可导入；宏观数据可继续使用加拿大央行、FRED等官方来源，但它们不能替代ETF价格。
      </p>
    </details>
  );
}
