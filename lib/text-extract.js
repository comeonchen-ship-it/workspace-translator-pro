/**
 * Pure text-extraction helpers for Slides/Docs structures. No chrome.* or network
 * access, so they are unit-tested directly under Node (see tests/).
 */

/**
 * Filter out untranslatable text runs (numbers, pure punctuation, symbols)
 */
export function isTranslatable(text) {
  if (!text) return false;
  const trimmed = text.trim();
  // Skip raw URLs (e.g. http://..., https://..., www.example.com) to preserve links
  if (/^(https?:\/\/|www\.)\S+$/i.test(trimmed)) return false;
  // Skip email addresses
  if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) return false;
  // If it's purely digits and mathematical/date symbols, don't translate
  if (/^[0-9\s\-\.,:\+\*\/%$=()\[\]{}""'']+(?:\s*(?:am|pm))?$/i.test(trimmed)) return false;
  // Ignore single characters that are not letters or Chinese characters
  if (trimmed.length <= 1 && !/[\u4e00-\u9fa5a-zA-Z]/.test(trimmed)) return false;
  return true;
}

/**
 * Helper to normalize whitespace and newlines for reliable map lookup
 */
export function normalizeText(text) {
  if (!text) return '';
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

/**
 * Recursively find all text structures in elements list
 */
export function extractTextFromElements(elements, pageTextMap, pageId, uniqueTexts, shapeIdsWithText = null) {
  if (!elements) return;
  
  for (const element of elements) {
    if (element.shape && element.shape.text) {
      if (shapeIdsWithText && element.objectId) {
        shapeIdsWithText.add(element.objectId);
      }
      processTextContent(element.shape.text, pageTextMap, pageId, uniqueTexts);
    } else if (element.table) {
      for (const row of element.table.tableRows) {
        if (row.tableCells) {
          for (const cell of row.tableCells) {
            if (cell.text) {
              processTextContent(cell.text, pageTextMap, pageId, uniqueTexts);
            }
          }
        }
      }
    } else if (element.group && element.group.children) {
      extractTextFromElements(element.group.children, pageTextMap, pageId, uniqueTexts, shapeIdsWithText);
    }
  }
}

/**
 * Helper to process text contents of shapes/table cells
 */
export function processTextContent(textContent, pageTextMap, pageId, uniqueTexts) {
  if (!textContent.textElements) return;
  
  const hasLink = textContent.textElements.some(el => el.textRun && el.textRun.style && el.textRun.style.link);
  
  if (hasLink) {
    for (const el of textContent.textElements) {
      if (el.textRun && el.textRun.content) {
        const content = el.textRun.content;
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && isTranslatable(trimmed)) {
            uniqueTexts.add(trimmed);
            if (!pageTextMap.has(pageId)) {
              pageTextMap.set(pageId, new Set());
            }
            pageTextMap.get(pageId).add(trimmed);
          }
        }
      }
    }
  } else {
    let fullText = "";
    for (const el of textContent.textElements) {
      if (el.textRun && el.textRun.content) {
        fullText += el.textRun.content;
      }
    }
    
    // Normalize carriage returns and split into separate lines (paragraphs)
    const lines = fullText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && isTranslatable(trimmed)) {
        uniqueTexts.add(trimmed);
        
        if (!pageTextMap.has(pageId)) {
          pageTextMap.set(pageId, new Set());
        }
        pageTextMap.get(pageId).add(trimmed);
      }
    }
  }
}

/**
 * Recursively find all text structures in document elements list
 */
export function extractTextFromDocElements(elements, uniqueTexts) {
  if (!elements) return;
  
  for (const element of elements) {
    if (element.paragraph) {
      processDocParagraph(element.paragraph, uniqueTexts);
    } else if (element.table) {
      for (const row of element.table.tableRows) {
        if (row.tableCells) {
          for (const cell of row.tableCells) {
            extractTextFromDocElements(cell.content, uniqueTexts);
          }
        }
      }
    } else if (element.tableOfContents) {
      extractTextFromDocElements(element.tableOfContents.content, uniqueTexts);
    }
  }
}

/**
 * Helper to process text contents of doc paragraphs
 */
export function processDocParagraph(paragraph, uniqueTexts) {
  if (!paragraph.elements) return;
  
  const hasLink = paragraph.elements.some(el => el.textRun && el.textRun.textStyle && el.textRun.textStyle.link);
  
  if (hasLink) {
    for (const el of paragraph.elements) {
      if (el.textRun && el.textRun.content) {
        const content = el.textRun.content;
        const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && isTranslatable(trimmed)) {
            uniqueTexts.add(trimmed);
          }
        }
      }
    }
  } else {
    let fullText = "";
    for (const el of paragraph.elements) {
      if (el.textRun && el.textRun.content) {
        fullText += el.textRun.content;
      }
    }
    
    // Normalize carriage returns and split into separate lines
    const lines = fullText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && isTranslatable(trimmed)) {
        uniqueTexts.add(trimmed);
      }
    }
  }
}
