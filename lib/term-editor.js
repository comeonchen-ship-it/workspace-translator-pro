/**
 * Sentence-style term editor for non-technical users. Each row reads
 * "[term] [translate as ▾ | keep original] [translation]  ✕"; choosing
 * "keep original" hides the translation box. Rows are plain objects
 * {src, mode: 'translate'|'keep', dst} — see lib/prefs.js rowsToGlossary().
 */
export function createTermEditor(container, { t, onChange }) {
  let rows = [];

  function emit() {
    onChange?.(getRows());
  }

  function getRows() {
    return rows.map((r) => ({ ...r }));
  }

  function rowElement(row) {
    const el = document.createElement('div');
    el.className = 'term-row';

    const src = document.createElement('input');
    src.type = 'text';
    src.className = 'term-src';
    src.value = row.src;
    src.placeholder = t('prefs.terms.srcPlaceholder');
    src.addEventListener('input', () => { row.src = src.value; emit(); });

    const mode = document.createElement('select');
    mode.className = 'term-mode';
    for (const value of ['translate', 'keep']) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = t(`prefs.terms.mode.${value}`);
      mode.appendChild(opt);
    }
    mode.value = row.mode;

    const dst = document.createElement('input');
    dst.type = 'text';
    dst.className = 'term-dst';
    dst.value = row.dst;
    dst.placeholder = t('prefs.terms.dstPlaceholder');
    dst.hidden = row.mode === 'keep';
    dst.addEventListener('input', () => { row.dst = dst.value; emit(); });

    mode.addEventListener('change', () => {
      row.mode = mode.value;
      dst.hidden = row.mode === 'keep';
      emit();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'term-del';
    del.textContent = '✕';
    del.title = t('prefs.terms.remove');
    del.addEventListener('click', () => {
      rows = rows.filter((r) => r !== row);
      render();
      emit();
    });

    el.append(src, mode, dst, del);
    return el;
  }

  function render() {
    container.innerHTML = '';
    for (const row of rows) container.appendChild(rowElement(row));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'term-add';
    add.textContent = t('prefs.terms.add');
    add.addEventListener('click', () => {
      rows.push({ src: '', mode: 'translate', dst: '' });
      render();
      container.querySelectorAll('.term-src')[rows.length - 1]?.focus();
    });
    container.appendChild(add);
  }

  return {
    setRows(next) {
      rows = (next || []).map((r) => ({ src: r.src || '', mode: r.mode === 'keep' ? 'keep' : 'translate', dst: r.dst || '' }));
      // Start with one empty row so the shape of a rule is visible immediately.
      if (rows.length === 0) rows.push({ src: '', mode: 'translate', dst: '' });
      render();
    },
    getRows,
    rerender: render, // after a UI-language switch
  };
}
