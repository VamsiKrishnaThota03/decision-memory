import api, { route } from '@forge/api';
import { adfToText } from '../lib/adf.js';

/**
 * Read a Confluence page as the current user (Confluence enforces page
 * permissions), returning its title, URL and a Markdown-ish text rendering in
 * which native decision blocks become "Decision: ..." lines and headings keep
 * their "#" levels — so the ADR parser can read both Atlassian decision blocks
 * and ADR-style pages.
 */
export async function getPageAsUser(pageId) {
  if (!/^\d{1,20}$/.test(String(pageId))) throw Object.assign(new Error('Invalid page id.'), { userFacing: true });
  const res = await api
    .asUser()
    .requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`, {
      headers: { Accept: 'application/json' },
    });
  if (!res.ok) {
    throw Object.assign(new Error(res.status === 404 || res.status === 403 ? 'Page not found.' : 'Could not read the page.'), {
      userFacing: true,
    });
  }
  const page = await res.json();
  let doc = null;
  try {
    doc = JSON.parse(page?.body?.atlas_doc_format?.value ?? 'null');
  } catch {
    doc = null;
  }
  const base = String(page?._links?.base ?? '').replace(/\/$/, '');
  const webui = page?._links?.webui ?? '';
  return {
    id: String(page.id),
    title: page.title ?? '',
    url: base && webui ? `${base}${webui}` : null,
    markdownish: adfToMarkdownish(doc, page.title ?? ''),
  };
}

/** Pure: ADF → text with "#"-headings and decision items as "Decision:" lines. Exported for tests. */
export function adfToMarkdownish(doc, title = '') {
  const lines = [];
  // Keep heading levels as authored so a page with several "# ADR" sections splits correctly.
  const hasH1 = JSON.stringify(doc ?? {}).includes('"level":1');
  if (title && !hasH1) lines.push(`# ${title}`);
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'heading') {
      lines.push(`${'#'.repeat(Math.min(6, n.attrs?.level ?? 1))} ${adfToText(n)}`);
      return;
    }
    if (n.type === 'decisionItem') {
      if ((n.attrs?.state ?? 'DECIDED') === 'DECIDED') lines.push(`Decision: ${adfToText(n)}`);
      return;
    }
    if (n.type === 'paragraph' || n.type === 'listItem' || n.type === 'codeBlock') {
      lines.push(adfToText(n));
      return;
    }
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return lines.filter((l) => l.trim()).join('\n');
}
