/**
 * Material import bundle (scripts/content/build_content_bundle.py → panel "Import materiałów").
 * Items arrive as drafts; the owner reviews them in the panel before publishing (spec E, decision D9).
 */
export const CONTENT_BUNDLE_FORMAT = 'senator-content-bundle';
export const CONTENT_IMPORT_CHUNK = 4;

export interface ContentBundleItem {
  importKey: string;
  kind: string;
  title: string;
  section?: string | null;
  positions?: string[];
  requiresAck?: boolean;
  sortOrder?: number;
  body: unknown;
}

export interface ContentBundle {
  format: typeof CONTENT_BUNDLE_FORMAT;
  version: 1;
  createdAt?: string;
  items: ContentBundleItem[];
  notes?: string[];
}

export function checkContentBundle(v: unknown): ContentBundle | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as ContentBundle;
  if (b.format !== CONTENT_BUNDLE_FORMAT || b.version !== 1 || !Array.isArray(b.items)) return null;
  return b;
}
