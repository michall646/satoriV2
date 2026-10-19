// Markdown — statement/editorial rendering. LaTeX ($…$) renders as inline code text (no KaTeX yet).
'use client';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';

const parts = {
  h1: ({ children }) => <h1 className="type-h1 mt-3 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="type-h2 mt-3 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="font-semibold mt-2">{children}</h3>,
  p: ({ children }) => <p className="text-sm my-1.5 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc ml-5 my-1.5 text-sm">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal ml-5 my-1.5 text-sm">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  code: ({ children }) => <code className="type-mono bg-bg px-1 rounded">{children}</code>,
  pre: ({ children }) => <pre className="border rounded p-2 overflow-auto type-mono my-2 whitespace-pre-wrap">{children}</pre>,
  table: ({ children }) => <span className="table-scroll block my-2"><table className="min-w-full text-sm border-collapse">{children}</table></span>,
  th: ({ children }) => <th className="border px-2 py-1 text-left bg-bg">{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
  a: ({ href, children }) => {
    if (!href) return <span className="underline">{children}</span>;
    if (href.startsWith('/') && !href.startsWith('//')) return <Link href={href} prefetch className="underline focus-ring rounded">{children}</Link>;
    return <a href={href} className="underline focus-ring rounded">{children}</a>;
  },
  blockquote: ({ children }) => <blockquote className="border-l-2 pl-2 my-1.5 text-sm text-muted">{children}</blockquote>,
};

export default function Markdown({ text, fallback = 'No statement.' }) {
  if (!text) return <p className="text-sm text-muted">{fallback}</p>;
  return <ReactMarkdown components={parts}>{text}</ReactMarkdown>;
}
