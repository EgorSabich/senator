import { useMemo, useState } from 'react';
import { EU_ALLERGENS } from '../../shared/constants';
import { foldPolish } from '../../shared/text';
import { pl } from '../i18n/pl';
import { navigate, onNav } from '../router';
import { Icon, Loading, Problem, useAcademy, useApi } from './shared';

type Section = 'kitchen' | 'bar';
interface MenuData {
  sections: Record<Section, { note: string | null }>;
  categories: { id: string; section: Section; name: string }[];
  items: { id: string; categoryId: string; section: Section; nameGuest: string; namePos: string | null; photoSrc: string | null; showAllergens: boolean; allergens: string[] }[];
}
interface ItemView {
  item: {
    id: string;
    section: Section;
    categoryName: string;
    texts: Record<string, string | null>;
    ingredients: string[];
    photoSrc: string | null;
    showAllergens: boolean;
    allergens: string[];
    diets: string[];
    allergensComplete: boolean;
  };
}

const t = pl.academy.menu;
const f = pl.admin.menu.fields;
const ALLERGEN_NAMES: Record<string, string> = Object.fromEntries(EU_ALLERGENS.map((a) => [a.code, a.pl]));
const SECTION_KEY = 'sa.app.menuSection';

function storedSection(): Section {
  try {
    return localStorage.getItem(SECTION_KEY) === 'bar' ? 'bar' : 'kitchen';
  } catch {
    return 'kitchen';
  }
}

export function MenuList() {
  const { locationId } = useAcademy();
  const { data, error } = useApi<MenuData>(`/api/locations/${locationId}/menu`);
  const [section, setSection] = useState<Section>(storedSection);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');

  const cats = useMemo(() => (data?.categories ?? []).filter((c) => c.section === section), [data, section]);
  const items = useMemo(() => {
    const q = foldPolish(query.trim());
    return (data?.items ?? []).filter((i) => i.section === section && (category === 'all' || i.categoryId === category) && (!q || foldPolish(`${i.nameGuest} ${i.namePos ?? ''}`).includes(q)));
  }, [data, section, category, query]);

  function pick(s: Section) {
    setSection(s);
    setCategory('all');
    try {
      localStorage.setItem(SECTION_KEY, s);
    } catch {
      /* private mode */
    }
  }

  return (
    <main className="a-main">
      <h1 className="a-title">{t.title}</h1>
      <div className="a-chips" role="tablist" aria-label={t.title}>
        {(['kitchen', 'bar'] as const).map((s) => (
          <button key={s} role="tab" className="a-chip" aria-selected={section === s} aria-pressed={section === s} onClick={() => pick(s)} style={{ fontSize: 15, padding: '0 20px', minHeight: 42 }}>
            {pl.admin.menu.sections[s]}
          </button>
        ))}
      </div>
      <label className="a-search">
        <Icon name="search" size={18} />
        <span className="sr-only">{t.search}</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} />
      </label>
      {cats.length > 1 && (
        <div className="a-chips" role="group">
          <button className="a-chip" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
            {t.all}
          </button>
          {cats.map((c) => (
            <button key={c.id} className="a-chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      <Problem message={error} />
      {!data && !error && <Loading />}
      {data?.sections[section].note && (
        <div className="a-note">
          <Icon name="info" size={18} />
          <span>{data.sections[section].note}</span>
        </div>
      )}
      {data && items.length === 0 && <p className="a-sub">{t.empty}</p>}
      {cats
        .filter((c) => items.some((i) => i.categoryId === c.id))
        .map((c) => (
          <section key={c.id} className="a-menu-grid" aria-label={c.name}>
            <h2 className="a-label">{c.name}</h2>
            {items
              .filter((i) => i.categoryId === c.id)
              .map((i) => (
                <a key={i.id} className="a-dish" href={`/menu/${i.id}`} onClick={onNav(`/menu/${i.id}`)}>
                  {i.photoSrc ? <img src={i.photoSrc} alt="" loading="lazy" /> : <span className="ph" aria-hidden="true" />}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{i.nameGuest}</span>
                    {i.showAllergens && i.allergens.length > 0 && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{i.allergens.map((a) => ALLERGEN_NAMES[a] ?? a).join(' · ')}</span>
                    )}
                  </span>
                </a>
              ))}
          </section>
        ))}
    </main>
  );
}

type Tab = 'about' | 'sell' | 'questions';

export function MenuItem({ id }: { id: string }) {
  const { online } = useAcademy();
  const { data, error } = useApi<ItemView>(`/api/menu/items/${id}`);
  const [chosen, setTab] = useState<Tab | null>(null);

  const back = () => (history.length > 1 ? history.back() : navigate('/menu'));
  if (!data) {
    return (
      <main className="a-main">
        <button className="a-icon-btn" onClick={back} aria-label={pl.academy.reader.back} style={{ marginTop: 16 }}>
          <Icon name="back" />
        </button>
        <Problem message={error} />
        {!error && <Loading />}
      </main>
    );
  }
  const it = data.item;
  const x = it.texts;
  const about: [string, string | null][] = [
    [f.description!, x.description ?? null],
    [f.ingredients!, it.ingredients.length ? it.ingredients.join('\n') : null],
    [f.keyIngredient!, x.keyIngredient ?? null],
    [f.tasteTexture!, x.tasteTexture ?? null],
    [f.serving!, x.serving ?? null],
    [f.alcoholNote!, x.alcoholNote ?? null],
  ];
  const sell: [string, string | null][] = [
    [f.howToSell!, x.howToSell ?? null],
    [f.upsell!, x.upsell ?? null],
    [f.goodToKnow!, x.goodToKnow ?? null],
  ];
  const tabs: { id: Tab; label: string; has: boolean }[] = [
    { id: 'about', label: t.tabs.about, has: about.some(([, v]) => v) },
    { id: 'sell', label: t.tabs.sell, has: sell.some(([, v]) => v) },
    { id: 'questions', label: t.tabs.questions, has: Boolean(x.guestQuestions) },
  ];
  const tab: Tab = chosen ?? tabs.find((tb) => tb.has)?.id ?? 'about';

  return (
    <main className="a-main bare">
      <div className="a-hero">
        {it.photoSrc ? (
          <img src={it.photoSrc} alt={x.nameGuest ?? ''} />
        ) : (
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }} aria-hidden="true">
            <Icon name="photo" size={36} />
          </span>
        )}
        <button className="a-icon-btn" onClick={back} aria-label={pl.academy.reader.back}>
          <Icon name="back" />
        </button>
        {!online && (
          <span className="a-offline" style={{ position: 'absolute', top: 22, right: 12 }}>
            {pl.app.offline}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="a-label" style={{ color: 'var(--accent)' }}>
          {pl.admin.menu.sections[it.section]} · {it.categoryName}
        </span>
        <h1 className="a-title" style={{ fontSize: 30 }}>
          {x.nameGuest}
        </h1>
        {x.namePos && x.namePos !== x.nameGuest && <span className="a-sub">{t.posName(x.namePos)}</span>}
      </div>

      {x.warnGuest && (
        <div className="a-note warn">
          <Icon name="info" size={18} />
          <span>
            <strong>{f.warnGuest}: </strong>
            {x.warnGuest}
          </span>
        </div>
      )}

      <div className="a-tabs" role="tablist" aria-label={x.nameGuest ?? ''}>
        {tabs
          .filter((tb) => tb.has)
          .map((tb) => (
            <button key={tb.id} role="tab" aria-selected={tab === tb.id} onClick={() => setTab(tb.id)}>
              {tb.label}
            </button>
          ))}
      </div>

      {tab === 'about' && <Fields rows={about} />}
      {tab === 'sell' && <Fields rows={sell} />}
      {tab === 'questions' && <p className="a-text">{x.guestQuestions}</p>}

      {it.showAllergens && (
        <section className="a-block" aria-label={t.allergens}>
          <h2>{t.allergens}</h2>
          {it.allergens.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {it.allergens.map((a) => (
                <span key={a} className="a-pill allergen">
                  {ALLERGEN_NAMES[a] ?? a}
                </span>
              ))}
            </div>
          ) : (
            it.allergensComplete && <p className="a-sub">{t.noAllergens}</p>
          )}
          {!it.allergensComplete && <p className="a-sub">{t.allergensPartial}</p>}
          {it.diets.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {it.diets.map((d) => (
                <span key={d} className="a-pill ok">
                  {pl.admin.menu.dietNames[d]}
                </span>
              ))}
            </div>
          )}
          {x.dietNote && <p className="a-sub" style={{ whiteSpace: 'pre-wrap' }}>{x.dietNote}</p>}
        </section>
      )}
      <div className="a-note">
        <Icon name="info" size={18} />
        <span>{pl.common.askKitchen}</span>
      </div>
    </main>
  );
}

function Fields({ rows }: { rows: [string, string | null][] }) {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {shown.map(([k, v]) => (
        <div key={k} className="a-block">
          <h2>{k}</h2>
          <p className="a-text">{v}</p>
        </div>
      ))}
    </div>
  );
}
