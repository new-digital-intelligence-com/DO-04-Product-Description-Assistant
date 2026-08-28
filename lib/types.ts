export type Attributes = Record<string, string>;

export type Product = {
  sku: string;
  category: string;
  attributes: Attributes;
  source: 'sample' | 'user';
};

export type Claim = { text: string; attribute: string; value: string };

export type Copy = {
  title: string;
  bullets: string[];
  long_copy: string;
  meta_description: string;
  keywords_used: string[];
  claims: Claim[];
};

export type Finding = { check: string; detail: string };

/** One translated variant. It lives inside its product's Result rather than in a file of
 *  its own: a locale is a view of one product's description, not a separate description,
 *  and splitting them let a master and its translations drift apart on disk. */
export type LocaleVariant = {
  locale: string;
  copy: Copy;
  status: 'PASS' | 'FAIL';
  findings: Finding[];
  checks_off: string[];            // checks that could not run in this locale
  translated_from: string;
  review_status: string;
  generated_at: string;
  /** True when the English master was rewritten after this translation was made, so the
   *  variant no longer reflects the copy it was translated from. Kept and flagged rather
   *  than deleted: silently dropping a client's reviewed translation is worse, and
   *  silently keeping it as current is a lie. */
  stale?: boolean;
};

export type Result = {
  sku: string;
  category: string;
  attributes: Attributes;
  copy: Copy;                      // the English master
  status: 'PASS' | 'FAIL';
  findings: Finding[];
  source: 'sample' | 'user';
  generated_at: string;
  attempts: number;
  locales?: Record<string, LocaleVariant>;
};

export type Step =
  | { type: 'step'; id: string; label: string; state: 'running' | 'done' | 'fail' | 'skip'; detail?: string }
  | { type: 'token'; text: string }
  | { type: 'result'; result: Result; locale?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; passed: number; failed: number };
