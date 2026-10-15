"use client";
import { useEffect, useRef, useState } from "react";
const sections = [
  ["market-intelligence", "每日简报"],
  ["watchlist-pulse", "自选涨跌"],
  ["investment-desk", "投资研究"],
  ["market-overview", "市场概览"],
  ["macro-research", "宏观研究"],
  ["rates-research", "收益率曲线"],
  ["fx-research", "汇率"],
  ["securities", "自选管理"],
];
export default function MarketSectionNav() {
  const [active, setActive] = useState(sections[0][0]);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let current = sections[0][0];
        for (const [id] of sections) {
          const section = document.getElementById(id);
          if (section && section.getBoundingClientRect().top <= 140)
            current = id;
        }
        setActive(current);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  useEffect(() => {
    const container = nav.current,
      link = container?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!container || !link) return;
    const offset = link.offsetLeft - container.offsetLeft;
    if (offset < container.scrollLeft) container.scrollLeft = offset;
    else if (
      offset + link.offsetWidth >
      container.scrollLeft + container.clientWidth
    )
      container.scrollLeft = offset + link.offsetWidth - container.clientWidth;
  }, [active]);
  return (
    <nav className="research-section-nav" aria-label="市场区块导航" ref={nav}>
      {sections.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={active === id ? "location" : undefined}
          onClick={() => setActive(id)}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
