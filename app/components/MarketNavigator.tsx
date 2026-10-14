import {
  Landmark,
  LineChart,
  Users,
  WalletCards,
  Globe2,
  ArrowUpRight,
} from "lucide-react";
export default function MarketNavigator() {
  return (
    <>
      <aside className="sidebar market-sidebar">
        <a className="brand" href="/#overview">
          <span>t</span>ogether
        </a>
        <nav aria-label="主导航">
          <a href="/#overview">
            <LineChart />
            全景
          </a>
          <a href="/#assets">
            <WalletCards />
            资产与负债
          </a>
          <a href="/#cashflow">
            <WalletCards />
            每月现金流
          </a>
          <a href="/#contributions">
            <Users />
            成员贡献
          </a>
          <a href="/#framework">
            <Landmark />
            家庭计划
          </a>
          <a href="/markets" aria-current="page">
            <Globe2 />
            市场看板
          </a>
        </nav>
        <div className="sidebar-bottom market-sidebar-note">
          <span>MARKET RESEARCH</span>
          <p>公共市场数据与家庭账本分开。看行情，不自动改估值。</p>
          <a href="/#overview">
            返回家庭工作台 <ArrowUpRight size={14} />
          </a>
        </div>
      </aside>
      <nav className="market-mobile-nav" aria-label="手机主导航">
        <a href="/#overview">家庭财富</a>
        <a href="/markets" aria-current="page">
          市场看板
        </a>
      </nav>
    </>
  );
}
