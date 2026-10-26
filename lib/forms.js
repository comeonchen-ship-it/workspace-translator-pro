/**
 * Google Forms translation branch.
 */
import { translateTexts, logDebug } from '../translate.js';
import { googleApiFetch } from './google-api.js';
import { checkCancelledGlobal } from './task-state.js';
import { isTranslatable, normalizeText } from './text-extract.js';

/**
 * Workflow to translate a duplicated Google Form
 */
export async function translateForm(copyId, targetLang, config, token, sendProgress) {
  const presentationId = config.presentationId;
  await checkCancelledGlobal(presentationId);
  await logDebug('Fetching form details...', presentationId);
  const getFormUrl = `https://forms.googleapis.com/v1/forms/${copyId}`;
  const response = await googleApiFetch(getFormUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Forms get API error (${response.status}): ${errText}`);
  }
  const form = await response.json();
  
  // 1. Extract translatable texts
  await logDebug('Extracting form questions & content...', presentationId);
  const uniqueTexts = new Set();
  
  if (form.info) {
    if (form.info.title && isTranslatable(normalizeText(form.info.title))) {
      uniqueTexts.add(normalizeText(form.info.title));
    }
    if (form.info.description && isTranslatable(normalizeText(form.info.description))) {
      uniqueTexts.add(normalizeText(form.info.description));
    }
  }

  // Optimization: Extract Form Confirmation submission settings message
  if (form.settings && form.settings.submissionSettings && form.settings.submissionSettings.confirmationMessage) {
    const confMsg = form.settings.submissionSettings.confirmationMessage.value;
    if (confMsg && isTranslatable(normalizeText(confMsg))) {
      uniqueTexts.add(normalizeText(confMsg));
    }
  }

  const items = form.items || [];
  for (const item of items) {
    if (item.title && isTranslatable(normalizeText(item.title))) {
      uniqueTexts.add(normalizeText(item.title));
    }
    if (item.description && isTranslatable(normalizeText(item.description))) {
      uniqueTexts.add(normalizeText(item.description));
    }
    
    if (item.questionItem && item.questionItem.question) {
      const q = item.questionItem.question;
      if (q.choiceQuestion && q.choiceQuestion.options) {
        for (const opt of q.choiceQuestion.options) {
          if (opt.value && isTranslatable(normalizeText(opt.value))) {
            uniqueTexts.add(normalizeText(opt.value));
          }
        }
      }
      if (q.scaleQuestion) {
        if (q.scaleQuestion.lowLabel && isTranslatable(normalizeText(q.scaleQuestion.lowLabel))) {
          uniqueTexts.add(normalizeText(q.scaleQuestion.lowLabel));
        }
        if (q.scaleQuestion.highLabel && isTranslatable(normalizeText(q.scaleQuestion.highLabel))) {
          uniqueTexts.add(normalizeText(q.scaleQuestion.highLabel));
        }
      }
    }

    if (item.questionGroupItem) {
      const qg = item.questionGroupItem;
      if (qg.questions) {
        for (const q of qg.questions) {
          if (q.rowQuestion && q.rowQuestion.title && isTranslatable(normalizeText(q.rowQuestion.title))) {
            uniqueTexts.add(normalizeText(q.rowQuestion.title));
          }
        }
      }
      if (qg.grid && qg.grid.columns && qg.grid.columns.options) {
        for (const opt of qg.grid.columns.options) {
          if (opt.value && isTranslatable(normalizeText(opt.value))) {
            uniqueTexts.add(normalizeText(opt.value));
          }
        }
      }
    }
  }

  const uniqueTextsArray = Array.from(uniqueTexts);
  await logDebug(`Extracted ${uniqueTextsArray.length} unique translatable form elements.`, presentationId);

  await checkCancelledGlobal(presentationId);

  const editUrl = `https://docs.google.com/forms/d/${copyId}/edit`;
  if (uniqueTextsArray.length === 0) {
    await logDebug('No translatable form elements found.', presentationId);
    return editUrl;
  }

  // 2. Translate via LLM API
  sendProgress('translate', 60, { key: 'progress.translatingCount', params: { count: uniqueTextsArray.length, engine: config.translationEngine.toUpperCase() } });
  const translationsMap = await translateTexts(uniqueTextsArray, targetLang, config);

  await checkCancelledGlobal(presentationId);

  // 3. Generate Form Update requests
  sendProgress('write', 80, { key: 'progress.applyingForm' });
  const requests = [];

  if (form.info) {
    const originalTitle = form.info.title || "";
    const originalDesc = form.info.description || "";
    const normTitle = normalizeText(originalTitle);
    const normDesc = normalizeText(originalDesc);
    const translatedTitle = translationsMap.get(normTitle) || originalTitle;
    const translatedDesc = translationsMap.get(normDesc) || originalDesc;
    
    if (translatedTitle !== originalTitle || translatedDesc !== originalDesc) {
      requests.push({
        updateFormInfo: {
          info: {
            title: translatedTitle,
            description: translatedDesc
          },
          updateMask: 'title,description'
        }
      });
    }
  }

  // Optimization: Update Form Confirmation submission settings message
  if (form.settings && form.settings.submissionSettings && form.settings.submissionSettings.confirmationMessage) {
    const originalMsg = form.settings.submissionSettings.confirmationMessage.value || "";
    const normMsg = normalizeText(originalMsg);
    const translatedMsg = translationsMap.get(normMsg) || originalMsg;
    if (translatedMsg !== originalMsg) {
      requests.push({
        updateSettings: {
          settings: {
            submissionSettings: {
              confirmationMessage: {
                value: translatedMsg
              }
            }
          },
          updateMask: 'submissionSettings.confirmationMessage'
        }
      });
    }
  }

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const updatedItem = JSON.parse(JSON.stringify(item));
    let itemChanged = false;

    if (updatedItem.title) {
      const norm = normalizeText(updatedItem.title);
      const trans = translationsMap.get(norm);
      if (trans && trans !== updatedItem.title) {
        updatedItem.title = trans;
        itemChanged = true;
      }
    }
    if (updatedItem.description) {
      const norm = normalizeText(updatedItem.description);
      const trans = translationsMap.get(norm);
      if (trans && trans !== updatedItem.description) {
        updatedItem.description = trans;
        itemChanged = true;
      }
    }

    if (updatedItem.questionItem && updatedItem.questionItem.question) {
      const q = updatedItem.questionItem.question;
      if (q.choiceQuestion && q.choiceQuestion.options) {
        for (let o = 0; o < q.choiceQuestion.options.length; o++) {
          const opt = q.choiceQuestion.options[o];
          if (opt.value) {
            const norm = normalizeText(opt.value);
            const trans = translationsMap.get(norm);
            if (trans && trans !== opt.value) {
              opt.value = trans;
              itemChanged = true;
            }
          }
        }
      }
      if (q.grading && q.grading.correctAnswers && q.grading.correctAnswers.answers) {
        for (let a = 0; a < q.grading.correctAnswers.answers.length; a++) {
          const ans = q.grading.correctAnswers.answers[a];
          if (ans.value) {
            const norm = normalizeText(ans.value);
            const trans = translationsMap.get(norm);
            if (trans && trans !== ans.value) {
              ans.value = trans;
              itemChanged = true;
            }
          }
        }
      }
      if (q.scaleQuestion) {
        if (q.scaleQuestion.lowLabel) {
          const norm = normalizeText(q.scaleQuestion.lowLabel);
          const trans = translationsMap.get(norm);
          if (trans && trans !== q.scaleQuestion.lowLabel) {
            q.scaleQuestion.lowLabel = trans;
            itemChanged = true;
          }
        }
        if (q.scaleQuestion.highLabel) {
          const norm = normalizeText(q.scaleQuestion.highLabel);
          const trans = translationsMap.get(norm);
          if (trans && trans !== q.scaleQuestion.highLabel) {
            q.scaleQuestion.highLabel = trans;
            itemChanged = true;
          }
        }
      }
    }

    if (updatedItem.questionGroupItem) {
      const qg = updatedItem.questionGroupItem;
      if (qg.questions) {
        for (let qi = 0; qi < qg.questions.length; qi++) {
          const q = qg.questions[qi];
          if (q.rowQuestion && q.rowQuestion.title) {
            const norm = normalizeText(q.rowQuestion.title);
            const trans = translationsMap.get(norm);
            if (trans && trans !== q.rowQuestion.title) {
              q.rowQuestion.title = trans;
              itemChanged = true;
            }
          }
          if (q.grading && q.grading.correctAnswers && q.grading.correctAnswers.answers) {
            for (let a = 0; a < q.grading.correctAnswers.answers.length; a++) {
              const ans = q.grading.correctAnswers.answers[a];
              if (ans.value) {
                const norm = normalizeText(ans.value);
                const trans = translationsMap.get(norm);
                if (trans && trans !== ans.value) {
                  ans.value = trans;
                  itemChanged = true;
                }
              }
            }
          }
        }
      }
      if (qg.grid && qg.grid.columns && qg.grid.columns.options) {
        for (let o = 0; o < qg.grid.columns.options.length; o++) {
          const opt = qg.grid.columns.options[o];
          if (opt.value) {
            const norm = normalizeText(opt.value);
            const trans = translationsMap.get(norm);
            if (trans && trans !== opt.value) {
              opt.value = trans;
              itemChanged = true;
            }
          }
        }
      }
    }

    if (itemChanged) {
      // Helper to prepare 'image' fields for writing back by converting read-only contentUri
      // to write-only sourceUri, which prevents Forms API 400 validation errors while preserving the images.
      const prepareImageFieldsForWrite = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach(prepareImageFieldsForWrite);
        } else {
          if ('image' in obj && obj.image && typeof obj.image === 'object') {
            const img = obj.image;
            if (img.contentUri) {
              img.sourceUri = img.contentUri;
              delete img.contentUri;
            } else if (!img.sourceUri) {
              delete obj.image;
            }
          }
          for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
              if (key === 'image') continue; // Already processed
              prepareImageFieldsForWrite(obj[key]);
            }
          }
        }
      };
      prepareImageFieldsForWrite(updatedItem);

      let maskFields = ['title', 'description'];
      if (updatedItem.questionItem) {
        maskFields.push('questionItem.question');
      }
      if (updatedItem.questionGroupItem) {
        maskFields.push('questionGroupItem.questions');
        maskFields.push('questionGroupItem.grid');
      }
      
      requests.push({
        updateItem: {
          item: updatedItem,
          location: {
            index: idx
          },
          updateMask: maskFields.join(',')
        }
      });
    }
  }

  await checkCancelledGlobal(presentationId);

  if (requests.length > 0) {
    await logDebug(`Applying ${requests.length} batch updates to form...`, presentationId);
    const updateFormUrl = `https://forms.googleapis.com/v1/forms/${copyId}:batchUpdate`;
    const writeRes = await googleApiFetch(updateFormUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: requests
      })
    });
    if (!writeRes.ok) {
      const errText = await writeRes.text();
      throw new Error(`Forms batchUpdate API error (${writeRes.status}): ${errText}`);
    }
    await logDebug('Translated form content written back successfully.', presentationId);
  } else {
    await logDebug('No form updates needed.', presentationId);
  }

  return editUrl;
}
