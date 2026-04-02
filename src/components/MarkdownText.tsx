import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownTextProps {
  content: string;
}

export function MarkdownText({ content }: MarkdownTextProps) {
  return (
    <div style={{ lineHeight: 1.7 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 8px" }}>{children}</p>,
          ul: ({ children }) => <ul style={{ margin: "0 0 8px 18px", padding: 0 }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: "0 0 8px 18px", padding: 0 }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
          code: ({ children, className }) => {
            const isBlock = Boolean(className);
            return (
              <code
                className={className}
                style={
                  isBlock
                    ? {
                        display: "block",
                        background: "#f6f8fa",
                        borderRadius: 8,
                        padding: "10px 12px",
                        overflowX: "auto",
                        fontSize: 13,
                      }
                    : {
                        background: "rgba(0,0,0,0.06)",
                        borderRadius: 4,
                        padding: "0 4px",
                        fontSize: "0.9em",
                      }
                }
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre style={{ margin: "0 0 8px" }}>{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: "0 0 8px",
                padding: "0 0 0 12px",
                borderLeft: "3px solid #d9d9d9",
                color: "#555",
              }}
            >
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

