"use client"

import React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownContentProps {
  content: string
  className?: string
}

/**
 * MarkdownContent - Renders markdown text with styling appropriate for the AI chatbot.
 *
 * Supports GitHub-flavored markdown including:
 * - Headers, bold, italic, strikethrough
 * - Bullet and numbered lists
 * - Code blocks and inline code
 * - Tables
 * - Blockquotes
 * - Links
 */
export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  return (
    <div className={`markdown-content ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headers - scaled down for chat context
          h1: (props) => (
            <h1 className="text-[14pt] font-bold mt-3 mb-1.5 first:mt-0">{props.children}</h1>
          ),
          h2: (props) => (
            <h2 className="text-[13pt] font-bold mt-2.5 mb-1 first:mt-0">{props.children}</h2>
          ),
          h3: (props) => (
            <h3 className="text-[12pt] font-bold mt-2 mb-1 first:mt-0">{props.children}</h3>
          ),
          h4: (props) => (
            <h4 className="text-[12pt] font-semibold mt-1.5 mb-0.5 first:mt-0">{props.children}</h4>
          ),

          // Paragraphs
          p: (props) => (
            <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">{props.children}</p>
          ),

          // Lists
          ul: (props) => (
            <ul className="my-1.5 ml-4 list-disc space-y-0.5">{props.children}</ul>
          ),
          ol: (props) => (
            <ol className="my-1.5 ml-4 list-decimal space-y-0.5">{props.children}</ol>
          ),
          li: (props) => (
            <li className="leading-relaxed">{props.children}</li>
          ),

          // Code - inline and blocks
          code: (props) => {
            const { className: codeClassName, children } = props
            // Check if it's a code block (has language class) vs inline code
            const isCodeBlock = codeClassName?.includes('language-')

            if (isCodeBlock) {
              return (
                <code className={`block bg-gray-800 text-gray-100 rounded px-2 py-1.5 my-1.5 text-[11pt] overflow-x-auto ${codeClassName || ''}`}>
                  {children}
                </code>
              )
            }

            // Inline code
            return (
              <code className="bg-purple-100 text-purple-800 px-1 py-0.5 rounded text-[11pt]">
                {children}
              </code>
            )
          },

          // Pre wrapper for code blocks
          pre: (props) => (
            <pre className="my-1.5 overflow-x-auto">{props.children}</pre>
          ),

          // Blockquotes
          blockquote: (props) => (
            <blockquote className="border-l-2 border-purple-400 pl-2 my-1.5 italic text-gray-600">
              {props.children}
            </blockquote>
          ),

          // Strong/Bold
          strong: (props) => (
            <strong className="font-bold">{props.children}</strong>
          ),

          // Emphasis/Italic
          em: (props) => (
            <em className="italic">{props.children}</em>
          ),

          // Links
          a: (props) => (
            <a
              href={props.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-600 hover:text-purple-800 underline"
            >
              {props.children}
            </a>
          ),

          // Horizontal rules
          hr: () => (
            <hr className="my-2 border-gray-300" />
          ),

          // Tables
          table: (props) => (
            <div className="my-1.5 overflow-x-auto">
              <table className="min-w-full border-collapse text-[11pt]">
                {props.children}
              </table>
            </div>
          ),
          thead: (props) => (
            <thead className="bg-purple-50">{props.children}</thead>
          ),
          tbody: (props) => (
            <tbody>{props.children}</tbody>
          ),
          tr: (props) => (
            <tr className="border-b border-gray-200">{props.children}</tr>
          ),
          th: (props) => (
            <th className="px-2 py-1 text-left font-semibold border border-gray-200">
              {props.children}
            </th>
          ),
          td: (props) => (
            <td className="px-2 py-1 border border-gray-200">{props.children}</td>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
