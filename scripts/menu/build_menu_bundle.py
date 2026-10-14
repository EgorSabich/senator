#!/usr/bin/env python3
"""
Builds the menu import bundle (JSON) for Senator Academy from the two source workbooks:

  --kitchen  "Menu Kuchnia szkolenie i sprzedaz" exported as .xlsx (sheets "Karty dań" + "Alergeny")
  --bar      "Kelnerzy Bar.xlsx" (one sheet: Rozdział, Nazwa "CHOICE OR", Nazwa "GO POS", Foto, Skład, Opis, Sposób podania)

Output: one JSON file that the owner uploads in the panel (Menu → Import z pliku).
The bundle contains restaurant data and photos: never commit it to the repository.

Rules (decisions D1, D10, D11):
  * texts are copied as they are — nothing is rewritten or invented;
  * allergen matrix: "X" → contains, "?" → unconfirmed, empty → not_contains; every value arrives
    unconfirmed and becomes visible to waiters only after a manager with allergens.confirm confirms it;
  * diets: "tak" → yes, "nie" → no, "tak*" / "?" → unconfirmed (original kept in source note);
  * bar photos are taken from the pictures anchored in the "Foto" column, resized to max 1600 px.

Usage:
  python3 -I scripts/menu/build_menu_bundle.py --kitchen kuchnia.xlsx --bar bar.xlsx --out menu-bundle.json [--report report.md]
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
import unicodedata
import zipfile
from datetime import datetime, timezone

import openpyxl

try:
    from PIL import Image
except ImportError:  # photos are then passed through unchanged
    Image = None

ALLERGEN_COLUMNS = {
    'Gluten': 'gluten', 'Skorupiaki': 'crustaceans', 'Jaja': 'eggs', 'Ryby': 'fish',
    'Orzeszki ziemne': 'peanuts', 'Soja': 'soy', 'Mleko': 'milk', 'Orzechy': 'nuts',
    'Seler': 'celery', 'Gorczyca': 'mustard', 'Sezam': 'sesame', 'Siarczyny': 'sulphites',
    'Łubin': 'lupin', 'Mięczaki': 'molluscs',
}
DIET_COLUMNS = {'Wege': 'vegetarian', 'Wegańskie': 'vegan', 'Bez glutenu': 'gluten_free', 'Bez nabiału': 'dairy_free'}
DIET_WORDS = {'wegetarianie': 'vegetarian', 'weganie': 'vegan', 'bez glutenu': 'gluten_free', 'bez nabiału': 'dairy_free'}
CARD_FIELDS = {
    'Jak sprzedać': 'howToSell', 'Warto wiedzieć': 'goodToKnow', 'Sprzedaż dodatkowa': 'upsell',
    'Pytania gości': 'guestQuestions', 'Kluczowy składnik': 'keyIngredient', 'Uprzedź gościa': 'warnGuest',
}


def fold(s: str) -> str:
    s = s.replace('ł', 'l').replace('Ł', 'L')
    s = unicodedata.normalize('NFD', s)
    s = ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')
    return re.sub(r'\s+', ' ', s).strip().lower()


def clean(v) -> str | None:
    if v is None:
        return None
    s = str(v).replace('\r\n', '\n').strip()
    s = re.sub(r'[ \t]+\n', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s or None


def one_line(v) -> str | None:
    s = clean(v)
    return re.sub(r'\s+', ' ', s) if s else None


# ───────────────────────── kitchen ─────────────────────────

def parse_kitchen(path: str, issues: list[str]):
    wb = openpyxl.load_workbook(path, data_only=True)
    cards = wb['Karty dań']
    categories: list[str] = []
    items: list[dict] = []
    current_cat = None
    current = None
    for a, b in cards.iter_rows(min_row=2, values_only=True):
        a = clean(a)
        if a is None:
            continue
        if b is None:
            m = re.match(r'^(\d+)\.\s+(.+)$', a)
            if m:
                current = {'no': int(m.group(1)), 'nameGuest': one_line(m.group(2)), 'category': current_cat, 'fields': {}}
                items.append(current)
            else:
                current_cat = one_line(a)
                categories.append(current_cat)
                current = None
            continue
        if current is None:
            issues.append(f'Kuchnia: pole „{a}” poza kartą dania — pominięte.')
            continue
        current['fields'][a] = clean(b)

    matrix = wb['Alergeny']
    header = None
    rows = {}
    note = None
    for r in matrix.iter_rows(values_only=True):
        if header is None:
            if r and r[0] == 'Nr':
                header = [clean(x) for x in r]
            continue
        if isinstance(r[0], (int, float)) and r[2]:
            rows[int(r[0])] = dict(zip(header, r))
        elif r[0] and isinstance(r[0], str) and r[0].startswith('Uwaga'):
            note = clean(r[0])

    out = []
    for it in items:
        f = it['fields']
        row = rows.get(it['no'])
        name = it['nameGuest']
        if row is None:
            issues.append(f'Kuchnia: „{name}” nie ma wiersza w arkuszu „Alergeny” — alergeny niepotwierdzone.')
        elif fold(clean(row['Danie']) or '') != fold(name):
            issues.append(f'Kuchnia nr {it["no"]}: nazwa w kartach „{name}” ≠ w arkuszu „Alergeny” „{clean(row["Danie"])}”.')
        if row is not None and clean(row['Kategoria']) != it['category']:
            issues.append(f'Kuchnia nr {it["no"]}: kategoria w kartach „{it["category"]}” ≠ w arkuszu „Alergeny” „{clean(row["Kategoria"])}”.')

        allergens = {}
        diets = {}
        if row is not None:
            for col, code in ALLERGEN_COLUMNS.items():
                v = clean(row.get(col))
                if v is None:
                    allergens[code] = {'status': 'not_contains', 'source': None}
                elif v.upper() == 'X':
                    allergens[code] = {'status': 'contains', 'source': 'X'}
                elif v == '?':
                    allergens[code] = {'status': 'unconfirmed', 'source': '?'}
                else:
                    allergens[code] = {'status': 'unconfirmed', 'source': v}
                    issues.append(f'Kuchnia „{name}”: nieznana wartość alergenu {col} = „{v}”.')
            for col, diet in DIET_COLUMNS.items():
                v = clean(row.get(col))
                if v == 'tak':
                    diets[diet] = {'status': 'yes', 'source': 'tak'}
                elif v == 'nie':
                    diets[diet] = {'status': 'no', 'source': 'nie'}
                else:
                    diets[diet] = {'status': 'unconfirmed', 'source': v}

        # "Dla kogo": first line repeats the diet matrix, further lines are notes.
        diet_note = None
        dla = f.get('Dla kogo')
        if dla:
            lines = dla.split('\n')
            stated = dict(
                (DIET_WORDS.get(k.strip().lower()), v.strip())
                for k, v in (p.split(':', 1) for p in lines[0].split(',') if ':' in p)
            )
            for diet, v in stated.items():
                if diet and diets.get(diet) and diets[diet]['source'] != v:
                    issues.append(
                        f'Kuchnia „{name}”: „Dla kogo” podaje {diet_label(diet)} = „{v}”, arkusz „Alergeny” = „{diets[diet]["source"]}”.'
                    )
            diet_note = clean('\n'.join(lines[1:]))

        alcohol = clean(f.get('Alkohol'))
        if alcohol in ('-', '–', '—'):
            alcohol = None
        if row is not None:
            matrix_alc = clean(row.get('Alkohol'))
            matrix_alc = None if matrix_alc in ('-', '–', '—') else matrix_alc
            if (matrix_alc or '') != (alcohol or ''):
                issues.append(f'Kuchnia „{name}”: alkohol w karcie „{alcohol or "-"}” ≠ w arkuszu „Alergeny” „{matrix_alc or "-"}”.')

        entry = {
            'importKey': 'kitchen:' + fold(name),
            'section': 'kitchen',
            'category': it['category'],
            'sortOrder': it['no'],
            'nameGuest': name,
            'namePos': None,
            'dietNote': diet_note,
            'alcoholNote': alcohol,
            'allergens': allergens,
            'diets': diets,
        }
        for label, key in CARD_FIELDS.items():
            entry[key] = f.get(label)
        unknown = set(f) - set(CARD_FIELDS) - {'Dla kogo', 'Alkohol'}
        for u in sorted(unknown):
            issues.append(f'Kuchnia „{name}”: nieznane pole „{u}” — pominięte.')
        for key in ('guestQuestions', 'goodToKnow', 'warnGuest', 'howToSell'):
            v = entry.get(key) or ''
            if 'do potwierdzenia' in v.lower():
                issues.append(f'Kuchnia „{name}”: w polu „{label_of(key)}” jest „do potwierdzenia”.')
        out.append(entry)

    if len(rows) != len(items):
        issues.append(f'Kuchnia: {len(items)} kart dań, {len(rows)} wierszy w arkuszu „Alergeny”.')
    return categories, out, note


def diet_label(d: str) -> str:
    return {'vegetarian': 'wegetarianie', 'vegan': 'weganie', 'gluten_free': 'bez glutenu', 'dairy_free': 'bez nabiału'}[d]


def label_of(key: str) -> str:
    return {v: k for k, v in CARD_FIELDS.items()}.get(key, key)


# ───────────────────────── bar ─────────────────────────

def bar_images(path: str) -> dict[int, bytes]:
    """Excel row number (1-based) → image bytes, for pictures anchored in the sheet."""
    z = zipfile.ZipFile(path)
    names = z.namelist()
    drawings = [n for n in names if re.match(r'xl/drawings/drawing\d+\.xml$', n)]
    out: dict[int, bytes] = {}
    for d in drawings:
        rels_name = d.replace('drawings/', 'drawings/_rels/') + '.rels'
        rels = {}
        if rels_name in names:
            for m in re.finditer(r'<Relationship\b[^>]*>', z.read(rels_name).decode()):
                tag = m.group(0)
                rid = re.search(r'Id="([^"]+)"', tag)
                tgt = re.search(r'Target="([^"]+)"', tag)
                if rid and tgt:
                    rels[rid.group(1)] = 'xl/' + tgt.group(1).replace('../', '')
        xml = z.read(d).decode()
        for blk in re.findall(r'<xdr:(?:oneCellAnchor|twoCellAnchor)[\s\S]*?</xdr:(?:oneCellAnchor|twoCellAnchor)>', xml):
            fr = re.search(r'<xdr:from>.*?<xdr:row>(\d+)</xdr:row>', blk, re.S)
            emb = re.search(r'r:embed="([^"]+)"', blk)
            if fr and emb and emb.group(1) in rels:
                out[int(fr.group(1)) + 1] = z.read(rels[emb.group(1)])
    return out


def shrink(data: bytes) -> tuple[str, bytes]:
    if Image is None:
        return 'image/jpeg', data
    im = Image.open(io.BytesIO(data))
    im = im.convert('RGB')
    im.thumbnail((1600, 1600))
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=82, optimize=True, progressive=True)
    return 'image/jpeg', buf.getvalue()


def parse_bar(path: str, issues: list[str]):
    ws = openpyxl.load_workbook(path, data_only=True).active
    head = [clean(x) for x in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
    expected = ['Rozdział', 'Nazwa "CHOICE OR"', 'Nazwa "GO POS"', 'Foto', 'Skład', 'Opis', 'Sposób podania']
    if head[: len(expected)] != expected:
        raise SystemExit(f'Bar: nieoczekiwane kolumny {head}')
    images = bar_images(path)
    categories: list[str] = []
    items = []
    for rown, r in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        sec, guest, pos, _foto, sklad, opis, podanie = (list(r) + [None] * 7)[:7]
        guest = one_line(guest)
        if not guest:
            continue
        sec = one_line(sec)
        if sec not in categories:
            categories.append(sec)
        pos = one_line(pos)
        if pos and fold(pos) != fold(guest):
            issues.append(f'Bar „{guest}”: nazwa w GoPOS „{pos}” różni się od nazwy w menu gościa.')
        ingredients = []
        for line in (clean(sklad) or '').split('\n'):
            line = line.strip()
            if not line or re.match(r'^składniki\s*:?$', line, re.I):
                continue
            ingredients.append(line)
        serving = one_line(podanie)
        if not serving:
            issues.append(f'Bar „{guest}”: brak „Sposób podania”.')
        photo = None
        if rown in images:
            ctype, data = shrink(images[rown])
            photo = {'contentType': ctype, 'data': base64.b64encode(data).decode()}
        else:
            issues.append(f'Bar „{guest}”: brak zdjęcia.')
        items.append({
            'importKey': 'bar:' + fold(guest),
            'section': 'bar',
            'category': sec,
            'sortOrder': rown - 1,
            'nameGuest': guest,
            'namePos': pos,
            'ingredients': ingredients,
            'description': clean(opis),
            'serving': serving,
            'allergens': {},
            'diets': {},
            'photo': photo,
        })
    issues.append('Bar: w pliku nie ma kolumny alergenów — wszystkie alergeny napojów są niepotwierdzone (np. HORTUS: mleko sojowe w opisie).')
    return categories, items


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--kitchen', required=True)
    ap.add_argument('--bar', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--report')
    a = ap.parse_args()

    issues: list[str] = []
    k_cats, k_items, k_note = parse_kitchen(a.kitchen, issues)
    b_cats, b_items = parse_bar(a.bar, issues)
    keys = [i['importKey'] for i in k_items + b_items]
    dups = sorted({k for k in keys if keys.count(k) > 1})
    for d in dups:
        issues.append(f'Powtórzona pozycja: {d}')

    bundle = {
        'format': 'senator-menu-bundle',
        'version': 1,
        'createdAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'sources': {'kitchen': a.kitchen.split('/')[-1], 'bar': a.bar.split('/')[-1]},
        'sections': {'kitchen': {'note': k_note}, 'bar': {'note': None}},
        'categories': [{'section': 'kitchen', 'name': n, 'sortOrder': i} for i, n in enumerate(k_cats)]
        + [{'section': 'bar', 'name': n, 'sortOrder': i} for i, n in enumerate(b_cats)],
        'items': k_items + b_items,
        'issues': issues,
    }
    with open(a.out, 'w', encoding='utf-8') as fh:
        json.dump(bundle, fh, ensure_ascii=False)
    photos = sum(1 for i in b_items if i.get('photo'))
    summary = (
        f'Kuchnia: {len(k_cats)} kategorii, {len(k_items)} pozycji. '
        f'Bar: {len(b_cats)} kategorii, {len(b_items)} pozycji, {photos} zdjęć. Uwagi: {len(issues)}.'
    )
    print(summary, file=sys.stderr)
    if a.report:
        with open(a.report, 'w', encoding='utf-8') as fh:
            fh.write('# Import menu — uwagi do danych\n\n' + summary + '\n\n')
            fh.write('\n'.join(f'- {x}' for x in issues) + '\n')


if __name__ == '__main__':
    main()
