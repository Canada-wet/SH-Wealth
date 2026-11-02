export default function FreeDataGuide() {
  return (
    <details className="bt-details bt-free-data">
      <summary>免费数据怎么选？覆盖、额度与分红口径</summary>
      <p>
        核查于2026-11-01。已接入Yahoo、Tiingo
        EOD适配器和加拿大央行历史汇率。Tiingo须在服务器配置个人免费API
        key后才会请求；不替用户开户、购买或承诺覆盖所有交易所。
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
              已接入：Tiingo Starter · 需要免费key
            </a>
          </dt>
          <dd>
            免费档列出30+年历史、50次/小时、1,000次/天及500个代码/月；当前接入仅接受核对身份后的美股股票与ETF，采用含分红拆股的复权日线。服务器变量TIINGO_API_KEY；自动模式在Yahoo失败后尝试，也可单选本来源。XCV等TSX仍使用Yahoo。请自行确认家庭使用许可与账户实际额度。
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
        Stooq公开请求本轮返回403，未接成可用备用源，也不会绕过限制。Twelve
        Data、EODHD及Alpha
        Vantage尚未接入。加拿大央行FXUSDCAD无需key，自2017年起提供1
        USD对应CAD的日均参考价；混币预览可明确点击换算，不会用今天的汇率补历史。基金官网NAV不等于交易所成交价。
      </p>
    </details>
  );
}
