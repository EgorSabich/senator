import { LogoLoader } from "../ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EU_ALLERGENS } from "../../shared/constants";
import {
  BUNDLE_FORMAT,
  checkBundle,
  IMPORT_CHUNK,
  MENU_TEXT_FIELD_NAMES,
  type MenuBundle,
  type MenuSection,
  type MenuTextField,
} from "../../shared/menu";
import { comparePl, foldPolish } from "../../shared/text";
import { api, ApiFailure } from "../api";
import { errorText, pl } from "../i18n/pl";
import { goBack, navigate, restoreScroll } from "../router";
import { Disclosure, ErrorBox } from "../ui";
import { resizeImage, uploadFile } from "../editor/image";
import {
  Btn,
  DeleteForeverModal,
  formatDateTime,
  Icon,
  Modal,
  storageGet,
  storageSet,
} from "./common";
import { usePanel } from "./Panel";

const t = pl.admin.menu;
const levels = pl.admin.content.levels;

interface ListItem {
  id: string;
  categoryId: string;
  section: MenuSection;
  nameGuest: string;
  namePos: string | null;
  isActive: boolean;
  photoSrc: string | null;
  sortOrder: number;
  versionNo: number;
}
interface Category {
  id: string;
  section: MenuSection;
  name: string;
  sortOrder: number;
  activeCount: number;
}
interface MenuData {
  sections: Record<MenuSection, { note: string | null }>;
  categories: Category[];
  items: ListItem[];
  canEdit: boolean;
}

const SECTION_KEY = "sa.panel.menuSection";
const errOf = (e: unknown) =>
  errorText(
    e instanceof ApiFailure
      ? e.code
      : ((e as { code?: string })?.code ?? "generic"),
  );

export function Menu({ selectedId }: { selectedId: string | null }) {
  const { locationId } = usePanel();
  const [data, setData] = useState<MenuData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<MenuSection>(
    storageGet(SECTION_KEY) === "bar" ? "bar" : "kitchen",
  );
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<"item" | "category" | "import" | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      setData(await api<MenuData>(`/api/admin/locations/${locationId}/menu`));
    } catch (e) {
      setError(errOf(e));
    }
  }, [locationId]);
  useEffect(() => {
    void load();
  }, [load]);

  const cats = useMemo(
    () => (data?.categories ?? []).filter((c) => c.section === section),
    [data, section],
  );
  const shown = useMemo(() => {
    const q = foldPolish(query.trim());
    return (data?.items ?? [])
      .filter((i) => i.section === section)
      .filter((i) => showArchived || i.isActive)
      .filter((i) => category === "all" || i.categoryId === category)
      .filter(
        (i) =>
          !q || foldPolish(`${i.nameGuest} ${i.namePos ?? ""}`).includes(q),
      );
  }, [data, section, category, query, showArchived]);
  const selected = data?.items.find((i) => i.id === selectedId) ?? null;
  // back to the list (button or swipe): the list comes back where it was left
  useEffect(() => {
    if (!selectedId && data) restoreScroll();
  }, [selectedId, data]);
  const archived = useMemo(
    () =>
      (data?.items ?? []).filter((i) => i.section === section && !i.isActive),
    [data, section],
  );
  const [restoring, setRestoring] = useState<number | null>(null);

  async function restoreAll() {
    if (!window.confirm(t.restoreAllConfirm(archived.length))) return;
    setError(null);
    setRestoring(0);
    try {
      for (const [n, i] of archived.entries()) {
        await api(`/api/admin/menu/items/${i.id}/restore`, { method: "POST" });
        setRestoring(n + 1);
      }
    } catch (e) {
      setError(errOf(e));
    } finally {
      setRestoring(null);
      await load();
    }
  }

  function pickSection(s: MenuSection) {
    setSection(s);
    setCategory("all");
    storageSet(SECTION_KEY, s);
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <h1 className="page-title">{t.title}</h1>
        {data?.canEdit && (
          <div className="btn-row">
            <Btn
              kind="primary"
              onClick={() => setDialog("item")}
              disabled={!cats.length}
            >
              {t.addItem}
            </Btn>
            <Btn onClick={() => setDialog("category")}>{t.addCategory}</Btn>
            <Btn onClick={() => setDialog("import")}>{t.import}</Btn>
          </div>
        )}
      </div>
      <ErrorBox message={error} />
      <div className="btn-row" role="tablist" aria-label={t.title}>
        {(["kitchen", "bar"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            className="chip"
            aria-selected={section === s}
            aria-pressed={section === s}
            onClick={() => pickSection(s)}
            style={{ fontSize: 15, minHeight: 42, padding: "0 20px" }}
          >
            {t.sections[s]} ·{" "}
            {data?.items.filter((i) => i.section === s && i.isActive).length ??
              0}
          </button>
        ))}
      </div>
      {data && (
        <SectionNote
          key={`${section}:${data.sections[section].note ?? ""}`}
          section={section}
          note={data.sections[section].note}
          canEdit={data.canEdit}
          onSaved={load}
        />
      )}
      <div className={`split${selectedId ? " has-selection" : ""}`}>
        <section className="list" aria-label={t.sections[section]}>
          <label className="search-box">
            <Icon name="search" size={18} />
            <span className="sr-only">{t.search}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.search}
            />
          </label>
          <div className="btn-row" role="group">
            <button
              className="chip"
              aria-pressed={category === "all"}
              onClick={() => setCategory("all")}
            >
              {t.allCategories}
            </button>
            {cats.map((c) => (
              <button
                key={c.id}
                className="chip"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <label className="check" style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span>{t.showArchived}</span>
          </label>
          {showArchived && data?.canEdit && archived.length > 0 && (
            <Btn
              onClick={() => void restoreAll()}
              disabled={restoring !== null}
            >
              {restoring !== null
                ? t.restoringAll(restoring, archived.length)
                : t.restoreAll(archived.length)}
            </Btn>
          )}
          {data === null && <LogoLoader />}
          {data !== null && shown.length === 0 && (
            <p className="muted">
              {data.items.some((i) => i.section === section)
                ? t.empty
                : t.emptySection}
            </p>
          )}
          {cats
            .filter((c) => shown.some((i) => i.categoryId === c.id))
            .map((c) => (
              <div
                key={c.id}
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                <div className="label" style={{ marginTop: 6 }}>
                  {c.name}
                </div>
                {shown
                  .filter((i) => i.categoryId === c.id)
                  .map((i) => (
                    <button
                      key={i.id}
                      className="row-btn menu-row"
                      aria-current={i.id === selectedId}
                      onClick={() => {
                        navigate(`/panel/menu/${i.id}`);
                        window.scrollTo(0, 0);
                      }}
                    >
                      {i.photoSrc ? (
                        <img src={i.photoSrc} alt="" loading="lazy" />
                      ) : (
                        <span className="thumb-empty" aria-hidden="true" />
                      )}
                      <span
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 5,
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            overflowWrap: "anywhere",
                          }}
                        >
                          {i.nameGuest}
                        </span>
                        <span
                          style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                        >
                          {!i.isActive && (
                            <span className="badge neutral">{t.archived}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  ))}
              </div>
            ))}
        </section>
        <section
          className="detail card"
          aria-label={selected?.nameGuest ?? t.selectHint}
        >
          {!selectedId && (
            <p className="muted" style={{ margin: 0 }}>
              {t.selectHint}
            </p>
          )}
          {selectedId && (
            <div className="phone-only" style={{ marginBottom: 14 }}>
              <Btn onClick={() => goBack("/panel/menu")}>‹ {t.backToList}</Btn>
            </div>
          )}
          {selectedId && data && (
            <ItemDetail
              key={selectedId}
              id={selectedId}
              categories={data.categories}
              onChanged={load}
            />
          )}
        </section>
      </div>
      {dialog === "category" && (
        <AddCategory
          section={section}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            await load();
          }}
        />
      )}
      {dialog === "item" && (
        <AddItem
          categories={cats}
          initial={category !== "all" ? category : (cats[0]?.id ?? "")}
          onClose={() => setDialog(null)}
          onDone={async (id) => {
            setDialog(null);
            await load();
            navigate(`/panel/menu/${id}`);
          }}
        />
      )}
      {dialog === "import" && (
        <ImportDialog onClose={() => setDialog(null)} onDone={load} />
      )}
    </>
  );
}

function SectionNote({
  section,
  note,
  canEdit,
  onSaved,
}: {
  section: MenuSection;
  note: string | null;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const { locationId } = usePanel();
  const [value, setValue] = useState(note ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!canEdit && !note) return null;
  return (
    <div
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14 }}
    >
      {canEdit ? (
        <>
          <div className="field">
            <label htmlFor={`note-${section}`}>{t.sectionNote}</label>
            <textarea
              id={`note-${section}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={2000}
              style={{ minHeight: 60 }}
            />
          </div>
          <ErrorBox message={error} />
          <div className="btn-row" style={{ alignItems: "center" }}>
            <Btn
              disabled={value.trim() === (note ?? "")}
              onClick={async () => {
                setError(null);
                try {
                  await api(
                    `/api/admin/locations/${locationId}/menu/sections/${section}`,
                    { method: "PUT", body: { note: value } },
                  );
                  setMsg(t.saved);
                  await onSaved();
                } catch (e) {
                  setError(errOf(e));
                }
              }}
            >
              {t.sectionNoteSave}
            </Btn>
            {msg && (
              <span className="muted" style={{ fontSize: 13 }}>
                {msg}
              </span>
            )}
          </div>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{note}</p>
      )}
    </div>
  );
}

/* ───────── Detail ───────── */

interface Detail {
  item: {
    id: string;
    categoryId: string;
    categoryName: string;
    section: MenuSection;
    texts: Record<MenuTextField, string | null>;
    ingredients: string[];
    photoSrc: string | null;
    isActive: boolean;
    versionNo: number;
  };
  allergens: {
    allergenId: string;
    status: string;
    sourceNote: string | null;
    confirmedAt: number | null;
    confirmedByName: string | null;
  }[];
  diets: {
    diet: string;
    status: string;
    sourceNote: string | null;
    confirmedAt: number | null;
    confirmedByName: string | null;
  }[];
  versions: {
    id: string;
    versionNo: number;
    changeLevel: string;
    changeNote: string | null;
    createdAt: number;
    authorFirstName: string | null;
    authorLastName: string | null;
  }[];
  canEdit: boolean;
}

const SINGLE_LINE: MenuTextField[] = [
  "nameGuest",
  "namePos",
  "keyIngredient",
  "serving",
  "alcoholNote",
];

function ItemDetail({
  id,
  categories,
  onChanged,
}: {
  id: string;
  categories: Category[];
  onChanged: () => Promise<void>;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [ingredients, setIngredients] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewVersion, setViewVersion] = useState<string | null>(null);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<Detail>(`/api/admin/menu/items/${id}`);
      setD(res);
      setTexts(
        Object.fromEntries(
          MENU_TEXT_FIELD_NAMES.map((f) => [f, res.item.texts[f] ?? ""]),
        ),
      );
      setIngredients(res.item.ingredients.join("\n"));
      setCategoryId(res.item.categoryId);
    } catch (e) {
      setError(errOf(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!d) return error ? <ErrorBox message={error} /> : <LogoLoader />;

  const dirty =
    MENU_TEXT_FIELD_NAMES.some(
      (f) => (texts[f] ?? "").trim() !== (d.item.texts[f] ?? ""),
    ) ||
    ingredients
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .join("\n") !== d.item.ingredients.join("\n") ||
    categoryId !== d.item.categoryId;

  async function save(level: string, note: string): Promise<string | null> {
    try {
      await api(`/api/admin/menu/items/${id}`, {
        method: "PUT",
        body: {
          texts: Object.fromEntries(
            MENU_TEXT_FIELD_NAMES.map((f) => [f, texts[f] ?? ""]),
          ),
          ingredients: ingredients.split("\n"),
          categoryId,
          changeLevel: level,
          changeNote: note || undefined,
        },
      });
      setNotice(t.saved);
      setSaving(false);
      await load();
      await onChanged();
      return null;
    } catch (e) {
      return errOf(e);
    }
  }

  async function act(path: string, method = "POST") {
    setError(null);
    try {
      await api(`/api/admin/menu/items/${id}/${path}`, { method });
      await load();
      await onChanged();
    } catch (e) {
      setError(errOf(e));
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setBusyPhoto(true);
    setError(null);
    try {
      const blob = await resizeImage(file);
      await uploadFile(
        `/api/admin/menu/items/${id}/photo`,
        blob,
        file.name.replace(/\.[^.]+$/, "") +
          (blob.type === "image/webp" ? ".webp" : ".jpg"),
      );
      await load();
      await onChanged();
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusyPhoto(false);
    }
  }

  const sectionCats = categories
    .filter((c) => c.section === d.item.section)
    .sort((a, b) => a.sortOrder - b.sortOrder || comparePl(a.name, b.name));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 28,
              fontWeight: 600,
              overflowWrap: "anywhere",
            }}
          >
            {d.item.texts.nameGuest}
          </h2>
          <span className="muted" style={{ fontSize: 13 }}>
            {t.sections[d.item.section]} · {d.item.categoryName} ·{" "}
            {pl.admin.content.version(d.item.versionNo)}
          </span>
        </div>
        {d.canEdit && (
          <div className="btn-row">
            <Btn
              kind={d.item.isActive ? "danger" : "secondary"}
              onClick={() => void act(d.item.isActive ? "archive" : "restore")}
            >
              {d.item.isActive ? t.archive : t.restore}
            </Btn>
            {!d.item.isActive && (
              <Btn kind="danger" onClick={() => setDeleting(true)}>
                {pl.admin.deleteForever.button}
              </Btn>
            )}
          </div>
        )}
      </div>
      {deleting && (
        <DeleteForeverModal
          title={pl.admin.deleteForever.itemTitle(d.item.texts.nameGuest ?? "")}
          impactPath={null}
          confirmText={d.item.texts.nameGuest ?? ""}
          lines={pl.admin.deleteForever.menuLines}
          deletePath={`/api/admin/menu/items/${id}`}
          onClose={() => setDeleting(false)}
          onDeleted={async () => {
            setDeleting(false);
            await onChanged();
            navigate("/panel/menu");
          }}
        />
      )}
      {!d.item.isActive && (
        <div className="notice warn-notice">{t.archivedNote}</div>
      )}
      <ErrorBox message={error} />
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "flex-end",
        }}
      >
        {d.item.photoSrc ? (
          <img
            src={d.item.photoSrc}
            alt={d.item.texts.nameGuest ?? ""}
            className="menu-photo"
          />
        ) : (
          <div
            className="menu-photo thumb-empty muted"
            style={{ display: "grid", placeItems: "center", fontSize: 13 }}
          >
            {t.noPhoto}
          </div>
        )}
        {d.canEdit && (
          <div className="btn-row">
            <label className="file-btn">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busyPhoto}
                onChange={(e) => void pickPhoto(e.target.files?.[0])}
              />
              <span>
                {busyPhoto
                  ? pl.admin.content.editor.uploading
                  : d.item.photoSrc
                    ? t.photoChange
                    : t.photoAdd}
              </span>
            </label>
            {d.item.photoSrc && (
              <Btn onClick={() => void act("photo", "DELETE")}>
                {t.photoRemove}
              </Btn>
            )}
          </div>
        )}
      </div>

      <fieldset
        disabled={!d.canEdit}
        style={{
          border: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div className="field">
          <label htmlFor="mcat">{t.fields.category}</label>
          <select
            id="mcat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {sectionCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {MENU_TEXT_FIELD_NAMES.map((f) => (
          <div className="field" key={f}>
            <label htmlFor={`mf-${f}`}>{t.fields[f]}</label>
            {SINGLE_LINE.includes(f) ? (
              <input
                id={`mf-${f}`}
                value={texts[f] ?? ""}
                onChange={(e) => setTexts({ ...texts, [f]: e.target.value })}
              />
            ) : (
              <textarea
                id={`mf-${f}`}
                value={texts[f] ?? ""}
                onChange={(e) => setTexts({ ...texts, [f]: e.target.value })}
                rows={Math.min(
                  8,
                  Math.max(3, (texts[f] ?? "").split("\n").length + 1),
                )}
              />
            )}
            {f === "description" && (
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="mf-ingredients">{t.fields.ingredients}</label>
                <textarea
                  id="mf-ingredients"
                  value={ingredients}
                  onChange={(e) => setIngredients(e.target.value)}
                  rows={Math.min(
                    10,
                    Math.max(3, ingredients.split("\n").length + 1),
                  )}
                />
                <span className="muted" style={{ fontSize: 12 }}>
                  {t.ingredientsHint}
                </span>
              </div>
            )}
          </div>
        ))}
        {d.canEdit && (
          <div className="btn-row sticky-actions">
            <Btn
              kind="primary"
              disabled={!dirty}
              onClick={() => setSaving(true)}
            >
              {t.save}
            </Btn>
          </div>
        )}
      </fieldset>

      {d.item.section === "kitchen" && (
        <Allergens
          d={d}
          onSaved={async () => {
            await load();
            await onChanged();
          }}
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 className="label" style={{ margin: 0 }}>
          {t.history}
        </h3>
        {d.versions.map((v) => (
          <div
            key={v.id}
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              gap: 8,
              padding: "10px 12px",
              border: "1px solid var(--border)",
              borderRadius: 10,
            }}
          >
            <span style={{ fontSize: 14 }}>
              <strong>{t.versionTitle(v.versionNo)}</strong> ·{" "}
              {levels[v.changeLevel]?.label} · {formatDateTime(v.createdAt)}
              {v.authorFirstName
                ? ` · ${v.authorFirstName} ${v.authorLastName}`
                : ""}
              {v.changeNote ? (
                <span className="muted"> — {v.changeNote}</span>
              ) : null}
            </span>
            <Btn onClick={() => setViewVersion(v.id)}>{t.versionView}</Btn>
          </div>
        ))}
      </div>

      {saving && <LevelDialog onClose={() => setSaving(false)} onSave={save} />}
      {viewVersion && (
        <VersionDialog
          itemId={id}
          versionId={viewVersion}
          onClose={() => setViewVersion(null)}
        />
      )}
    </div>
  );
}

function Allergens({
  d,
  onSaved,
}: {
  d: Detail;
  onSaved: () => Promise<void>;
}) {
  const [a, setA] = useState<Record<string, string>>(() =>
    Object.fromEntries(d.allergens.map((x) => [x.allergenId, x.status])),
  );
  const [di, setDi] = useState<Record<string, string>>(() =>
    Object.fromEntries(d.diets.map((x) => [x.diet, x.status])),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setA(Object.fromEntries(d.allergens.map((x) => [x.allergenId, x.status])));
    setDi(Object.fromEntries(d.diets.map((x) => [x.diet, x.status])));
  }, [d]);
  const names = Object.fromEntries(EU_ALLERGENS.map((x) => [x.code, x.pl]));

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api(`/api/admin/menu/items/${d.item.id}/allergens`, {
        method: "PUT",
        body: { allergens: a, diets: di, changeNote: note || undefined },
      });
      setNote("");
      setMsg(t.allergensSaved);
      await onSaved();
    } catch (e) {
      setError(errOf(e));
    } finally {
      setBusy(false);
    }
  }

  const row = (
    key: string,
    label: string,
    status: string,
    options: Record<string, string>,
    src: {
      sourceNote: string | null;
      confirmedAt: number | null;
      confirmedByName: string | null;
    },
    onChange: (v: string) => void,
  ) => (
    <div key={key} className="allergen-row" data-status={status}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {d.canEdit ? (
        <select
          aria-label={label}
          value={status}
          onChange={(e) => onChange(e.target.value)}
        >
          {Object.entries(options).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      ) : (
        <span>{options[status]}</span>
      )}
      <span className="muted" style={{ fontSize: 12 }}>
        {src.sourceNote ? t.source(src.sourceNote) + " · " : ""}
        {src.confirmedAt
          ? t.changedBy(
              src.confirmedByName ?? "—",
              formatDateTime(src.confirmedAt),
            )
          : t.fromImport}
      </span>
    </div>
  );

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
      aria-label={t.allergens}
    >
      <h3 className="label" style={{ margin: 0 }}>
        {t.allergens}
      </h3>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        {t.allergensIntro} {t.allergenChangeHint}
      </p>
      <div className="allergen-grid">
        {d.allergens.map((x) =>
          row(
            x.allergenId,
            names[x.allergenId] ?? x.allergenId,
            a[x.allergenId] ?? x.status,
            t.allergenStatus,
            x,
            (v) => setA({ ...a, [x.allergenId]: v }),
          ),
        )}
      </div>
      <h3 className="label" style={{ margin: "8px 0 0" }}>
        {t.diets}
      </h3>
      <div className="allergen-grid">
        {d.diets.map((x) =>
          row(
            x.diet,
            t.dietNames[x.diet] ?? x.diet,
            di[x.diet] ?? x.status,
            t.dietStatus,
            x,
            (v) => setDi({ ...di, [x.diet]: v }),
          ),
        )}
      </div>
      {d.canEdit && (
        <>
          <div className="field">
            <label htmlFor="anote">{t.allergensNote}</label>
            <input
              id="anote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
            />
          </div>
          <ErrorBox message={error} />
          {msg && (
            <div className="notice" role="status">
              {msg}
            </div>
          )}
          <div className="btn-row">
            <Btn kind="primary" disabled={busy} onClick={() => void save()}>
              {t.allergensSave}
            </Btn>
          </div>
        </>
      )}
    </section>
  );
}

function LevelDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (level: string, note: string) => Promise<string | null>;
}) {
  const [level, setLevel] = useState("clarification");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={t.save} onClose={onClose}>
      <fieldset
        style={{
          border: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <legend style={{ fontWeight: 600, marginBottom: 10 }}>
          {pl.admin.content.levelQuestion}
        </legend>
        {(["cosmetic", "clarification", "significant"] as const).map((l) => (
          <label
            key={l}
            className="check"
            style={{
              padding: 10,
              border: `1px solid ${level === l ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 12,
            }}
          >
            <input
              type="radio"
              name="mlevel"
              value={l}
              checked={level === l}
              onChange={() => setLevel(l)}
            />
            <span>
              <strong>{levels[l]!.label}</strong>
              <br />
              <span className="muted" style={{ fontSize: 13 }}>
                {levels[l]!.hint}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="mnote">{pl.admin.content.changeNote}</label>
        <textarea
          id="mnote"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
        />
      </div>
      <ErrorBox message={error} />
      <div className="btn-row">
        <Btn
          kind="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(await onSave(level, note.trim()));
            setBusy(false);
          }}
        >
          {t.save}
        </Btn>
        <Btn onClick={onClose}>{pl.admin.cancel}</Btn>
      </div>
    </Modal>
  );
}

function VersionDialog({
  itemId,
  versionId,
  onClose,
}: {
  itemId: string;
  versionId: string;
  onClose: () => void;
}) {
  const [v, setV] = useState<{
    versionNo: number;
    snapshot: {
      texts: Record<string, string | null>;
      ingredients: string[];
      allergens: Record<string, string>;
      diets: Record<string, string>;
    };
  } | null>(null);
  useEffect(() => {
    void api<{ version: NonNullable<typeof v> }>(
      `/api/admin/menu/items/${itemId}/versions/${versionId}`,
    ).then((r) => setV(r.version));
  }, [itemId, versionId]);
  const names = Object.fromEntries(EU_ALLERGENS.map((x) => [x.code, x.pl]));
  return (
    <Modal
      title={v ? t.versionTitle(v.versionNo) : pl.app.loading}
      onClose={onClose}
    >
      {v && (
        <dl
          style={{
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {MENU_TEXT_FIELD_NAMES.filter((f) => v.snapshot.texts[f]).map((f) => (
            <div key={f}>
              <dt className="muted" style={{ fontSize: 12 }}>
                {t.fields[f]}
              </dt>
              <dd
                style={{
                  margin: "2px 0 0",
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                }}
              >
                {v.snapshot.texts[f]}
              </dd>
            </div>
          ))}
          {v.snapshot.ingredients.length > 0 && (
            <div>
              <dt className="muted" style={{ fontSize: 12 }}>
                {t.fields.ingredients}
              </dt>
              <dd style={{ margin: "2px 0 0", fontSize: 14 }}>
                {v.snapshot.ingredients.join(", ")}
              </dd>
            </div>
          )}
          <div>
            <dt className="muted" style={{ fontSize: 12 }}>
              {t.allergens}
            </dt>
            <dd style={{ margin: "2px 0 0", fontSize: 14 }}>
              {Object.entries(v.snapshot.allergens)
                .map(
                  ([k, s]) => `${names[k] ?? k}: ${t.allergenStatus[s] ?? s}`,
                )
                .join(" · ") || "—"}
            </dd>
          </div>
          <div>
            <dt className="muted" style={{ fontSize: 12 }}>
              {t.diets}
            </dt>
            <dd style={{ margin: "2px 0 0", fontSize: 14 }}>
              {Object.entries(v.snapshot.diets)
                .map(
                  ([k, s]) => `${t.dietNames[k] ?? k}: ${t.dietStatus[s] ?? s}`,
                )
                .join(" · ") || "—"}
            </dd>
          </div>
        </dl>
      )}
    </Modal>
  );
}

/* ───────── Dialogs ───────── */

function AddCategory({
  section,
  onClose,
  onDone,
}: {
  section: MenuSection;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { locationId } = usePanel();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title={`${t.addCategory} · ${t.sections[section]}`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/api/admin/locations/${locationId}/menu/categories`, {
              method: "POST",
              body: { section, name },
            });
            await onDone();
          } catch (err) {
            setError(errOf(err));
          }
        }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div className="field">
          <label htmlFor="cname">{t.categoryName}</label>
          <input
            id="cname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus
          />
        </div>
        <ErrorBox message={error} />
        <div className="btn-row">
          <Btn kind="primary" type="submit" disabled={!name.trim()}>
            {t.addCategory}
          </Btn>
          <Btn onClick={onClose}>{pl.admin.cancel}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function AddItem({
  categories,
  initial,
  onClose,
  onDone,
}: {
  categories: Category[];
  initial: string;
  onClose: () => void;
  onDone: (id: string) => Promise<void>;
}) {
  const { locationId } = usePanel();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t.addItem} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const res = await api<{ id: string }>(
              `/api/admin/locations/${locationId}/menu/items`,
              { method: "POST", body: { categoryId, nameGuest: name } },
            );
            await onDone(res.id);
          } catch (err) {
            setError(errOf(err));
          }
        }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div className="field">
          <label htmlFor="iname">{t.fields.nameGuest}</label>
          <input
            id="iname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="icat">{t.fields.category}</label>
          <select
            id="icat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <ErrorBox message={error} />
        <div className="btn-row">
          <Btn
            kind="primary"
            type="submit"
            disabled={!name.trim() || !categoryId}
          >
            {t.addItem}
          </Btn>
          <Btn onClick={onClose}>{pl.admin.cancel}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { locationId } = usePanel();
  const [bundle, setBundle] = useState<MenuBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    skipped: number;
    photos: number;
  } | null>(null);

  async function read(file: File | undefined) {
    setError(null);
    setBundle(null);
    setResult(null);
    if (!file) return;
    try {
      const b = checkBundle(JSON.parse(await file.text()));
      if (!b) throw new Error("bad");
      setBundle(b);
    } catch {
      setError(t.importBadFile);
    }
  }

  async function run() {
    if (!bundle) return;
    setError(null);
    const total = { created: 0, updated: 0, skipped: 0, photos: 0 };
    try {
      for (let i = 0; i < bundle.items.length; i += IMPORT_CHUNK) {
        setProgress([i, bundle.items.length]);
        const res = await api<{
          created: string[];
          updated?: string[];
          skipped: string[];
          photos: number;
        }>(`/api/admin/locations/${locationId}/menu/import`, {
          method: "POST",
          body: {
            format: BUNDLE_FORMAT,
            sections: bundle.sections,
            categories: bundle.categories,
            items: bundle.items.slice(i, i + IMPORT_CHUNK),
          },
        });
        total.created += res.created.length;
        total.updated += res.updated?.length ?? 0;
        total.skipped += res.skipped.length;
        total.photos += res.photos;
      }
      setProgress(null);
      setResult(total);
      await onDone();
    } catch (e) {
      setProgress(null);
      setResult(total.created || total.updated || total.skipped ? total : null);
      setError(errOf(e));
      await onDone();
    }
  }

  const count = (s: MenuSection) =>
    bundle?.items.filter((i) => i.section === s).length ?? 0;
  const photos = bundle?.items.filter((i) => i.photo).length ?? 0;

  return (
    <Modal title={t.importTitle} onClose={progress ? () => undefined : onClose}>
      <p style={{ margin: 0, lineHeight: 1.5, fontSize: 14 }}>
        {t.importIntro}
      </p>
      <label className="file-btn">
        <input
          type="file"
          accept="application/json,.json"
          disabled={Boolean(progress)}
          onChange={(e) => void read(e.target.files?.[0])}
        />
        <span>{t.importChoose}</span>
      </label>
      {bundle && (
        <>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {t.importSummary(count("kitchen"), count("bar"), photos)}
          </p>
          {bundle.issues && bundle.issues.length > 0 && (
            <Disclosure
              className="small-disc"
              summary={`${t.importIssues} (${bundle.issues.length})`}
            >
              <ul
                style={{
                  margin: "8px 0 0",
                  paddingLeft: 18,
                  fontSize: 13,
                  lineHeight: 1.5,
                  maxHeight: 220,
                  overflow: "auto",
                }}
              >
                {bundle.issues.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Disclosure>
          )}
        </>
      )}
      {progress && (
        <p className="muted" role="status">
          {t.importProgress(progress[0], progress[1])}
        </p>
      )}
      {result && (
        <div className="notice" role="status">
          {t.importResult(
            result.created,
            result.updated,
            result.skipped,
            result.photos,
          )}{" "}
          {t.importAfter}
        </div>
      )}
      <ErrorBox message={error} />
      <div className="btn-row">
        {!result && (
          <Btn
            kind="primary"
            disabled={!bundle || Boolean(progress)}
            onClick={() => void run()}
          >
            {t.importStart}
          </Btn>
        )}
        <Btn onClick={onClose} disabled={Boolean(progress)}>
          {pl.admin.card.close}
        </Btn>
      </div>
    </Modal>
  );
}
