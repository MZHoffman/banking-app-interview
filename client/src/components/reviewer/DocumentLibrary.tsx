import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { decisionsDocument, questionsDocument, specificationDocument } from "../../content/reviewerDocuments";

const documents = [
  {
    id: "decisions",
    label: "Decision record",
    content: decisionsDocument,
    description: "The implemented design, its rationale and accepted trade-offs.",
    level: 2,
  },
  {
    id: "specification",
    label: "Specification",
    content: specificationDocument,
    description: "The current application behavior, API, data model and acceptance criteria.",
    level: 2,
  },
  {
    id: "questions",
    label: "Questions & answers",
    content: questionsDocument,
    description: "62 selected design questions, with answers aligned to the current implementation.",
    level: 3,
  },
] as const;

type DocumentSection = { title: string; content: string; category: string };
function sectionsOf(content: string, level: number) {
  const sections: DocumentSection[] = [];
  let introduction = "";
  let category = "";
  let current: DocumentSection | undefined;
  let fenced = false;
  for (const line of content.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const heading = !fenced ? /^(#{1,3}) (.+)$/.exec(line) : null;
    if (heading?.[1]?.length === 1) continue;
    if (level === 3 && heading?.[1]?.length === 2) {
      category = heading[2]!;
      current = undefined;
      continue;
    }
    if (heading?.[1]?.length === level) {
      current = { title: heading[2]!, category, content: "" };
      sections.push(current);
    } else if (current) current.content += `${line}\n`;
    else introduction += `${line}\n`;
  }
  return { introduction, sections };
}
const parsedDocuments = documents.map((document) => ({ ...document, ...sectionsOf(document.content, document.level) }));

function DocumentMarkdown({ content }: { content: string }) {
  return (
    <div className="review-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h3: ({ children }) => <h4>{children}</h4>,
          h4: ({ children }) => <h5>{children}</h5>,
          table: ({ children }) => (
            <div className="review-table-wrap">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) =>
            href?.startsWith("https://") || href?.startsWith("http://") ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>
                {children}
                {href ? <code> ({href})</code> : null}
              </span>
            ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

export function DocumentLibrary() {
  const [active, setActive] = useState("decisions");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const document = parsedDocuments.find((item) => item.id === active)!;
  const term = query.trim().toLowerCase();
  const sections = document.sections.filter((section) =>
    `${section.title} ${section.category} ${section.content}`.toLowerCase().includes(term),
  );
  return (
    <div className="review-document-library">
      <p className="review-lead">
        Explore the decisions, application specification and engineering Q&amp;A directly in this guide. Each section
        explains the current implementation and its intended improvements.
      </p>
      <div className="review-document-tabs" aria-label="Choose a source document">
        {parsedDocuments.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={active === item.id}
            onClick={() => {
              setActive(item.id);
              setQuery("");
              setExpanded(false);
            }}
          >
            <strong>{item.label}</strong>
            <small>
              {item.sections.length} {item.id === "questions" ? "entries" : "sections"}
            </small>
          </button>
        ))}
      </div>
      <div className="review-document-reader" key={active}>
        <div className="review-document-heading">
          <div>
            <span className="review-kicker">SOURCE DOCUMENT</span>
            <h3>{document.label}</h3>
          </div>
        </div>
        <p>{document.description}</p>
        <div className="review-document-tools">
          <div>
            <label htmlFor="review-document-search">Search this document</label>
            <input
              id="review-document-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                active === "questions" ? "Try deadlocks, passwords or Q41…" : "Try balances, constraints or sessions…"
              }
            />
          </div>
          {!term && (
            <button className="outline-button" type="button" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
        <p className="review-document-count" role="status">
          {sections.length} of {document.sections.length} entries{term ? ` matching “${query.trim()}”` : ""}
        </p>
        {!term && <DocumentMarkdown content={document.introduction} />}
        <div key={`${active}-${expanded}-${term ? "search" : "browse"}`} className="review-document-sections">
          {sections.map((section) => (
            <details key={section.title} open={expanded || Boolean(term)}>
              <summary>
                {section.category && <span>{section.category}</span>}
                <strong>{section.title}</strong>
                <b aria-hidden="true">+</b>
              </summary>
              <DocumentMarkdown content={section.content} />
            </details>
          ))}
        </div>
        {sections.length === 0 && (
          <p className="review-document-empty">
            No matching entries. Try a different term or{" "}
            <button type="button" onClick={() => setQuery("")}>
              clear the search
            </button>
            .
          </p>
        )}
      </div>
    </div>
  );
}
