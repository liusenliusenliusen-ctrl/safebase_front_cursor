import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownTextProps {
  content: string;
}

export function MarkdownText({ content }: MarkdownTextProps) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="md-p">{children}</p>,
          ul: ({ children }) => <ul className="md-list">{children}</ul>,
          ol: ({ children }) => <ol className="md-list md-ol">{children}</ol>,
          li: ({ children }) => <li className="md-li">{children}</li>,
          strong: ({ children }) => <strong className="md-strong">{children}</strong>,
          h1: ({ children }) => <h3 className="md-h">{children}</h3>,
          h2: ({ children }) => <h3 className="md-h">{children}</h3>,
          h3: ({ children }) => <h3 className="md-h md-h3">{children}</h3>,
          hr: () => <hr className="md-hr" />,
          code: ({ children, className }) => {
            const isBlock = Boolean(className);
            return (
              <code className={isBlock ? `md-code-block ${className ?? ""}` : "md-code"}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="md-pre">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="md-quote">{children}</blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
