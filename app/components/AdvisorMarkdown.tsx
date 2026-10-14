import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
export default function AdvisorMarkdown({ text }: { text: string }) {
  return (
    <div className="advisor-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="advisor-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text.replace(
          /\*\*([^\n*]+?)\*\*/g,
          (_match, content: string) => `**${content.trim()}**`,
        )}
      </ReactMarkdown>
    </div>
  );
}
