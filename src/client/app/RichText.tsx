/** Read-only renderer for sanitized TipTap JSON (no editor code in the staff bundle). */
import type { ReactNode } from 'react';
import type { RtNode } from '../../shared/richtext';
import { pl } from '../i18n/pl';

function marks(text: ReactNode, list: RtNode['marks']): ReactNode {
  let out = text;
  for (const m of list ?? []) {
    if (m.type === 'bold') out = <strong>{out}</strong>;
    else if (m.type === 'italic') out = <em>{out}</em>;
    else if (m.type === 'underline') out = <u>{out}</u>;
    else if (m.type === 'link') {
      const href = String(m.attrs?.href ?? '');
      out = (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow">
          {out}
        </a>
      );
    }
  }
  return out;
}

function children(n: RtNode): ReactNode {
  return (n.content ?? []).map((c, i) => <Node key={i} n={c} />);
}

function Node({ n }: { n: RtNode }): ReactNode {
  switch (n.type) {
    case 'doc':
      return <>{children(n)}</>;
    case 'paragraph':
      return <p>{children(n)}</p>;
    case 'heading':
      return n.attrs?.level === 3 ? <h3>{children(n)}</h3> : <h2>{children(n)}</h2>;
    case 'bulletList':
      return <ul>{children(n)}</ul>;
    case 'orderedList':
      return <ol>{children(n)}</ol>;
    case 'listItem':
      return <li>{children(n)}</li>;
    case 'text':
      return marks(n.text ?? '', n.marks);
    case 'hardBreak':
      return <br />;
    case 'horizontalRule':
      return <hr />;
    case 'image':
      return <img src={String(n.attrs?.src ?? '')} alt={String(n.attrs?.alt ?? '')} loading="lazy" />;
    case 'table':
      return (
        <div className="rt-table">
          <table>
            <tbody>{children(n)}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr>{children(n)}</tr>;
    case 'tableHeader':
      return <th colSpan={Number(n.attrs?.colspan ?? 1)} rowSpan={Number(n.attrs?.rowspan ?? 1)} scope="col">{children(n)}</th>;
    case 'tableCell':
      return <td colSpan={Number(n.attrs?.colspan ?? 1)} rowSpan={Number(n.attrs?.rowspan ?? 1)}>{children(n)}</td>;
    case 'callout': {
      const variant = String(n.attrs?.variant ?? 'info');
      return (
        <div className="callout" data-variant={variant} data-label={pl.academy.callout[variant] ?? ''} role="note">
          {children(n)}
        </div>
      );
    }
    default:
      return null;
  }
}

export function RichText({ doc }: { doc: RtNode }) {
  return (
    <div className="rt reader">
      <Node n={doc} />
    </div>
  );
}
