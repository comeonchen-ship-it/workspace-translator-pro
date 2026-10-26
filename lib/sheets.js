/**
 * Google Sheets translation branch.
 */
import { translateTexts, logDebug } from '../translate.js';
import { googleApiFetch } from './google-api.js';
import { checkCancelledGlobal } from './task-state.js';
import { isTranslatable } from './text-extract.js';
import { planColumnFit } from './overflow.js';

/**
 * Workflow to translate a duplicated Google Spreadsheet while preserving style and formulas
 */
export async function translateSpreadsheet(copyId, targetLang, config, token, sendProgress) {
  const presentationId = config.presentationId;
  await checkCancelledGlobal(presentationId);
  await logDebug('Fetching spreadsheet details with grid data...', presentationId);
  
  const fields = 'sheets(properties(title,sheetId,gridProperties),merges,data(columnMetadata(pixelSize),rowData(values(userEnteredValue,effectiveFormat(wrapStrategy),textFormatRuns,formattedValue,hyperlink,dataValidation))))';
  const getSpreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${copyId}?includeGridData=true&fields=${encodeURIComponent(fields)}`;
  
  const response = await googleApiFetch(getSpreadsheetUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Sheets get API error (${response.status}): ${errText}`);
  }
  const spreadsheet = await response.json();
  const allSheets = spreadsheet.sheets || [];
  // "Only the sheet tab I'm on". Match the tab by gid first, then by its name:
  // copying an .xlsx converts it and re-numbers every sheet, so the gid from the
  // original's URL no longer exists in the copy, but the tab names survive.
  // No gid and no name means the first tab. Never silently translate everything.
  let sheets = allSheets;
  const scope = config.scope || {};
  if (scope.currentSheetOnly || scope.sheetGid != null) {
    const { sheetGid: gid, sheetTitle: title } = scope;
    if (gid == null && !title) {
      sheets = allSheets.slice(0, 1);
    } else {
      // Name first: a converted .xlsx copy renumbers gids, and a new gid could
      // collide with the original one and silently pick the wrong tab.
      sheets = title ? allSheets.filter((sh) => sh.properties.title === title) : [];
      if (sheets.length === 0) sheets = allSheets.filter((sh) => sh.properties.sheetId === gid);
      if (sheets.length === 0) throw new Error(`Sheet tab not found (gid ${gid}, "${title || ''}").`);
    }
  }
  await logDebug(`Spreadsheet fetched. Total sheets: ${allSheets.length}, translating: ${sheets.length}`, presentationId);

  // 1. Extract translatable strings from cells (including hyperlinked labels in formulas and cell-level rich text)
  const uniqueTexts = new Set();
  const hyperlinkRegex = /^=HYPERLINK\(\s*(["'])(.*?)\1\s*,\s*(["'])(.*?)\3\s*\)$/i;

  for (const sheet of sheets) {
    const title = sheet.properties.title;
    if (isTranslatable(title.trim())) {
      uniqueTexts.add(title.trim());
    }
    
    const dataList = sheet.data || [];
    for (const gridData of dataList) {
      const rowData = gridData.rowData || [];
      for (const row of rowData) {
        const values = row.values || [];
        for (const cell of values) {
          for (const v of listValidationValues(cell)) {
            if (isTranslatable(v)) uniqueTexts.add(v);
          }
          const cellVal = cell.userEnteredValue;
          if (cellVal) {
            if (cellVal.stringValue) {
              const trimmed = cellVal.stringValue.trim();
              if (trimmed && isTranslatable(trimmed)) {
                uniqueTexts.add(trimmed);
              }
            } else if (cellVal.formulaValue) {
              const trimmed = cellVal.formulaValue.trim();
              if (trimmed && trimmed.startsWith('=')) {
                const match = trimmed.match(hyperlinkRegex);
                if (match) {
                  const label = match[4];
                  if (label && isTranslatable(label)) {
                    uniqueTexts.add(label.trim());
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const uniqueTextsArray = Array.from(uniqueTexts);
  await logDebug(`Extracted ${uniqueTextsArray.length} unique translatable spreadsheet texts (including titles).`, presentationId);

  await checkCancelledGlobal(presentationId);

  const editUrl = `https://docs.google.com/spreadsheets/d/${copyId}/edit`;
  if (uniqueTextsArray.length === 0) {
    await logDebug('No translatable cell texts found. Opening copy...', presentationId);
    return editUrl;
  }

  // 2. Translate via LLM API
  sendProgress('translate', 60, { key: 'progress.translatingCount', params: { count: uniqueTextsArray.length, engine: config.translationEngine.toUpperCase() } });
  const translationsMap = await translateTexts(uniqueTextsArray, targetLang, config);

  await checkCancelledGlobal(presentationId);

  // 3. Compile cell value updates with preserved formatting/links
  sendProgress('write', 80, { key: 'progress.preparingCells' });
  const updateRequests = [];
  const translatedCellsBySheet = new Map(); // sheetId → [{row, col, text}] for column fitting

  for (const sheet of sheets) {
    const sheetId = sheet.properties.sheetId;
    const dataList = sheet.data || [];
    
    for (const gridData of dataList) {
      const rowData = gridData.rowData || [];
      for (let r = 0; r < rowData.length; r++) {
        const row = rowData[r];
        const values = row.values || [];
        for (let c = 0; c < values.length; c++) {
          const cell = values[c];
          const cellVal = cell.userEnteredValue || {};

          let hasChanges = false;
          let newCellData = {};
          // A dropdown's allowed values must be translated the same way as the cell,
          // or Sheets flags the translated value as invalid.
          const translatedRule = translateListValidation(cell.dataValidation, translationsMap);
          if (translatedRule) {
            newCellData.dataValidation = translatedRule;
            hasChanges = true;
          }

          if (cellVal.stringValue) {
            const trimmed = cellVal.stringValue.trim();
            if (trimmed) {
              const translated = translationsMap.get(trimmed);
              if (translated && translated !== trimmed) {
                newCellData.userEnteredValue = { stringValue: translated };
                hasChanges = true;
                if (!translatedCellsBySheet.has(sheetId)) translatedCellsBySheet.set(sheetId, []);
                const right = values[c + 1];
                translatedCellsBySheet.get(sheetId).push({
                  row: r, col: c, text: translated, original: cellVal.stringValue,
                  wrap: cell.effectiveFormat?.wrapStrategy,
                  rightEmpty: !right || !right.userEnteredValue,
                  inMerge: (sheet.merges || []).some((m) => r >= m.startRowIndex && r < m.endRowIndex && c >= m.startColumnIndex && c < m.endColumnIndex),
                });
                
                // Adjust textFormatRuns to match the new translated text length
                if (cell.textFormatRuns && cell.textFormatRuns.length > 0) {
                  const originalTextLength = cellVal.stringValue.length;
                  const newTextLength = translated.length;
                  
                  newCellData.textFormatRuns = cell.textFormatRuns
                    .map(run => {
                      const newRun = { ...run };
                      if (run.startIndex > 0 && originalTextLength > 0) {
                        newRun.startIndex = Math.min(
                          newTextLength,
                          Math.round((run.startIndex / originalTextLength) * newTextLength)
                        );
                      } else {
                        newRun.startIndex = 0;
                      }
                      return newRun;
                    })
                    .filter(run => run.startIndex < newTextLength);
                  
                  if (newCellData.textFormatRuns.length === 0) {
                    delete newCellData.textFormatRuns;
                  }
                } else if (cell.hyperlink) {
                  // Fallback: If cell has a cell-level hyperlink, preserve it as a format run
                  newCellData.textFormatRuns = [
                    {
                      startIndex: 0,
                      format: {
                        link: {
                          uri: cell.hyperlink
                        }
                      }
                    }
                  ];
                }
              }
            }
          } else if (cellVal.formulaValue) {
            const trimmed = cellVal.formulaValue.trim();
            if (trimmed && trimmed.startsWith('=')) {
              const match = trimmed.match(hyperlinkRegex);
              if (match) {
                const quoteUrl = match[1];
                const url = match[2];
                const quoteLabel = match[3];
                const label = match[4];
                const translatedLabel = translationsMap.get(label.trim()) || label;
                if (translatedLabel !== label) {
                  newCellData.userEnteredValue = {
                    formulaValue: `=HYPERLINK(${quoteUrl}${url}${quoteUrl}, ${quoteLabel}${translatedLabel}${quoteLabel})`
                  };
                  hasChanges = true;
                }
              }
            }
          }
          
          if (hasChanges) {
            updateRequests.push({
              updateCells: {
                rows: [
                  {
                    values: [newCellData]
                  }
                ],
                fields: ['userEnteredValue', 'textFormatRuns', 'dataValidation'].filter((f) => newCellData[f]).join(','),
                range: {
                  sheetId: sheetId,
                  startRowIndex: r,
                  endRowIndex: r + 1,
                  startColumnIndex: c,
                  endColumnIndex: c + 1
                }
              }
            });
          }
        }
      }
    }
  }

  // 4. Renaming sheet tabs & auto-resizing columns
  sendProgress('write', 90, { key: 'progress.applyingTabs' });
  const sheetsRequests = [];
  let columnsWidened = 0;
  let cellsWrapped = 0;
  const { fitTextToBoxes: fitText = true } = await chrome.storage.local.get('fitTextToBoxes');
  for (const sheet of sheets) {
    const oldTitle = sheet.properties.title;
    const translatedTitle = translationsMap.get(oldTitle.trim());
    if (translatedTitle && translatedTitle !== oldTitle) {
      sheetsRequests.push({
        updateSheetProperties: {
          properties: {
            sheetId: sheet.properties.sheetId,
            title: translatedTitle
          },
          fields: 'title'
        }
      });
    }
    
    // Widen (capped) only the columns that received translations, and wrap
    // what still doesn't fit — see lib/overflow.js planColumnFit().
    if (!fitText) continue;
    const widths = (sheet.data?.[0]?.columnMetadata || []).map((m) => m.pixelSize);
    const fit = planColumnFit(sheet.properties.sheetId, widths, translatedCellsBySheet.get(sheet.properties.sheetId) || []);
    sheetsRequests.push(...fit.requests);
    columnsWidened += fit.widened;
    cellsWrapped += fit.wrapped;
  }

  const allRequests = [...updateRequests, ...sheetsRequests];

  if (allRequests.length > 0) {
    await logDebug(`Applying ${allRequests.length} spreadsheet batch update requests...`, presentationId);
    const updateSpreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${copyId}:batchUpdate`;
    const res = await googleApiFetch(updateSpreadsheetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requests: allRequests })
    });
    if (!res.ok) {
      const errText = await res.text();
      await logDebug(`Error applying spreadsheet updates: ${errText}`, presentationId);
      throw new Error(`Sheets batchUpdate API error (${res.status}): ${errText}`);
    }
    await logDebug(`Spreadsheet batch updates completed successfully (${columnsWidened} columns widened, ${cellsWrapped} cells wrapped).`, presentationId);
  } else {
    await logDebug('No spreadsheet updates needed.', presentationId);
  }

  config.columnsFitted = columnsWidened + cellsWrapped;
  return editUrl;
}

const LIST_TYPES = new Set(['ONE_OF_LIST']);

/** Trimmed string values of a cell's dropdown list (empty for other rules). */
export function listValidationValues(cell) {
  const cond = cell?.dataValidation?.condition;
  if (!cond || !LIST_TYPES.has(cond.type)) return [];
  return (cond.values || []).map((v) => (v.userEnteredValue || '').trim()).filter(Boolean);
}

/** The rule with every translated list value replaced, or null when nothing changed. */
export function translateListValidation(rule, translationsMap) {
  const cond = rule?.condition;
  if (!cond || !LIST_TYPES.has(cond.type)) return null;
  let changed = false;
  const values = (cond.values || []).map((v) => {
    const src = (v.userEnteredValue || '').trim();
    const dst = src && translationsMap.get(src);
    if (dst && dst !== src) { changed = true; return { ...v, userEnteredValue: dst }; }
    return v;
  });
  return changed ? { ...rule, condition: { ...cond, values } } : null;
}
