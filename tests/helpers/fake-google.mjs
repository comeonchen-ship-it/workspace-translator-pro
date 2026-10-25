// Fake Google Workspace + Gemini HTTP APIs behind globalThis.fetch.
// Each test configures documents; every request is recorded.

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function installFakeFetch() {
  const state = {
    requests: [],
    files: {},              // copyId → resource JSON (presentation / document / spreadsheet / form)
    batchUpdates: [],       // { api, id, requests }
    copies: 0,
    validTokens: new Set(['tok-1']),
    llm: { calls: [], translate: (t) => `TR(${t})`, override: null },
    failNext: {},           // url substring → status (one-shot)
  };

  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    const headers = opts.headers || {};
    state.requests.push({ url, method, body, headers });

    for (const [frag, status] of Object.entries(state.failNext)) {
      if (url.includes(frag)) { delete state.failNext[frag]; return json({ error: { message: 'injected' } }, status); }
    }

    // ── Gemini ──
    if (url.includes('generativelanguage.googleapis.com')) {
      if (!headers['x-goog-api-key']) return json({ error: { message: 'no key' } }, 401);
      const prompt = body.contents[0].parts[0].text;
      const texts = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).texts;
      const system = body.systemInstruction.parts[0].text;
      state.llm.calls.push({ texts, system, model: url.match(/models\/([^:]+)/)[1] });
      const out = state.llm.override ? state.llm.override(texts, system) : texts.map(state.llm.translate);
      if (out instanceof Response) return out;
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations: out }) }] } }] });
    }

    // ── Google APIs need a valid bearer token ──
    const token = (headers.Authorization || '').replace('Bearer ', '');
    if (url.includes('googleapis.com') && !state.validTokens.has(token)) {
      return json({ error: { code: 401, message: 'Request had invalid authentication credentials.' } }, 401);
    }

    // Drive
    let m;
    if ((m = url.match(/drive\/v3\/files\/([^/?]+)\?fields=parents/))) return json({ parents: ['root'] });
    if ((m = url.match(/drive\/v3\/files\/([^/?]+)\/copy/))) {
      const copyId = `copy${++state.copies}`;
      state.files[copyId] = structuredClone(state.files[m[1]]);
      return json({ id: copyId, name: body.name });
    }
    if ((m = url.match(/drive\/v3\/files\/([^/?]+)$/)) && method === 'DELETE') {
      delete state.files[m[1]];
      return new Response(null, { status: 204 });
    }
    if ((m = url.match(/drive\/v3\/files\/([^/?]+)\?fields=id,trashed/))) return json({ id: m[1], trashed: false });

    // Slides / Docs / Sheets / Forms: GET returns the copy, batchUpdate applies text replacements
    const api = [['slides', /presentations\/([^/:?]+)/], ['docs', /documents\/([^/:?]+)/],
      ['sheets', /spreadsheets\/([^/:?]+)/], ['forms', /forms\/([^/:?]+)/]];
    for (const [name, re] of api) {
      if (!url.includes(`${name}.googleapis.com`) && !(name === 'docs' && url.includes('docs.googleapis.com'))) continue;
      m = url.match(re);
      if (!m) continue;
      const id = m[1];
      if (url.includes(':batchUpdate')) {
        state.batchUpdates.push({ api: name, id, requests: body.requests });
        if (name === 'slides') applySlidesReplace(state.files[id], body.requests);
        return json({ replies: [] });
      }
      if (!state.files[id]) return json({ error: { message: 'not found' } }, 404);
      return json(state.files[id]);
    }
    return json({ error: { message: `unmocked ${method} ${url}` } }, 500);
  };
  return state;
}

// Minimal replaceAllText so a re-fetch after writing sees translated text (for font fitting).
function applySlidesReplace(pres, requests) {
  if (!pres) return;
  for (const r of requests) {
    const rep = r.replaceAllText;
    if (!rep) continue;
    for (const slide of pres.slides) {
      if (rep.pageObjectIds && !rep.pageObjectIds.includes(slide.objectId)) continue;
      for (const el of slide.pageElements || []) {
        for (const te of el.shape?.text?.textElements || []) {
          if (te.textRun?.content?.includes(rep.containsText.text)) {
            te.textRun.content = te.textRun.content.split(rep.containsText.text).join(rep.replaceText);
          }
        }
        // recompute indices
        let i = 0;
        for (const te of el.shape?.text?.textElements || []) {
          const len = te.textRun?.content?.length || 0;
          te.startIndex = i; te.endIndex = i + len; i += len;
        }
      }
    }
  }
}

export function slide(id, shapes) {
  return {
    objectId: id,
    pageElements: shapes.map(([objectId, text, size]) => ({
      objectId,
      shape: { text: { textElements: [{ startIndex: 0, endIndex: text.length, textRun: { content: text, style: size ? { fontSize: { magnitude: size, unit: 'PT' } } : {} } }] } },
    })),
  };
}
