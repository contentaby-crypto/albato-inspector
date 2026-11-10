(() => {
  'use strict';

  const MAX_TEXT = 260;
  const MAX_ITEMS = 80;
  const MAX_TABLE_ROWS = 60;
  const MAX_VISIBLE_TEXT = 12000;
  const SENSITIVE_NAME = /(pass(word)?|secret|token|api[-_ ]?key|access[-_ ]?key|refresh[-_ ]?token|cookie|session|authorization|bearer)/i;
  const ERROR_NAME = /(error|fail|ошиб|warning|warn|предупреж|reset progress|сбросить прогресс)/i;

  function normalizeText(value, max = MAX_TEXT) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function redact(value, hint = '', max = 1000) {
    const text = normalizeText(value, max);
    if (!text) return '';
    if (SENSITIVE_NAME.test(hint)) return '[masked]';
    return text
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [masked]')
      .replace(/((?:токен\s+(?:запроса|доступа)|token|access[_ -]?token|api[_ -]?key)\s*(?:[:=]\s*|\s+))[^\s,;]+/gi, '$1[masked]')
      .replace(/([?&](?:token|key|secret|password|auth|signature)=)[^&\s]+/gi, '$1[masked]')
      .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g, '[jwt-masked]')
      .slice(0, max);
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function elementLabel(element) {
    const aria = element.getAttribute('aria-label');
    if (aria) return redact(aria, 'label');
    const title = element.getAttribute('title');
    if (title) return redact(title, 'label');
    const id = element.getAttribute('id');
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label) return redact(label.textContent, 'label');
    }
    const parentLabel = element.closest('label');
    if (parentLabel) return redact(parentLabel.textContent, 'label');
    const preceding = element.previousElementSibling;
    if (preceding && ['LABEL', 'SPAN', 'DIV'].includes(preceding.tagName)) {
      const text = normalizeText(preceding.textContent, 180);
      if (text) return redact(text, 'label');
    }
    return '';
  }

  function controlValue(element) {
    const hint = [element.name, element.id, element.getAttribute('autocomplete'), element.getAttribute('placeholder')].filter(Boolean).join(' ');
    if (element.type === 'password' || SENSITIVE_NAME.test(hint)) return '[masked]';
    if (element.tagName === 'SELECT') {
      return Array.from(element.selectedOptions || []).map(option => redact(option.textContent, hint)).filter(Boolean).join(', ');
    }
    return redact(element.value, hint);
  }

  function pageIdentity() {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
      .filter(isVisible)
      .map(node => redact(node.textContent, 'heading'))
      .filter(Boolean);
    const title = redact(document.title, 'title');
    const path = `${location.pathname}${location.hash || ''}`.slice(0, 500);
    const name = headings[0] || title || 'Albato page';
    return {
      name,
      title,
      url: `${location.origin}${path}`,
      route: location.pathname,
      headings: headings.slice(0, 12)
    };
  }

  function collectControls() {
    const selector = 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"], [role="checkbox"], [role="switch"]';
    return Array.from(new Set(Array.from(document.querySelectorAll(selector))))
      .filter(isVisible)
      .slice(0, MAX_ITEMS)
      .map((element, index) => {
        const label = elementLabel(element);
        const hint = [element.name, element.id, element.getAttribute('autocomplete'), element.getAttribute('placeholder'), label].filter(Boolean).join(' ');
        const isNativeInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
        const value = isNativeInput && !element.isContentEditable
          ? controlValue(element)
          : redact(element.getAttribute('aria-valuetext') || element.getAttribute('data-value') || element.textContent || '', hint, 500);
        return {
          index: index + 1,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role') || undefined,
          type: element.getAttribute('type') || undefined,
          label,
          name: redact(element.getAttribute('name') || '', 'attribute'),
          id: redact(element.getAttribute('id') || '', 'attribute'),
          placeholder: redact(element.getAttribute('placeholder') || '', 'placeholder'),
          value,
          aria_value: redact(element.getAttribute('aria-valuetext') || '', hint, 500),
          required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
          disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true'
        };
      });
  }

  function collectButtons() {
    return Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter(isVisible)
      .map(element => ({
        role: element.tagName.toLowerCase() === 'a' ? 'link' : 'button',
        text: redact(element.textContent, 'button'),
        label: elementLabel(element),
        disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
        href: element.tagName.toLowerCase() === 'a' ? redact(element.getAttribute('href') || '', 'href') : undefined
      }))
      .filter(item => item.text || item.label)
      .slice(0, MAX_ITEMS);
  }

  function collectHeadings() {
    return Array.from(document.querySelectorAll('h1, h2, h3, h4, [role="heading"]'))
      .filter(isVisible)
      .map(element => ({
        level: element.getAttribute('aria-level') || element.tagName.toLowerCase(),
        text: redact(element.textContent, 'heading')
      }))
      .filter(item => item.text)
      .slice(0, MAX_ITEMS);
  }

  function collectMessages() {
    const selector = '[role="alert"], [role="status"], [aria-live="assertive"], [data-testid*="error"], [data-testid*="warning"], [class*="error"], [class*="warning"]';
    const candidates = Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .filter(element => !['BUTTON', 'A'].includes(element.tagName))
      .map(element => redact(element.textContent, 'message', 700))
      .filter(text => text && ERROR_NAME.test(text));
    return [...new Set(candidates)].slice(0, MAX_ITEMS);
  }

  function collectVisibleText() {
    const candidates = [document.body, ...Array.from(document.querySelectorAll('main, [role="main"], #app, [id*="app"], [class*="app"]'))]
      .filter(isVisible)
      .map(element => normalizeText(element.innerText || element.textContent || '', MAX_VISIBLE_TEXT))
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    return candidates.length ? redact(candidates[0], 'page-text', MAX_VISIBLE_TEXT) : '';
  }

  function collectStepHints(headings, buttons, text) {
    const source = [...headings.map(item => item.text), ...buttons.map(item => item.text), text];
    const hints = source.join(' | ').split('|').map(value => normalizeText(value, 180)).filter(Boolean);
    const keywords = /(webhook|trigger|action|module|step|filter|condition|crm|telegram|google|http|api|триггер|действие|модуль|шаг|фильтр|условие)/i;
    return [...new Set(hints.filter(value => keywords.test(value)))].slice(0, 30);
  }

  function collectDialogs() {
    const detailSelector = '[role="dialog"], [aria-modal="true"], dialog, [class*="drawer"], [class*="modal"], [class*="popover"]';
    const seen = new Set();
    const result = [];
    for (const dialog of Array.from(document.querySelectorAll(detailSelector)).filter(isVisible)) {
      const text = redact(dialog.innerText || dialog.textContent || '', 'dialog', 6000);
      const controls = Array.from(dialog.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"], [role="checkbox"], [role="switch"]'))
        .filter(isVisible)
        .map(element => ({
          label: elementLabel(element),
          role: element.getAttribute('role') || element.tagName.toLowerCase(),
          value: redact(element.value || element.getAttribute('aria-valuetext') || element.getAttribute('data-value') || element.textContent || '', elementLabel(element), 700)
        }))
        .slice(0, MAX_ITEMS);
      if (!text && !controls.length) continue;
      const key = `${text}|${JSON.stringify(controls)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ index: result.length + 1, text, controls });
      if (result.length >= 20) break;
    }
    return result;
  }

  function collectStepElements() {
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(isVisible)
      .filter(element => /^(?:Подсказка\s*)?\d+\.\s*/.test(normalizeText(element.innerText || element.textContent, 1200)))
      .filter(element => !isDangerousAction(element));
  }

  function isDangerousAction(element) {
    const text = normalizeText(`${element.innerText || element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`, 1200);
    return /(save|saved|unsaved|reset progress|publish|apply|delete|remove|run|test|сохран|сбросить|применить|удалить|запустить|протестировать)/i.test(text);
  }

  function stepElementData(element) {
    const raw = normalizeText(element.innerText || element.textContent || '', 1200);
    const header = raw.replace(/^Подсказка\s*/i, '').split(/Connection to/i)[0].trim();
    const match = header.match(/^(\d+)\.\s*([^:]+):\s*(.*)$/);
    return {
      number: match ? Number(match[1]) : null,
      app: match ? normalizeText(match[2], 120) : null,
      operation: match ? normalizeText(match[3], 500) : header,
      raw
    };
  }

  function findStepElement(number, rawPrefix = '') {
    const candidates = collectStepElements();
    return candidates.find(element => {
      const data = stepElementData(element);
      return data.number === number && (!rawPrefix || data.raw.startsWith(rawPrefix.slice(0, 80)));
    }) || candidates.find(element => stepElementData(element).number === number) || null;
  }

  function findModuleTitleElement(stepElement, plannedStep = null) {
    const cardRect = stepElement.getBoundingClientRect();
    const scope = stepElement.closest('.react-flow__node') || stepElement;
    const titlePattern = /(?:\bGS|\bEmail|\bПауза|\bФильтр)\s*\d+\s*[—–-]/i;
    // Albato's custom scenario labels (e.g. AV-MACRO 12.1) do not match
    // the legacy GS/Email pattern. Locate their actual text node first.
    const customMarker = String(plannedStep?.operation || '').match(/\b[A-ZА-Я]{2,}(?:[-_][A-ZА-Я]{2,})?\s*\d+(?:\.\d+)?\s*\|/i)?.[0];
    const markers = customMarker ? [customMarker] : [];
    if (!markers.length && /ветвление/i.test(plannedStep?.operation || '')) markers.push('Ветвление');
    if (!markers.length) {
      const operationName = String(plannedStep?.operation || '').split(/\b[A-ZА-Я]{2,}(?:[-_][A-ZА-Я]{2,})?\s*\d+(?:\.\d+)?\s*\|/i)[0].trim();
      if (operationName.length >= 8) markers.push(operationName);
    }
    for (const marker of markers) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const raw = String(node.nodeValue || '');
        const index = raw.toLowerCase().indexOf(marker.toLowerCase());
        if (index < 0 || !node.parentElement || !isVisible(node.parentElement)) continue;
        const unsafe = node.parentElement.closest('button, [role="button"], [class*="kebab"], [class*="toolbar"], [class*="connection"]');
        if (unsafe && unsafe !== stepElement && !unsafe.contains(stepElement)) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, Math.min(raw.length, index + marker.length));
        const rect = range.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.left < cardRect.left - 8 || rect.right > cardRect.right + 8 ||
            rect.top < cardRect.top - 8 || rect.bottom > cardRect.top + cardRect.height * 0.78) continue;
        node.parentElement.__albatoClickRange = { node, start: index, end: Math.min(raw.length, index + marker.length) };
        node.parentElement.__albatoClickRect = rect;
        node.parentElement.__albatoClickText = marker;
        return node.parentElement;
      }
    }
    const plannedMarker = String(plannedStep?.raw || '').match(titlePattern)?.[0] || '';
    const candidates = [stepElement, ...Array.from(scope.querySelectorAll('*'))]
      .filter(element => element !== stepElement && isVisible(element))
      .map(element => ({ element, text: normalizeText(element.innerText || element.textContent || '', 320), rect: element.getBoundingClientRect() }))
      .filter(item => item.text && item.text.length <= 260 && titlePattern.test(item.text))
      .filter(item => item.rect.left >= cardRect.left - 8 && item.rect.right <= cardRect.right + 8 && item.rect.top >= cardRect.top - 8 && item.rect.top <= cardRect.top + cardRect.height * 0.72)
      .sort((left, right) => left.text.length - right.text.length);
    if (candidates[0]) return candidates[0].element;

    if (plannedMarker) {
      const pageCandidates = Array.from(document.querySelectorAll('*'))
        .filter(element => element !== stepElement && isVisible(element))
        .map(element => ({ element, text: normalizeText(element.innerText || element.textContent || '', 320), rect: element.getBoundingClientRect() }))
        .filter(item => item.text.toLowerCase().includes(plannedMarker.toLowerCase()))
        .filter(item => item.text.length <= 320 && item.rect.left >= cardRect.left - 12 && item.rect.right <= cardRect.right + 12 && item.rect.top >= cardRect.top - 12 && item.rect.top <= cardRect.top + cardRect.height * 0.72)
        .sort((left, right) => left.text.length - right.text.length);
      if (pageCandidates[0]) return pageCandidates[0].element;
    }

    if (plannedMarker) {
      const pageWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let pageNode = pageWalker.nextNode();
      while (pageNode) {
        const raw = String(pageNode.nodeValue || '');
        const markerIndex = raw.toLowerCase().indexOf(plannedMarker.toLowerCase());
        if (markerIndex >= 0 && isVisible(pageNode.parentElement)) {
          const range = document.createRange();
          range.setStart(pageNode, markerIndex);
          range.setEnd(pageNode, Math.min(raw.length, markerIndex + 140));
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.left >= cardRect.left - 12 && rect.right <= cardRect.right + 12 && rect.top >= cardRect.top - 12 && rect.top <= cardRect.top + cardRect.height * 0.72) {
            stepElement.__albatoClickRect = rect;
            stepElement.__albatoClickText = plannedMarker;
            return stepElement;
          }
        }
        pageNode = pageWalker.nextNode();
      }
    }

    // Some React Flow nodes expose the title as a text node inside the outer node.
    // Keep the outer node as the event target, but place the synthetic click on the title range.
    const walker = document.createTreeWalker(stepElement, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const raw = String(node.nodeValue || '');
      const match = raw.match(titlePattern);
      if (match && match.index !== undefined) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, Math.min(raw.length, match.index + 140));
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.top >= cardRect.top - 8 && rect.top <= cardRect.top + cardRect.height * 0.72) {
          stepElement.__albatoClickRect = rect;
          stepElement.__albatoClickText = normalizeText(raw, 240);
          return stepElement;
        }
      }
      node = walker.nextNode();
    }
    const titleTextCandidates = Array.from(scope.querySelectorAll('.al-typography.truncate.text-textPrimary'))
      .filter(isVisible)
      .filter(element => /al-typography_mod_semibold/.test(String(element.className || '')))
      .filter(element => {
        const r = element.getBoundingClientRect();
        return r.left >= cardRect.left - 8 && r.right <= cardRect.right + 8 &&
          r.top >= cardRect.top - 8 && r.bottom <= cardRect.bottom + 8 &&
          !/^(?:connection to|подключени|добавить ветку)$/i.test(normalizeText(element.innerText || element.textContent, 100));
      });
    if (titleTextCandidates.length === 1) return titleTextCandidates[0];
    // No broad title-band click: it can hit the navigation bar or another node.
    return null;
  }

  function elementDescriptor(element) {
    if (!element) return null;
    return {
      tag: element.tagName?.toLowerCase() || null,
      role: element.getAttribute?.('role') || null,
      text: element.__albatoClickText || normalizeText(element.innerText || element.textContent || '', 240),
      class_name: normalizeText(typeof element.className === 'string' ? element.className : '', 240),
      hit_target: element.__albatoHitTarget && element.__albatoHitTarget !== element ? {
        tag: element.__albatoHitTarget.tagName?.toLowerCase() || null,
        text: normalizeText(element.__albatoHitTarget.innerText || element.__albatoHitTarget.textContent || '', 180),
        class_name: normalizeText(typeof element.__albatoHitTarget.className === 'string' ? element.__albatoHitTarget.className : '', 180)
      } : null
    };
  }

  function findStepMenuElement(stepElement) {
    const cardRect = stepElement.getBoundingClientRect();
    const scope = stepElement.closest('[data-node-id], [class*="node"], [class*="step"]') || stepElement.parentElement || document.body;
    const candidates = Array.from(scope.querySelectorAll('button, [role="button"]'))
      .filter(isVisible)
      .filter(element => element !== stepElement)
      .filter(element => {
        const text = normalizeText(`${element.innerText || element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`, 160);
        const rect = element.getBoundingClientRect();
        const insideCard = rect.left >= cardRect.left - 12 && rect.right <= cardRect.right + 12 && rect.top >= cardRect.top - 12 && rect.bottom <= cardRect.bottom + 90;
        return insideCard && (!text || /[⋮…]/.test(text) || element.getAttribute('aria-haspopup') === 'menu' || /menu|options|more|меню|действия/i.test(text));
      });
    return candidates[candidates.length - 1] || null;
  }

  function findSafeEditMenuItem() {
    const scopes = Array.from(document.querySelectorAll('[role="menu"], [role="listbox"], [class*="menu"], [class*="popover"]')).filter(isVisible);
    for (const scope of scopes) {
      const candidates = Array.from(scope.querySelectorAll('[role="menuitem"], [role="option"], button, [role="button"], a'))
        .filter(isVisible)
        .filter(element => !isDangerousAction(element));
      const edit = candidates.find(element => /(edit|configure|settings|настроить|изменить|редактировать|параметры)/i.test(normalizeText(element.innerText || element.textContent || '', 300)));
      if (edit) return edit;
    }
    return null;
  }

  function activateDoubleClick(element) {
    try { element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window })); } catch (_) { /* optional */ }
    try { element.dblclick(); } catch (_) { /* optional */ }
  }

  function moduleEvidence(baseline, snapshot, stateChanged, expectedStep = null) {
    const beforeText = baseline?.evidence?.visible_text || '';
    const afterText = snapshot?.evidence?.visible_text || '';
    const detailControls = (snapshot?.evidence?.controls || []).filter(control => control.placeholder !== 'Опишите связку...');
    const textChanged = beforeText !== afterText && Math.abs(afterText.length - beforeText.length) >= 180;
    const signals = {
      state_changed: Boolean(stateChanged),
      text_changed: textChanged,
      dialogs: (snapshot?.ui?.dialogs || 0) > 0,
      extra_controls: detailControls.length > 0,
      extra_tables: (snapshot?.ui?.tables || 0) > 0
    };
    const opened = signals.dialogs || signals.extra_controls || signals.extra_tables || signals.text_changed;
    const dialogText = (snapshot?.evidence?.dialogs || []).map(dialog => dialog.text || '').join(' | ');
    const connectionOnly = Boolean(dialogText) && /дополнительные параметры подключения|connection to google sheets/i.test(dialogText) && !/(фильтр|миграц|столбец|email|номер строки|строк[ау]|smtp|письм|услови)/i.test(dialogText);
    const operation = String(expectedStep?.operation || '').toLowerCase();
    const expectedMarkers = operation.includes('создана новая строка') ? ['создана новая строка', 'новая строка']
      : operation.includes('задержка') || operation.includes('пауза') ? ['задержка', 'пауза']
      : operation.includes('найти одну строку') ? ['найти одну строку']
      : (operation.includes('условию') || (expectedStep?.app === 'Инструмент' && operation.startsWith('фильтр'))) ? ['задать поведение связки', 'условие']
      : operation.includes('отправка письма') || operation.includes('smtp') ? ['отправка письма', 'smtp', 'электронная почта']
      : operation.includes('обновить строку') || operation.includes('дата отправки') ? ['обновить строку', 'дата отправки']
      : [];
    const stepMatch = !expectedStep || !dialogText || expectedMarkers.length === 0 || expectedMarkers.some(marker => dialogText.toLowerCase().includes(marker));
    signals.step_match = stepMatch;
    const detailKind = !stepMatch ? 'stale-module-dialog' : (connectionOnly ? 'connection-settings' : (signals.dialogs ? 'module-settings-or-dialog' : (signals.extra_controls || signals.extra_tables || signals.text_changed ? 'module-content' : 'none')));
    const moduleSettingsOpened = opened && stepMatch && !connectionOnly;
    return {
      opened,
      module_settings_opened: moduleSettingsOpened,
      detail_kind: detailKind,
      signals,
      reason: moduleSettingsOpened
        ? 'Открыты детали модуля.'
        : (!stepMatch ? 'Открытая панель относится к другому шагу; настройки текущего шага не подтверждены.' : (connectionOnly ? 'Открыты только дополнительные параметры подключения, не настройки операции.' : 'Изменения карточки не дали доступных деталей модуля.'))
    };
  }

  function findSafeCloseElement() {
    const scopes = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog, [class*="drawer"], [class*="modal"], [class*="popover"]')).filter(isVisible);
    for (const scope of scopes) {
      const candidates = Array.from(scope.querySelectorAll('button, [role="button"], [aria-label], [title]'))
        .filter(isVisible)
        .filter(element => !isDangerousAction(element));
      const close = candidates.find(element => /(close|закрыть|back|назад|cancel|отменить|×)/i.test(`${element.innerText || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`));
      if (close) return close;
    }
    return null;
  }

  async function closeAllSafePanels() {
    let previous = pageFingerprint();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const close = findSafeCloseElement();
      if (!close) {
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); } catch (_) { /* optional */ }
        await delay(220);
        const afterEscape = pageFingerprint();
        if (afterEscape === previous) break;
        previous = afterEscape;
        continue;
      }
      activateElement(close);
      await delay(280);
      let next = pageFingerprint();
      if (next === previous) {
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); } catch (_) { /* optional */ }
        await delay(220);
        next = pageFingerprint();
      }
      if (next === previous) break;
      previous = next;
    }
  }

  function pageFingerprint() {
    const bodyText = normalizeText(document.body?.innerText || '', 6000);
    const detailText = collectDialogs().map(dialog => dialog.text).join('|');
    const controls = Array.from(document.querySelectorAll('input, textarea, select, [role="textbox"], [role="combobox"], [role="listbox"]'))
      .filter(isVisible)
      .map(element => `${element.getAttribute('aria-expanded') || ''}:${element.getAttribute('aria-selected') || ''}:${element.getAttribute('value') || ''}:${normalizeText(element.textContent, 120)}`)
      .join('|');
    const stepState = collectStepElements()
      .map(element => `${element.getAttribute('aria-expanded') || ''}:${element.getAttribute('aria-selected') || ''}:${element.className || ''}`)
      .join('|');
    return [location.href, bodyText, detailText, controls, stepState].join('||');
  }

  function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function waitForUiChange(before, timeout = 2500) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await delay(120);
      if (pageFingerprint() !== before) return true;
    }
    return false;
  }

  function journalHref() {
    const link = Array.from(document.querySelectorAll('a[href]'))
      .filter(isVisible)
      .find(element => /\/bundle\/history\/\d+(?:[/?#]|$)/i.test(element.href) && !/dashboard/i.test(element.href));
    return link ? link.href : null;
  }

  function reportProgress(message) {
    try { chrome.runtime.sendMessage({ type: 'FULL_AUDIT_PROGRESS', message }); } catch (_) { /* popup may be closed */ }
  }

  function activateElement(element) {
    try { element.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) { /* optional */ }
    const baseRect = element.getBoundingClientRect();
    const band = element.__albatoClickBand;
    const rect = band
      ? {
          left: baseRect.left + baseRect.width * band.left,
          top: baseRect.top + baseRect.height * band.top,
          width: baseRect.width * band.width,
          height: baseRect.height * band.height
        }
      : (element.__albatoClickRect || baseRect);
    const point = [rect.left + rect.width / 2, rect.top + rect.height / 2];
    const hitTarget = element.__albatoClickRect || element.__albatoClickBand ? document.elementFromPoint(point[0], point[1]) : element;
    const dispatchTarget = hitTarget || element;
    element.__albatoHitTarget = dispatchTarget;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      try {
        dispatchTarget.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: point[0],
          clientY: point[1]
        }));
      } catch (_) { /* fallback to click below */ }
    }
    try { dispatchTarget.click(); } catch (_) { element.click(); }
  }

  function activateModuleTitle(target, stepElement) {
    if (!target) return false;
    try { stepElement.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) { /* optional */ }
    if (target.__albatoClickRange) {
      const { node, start, end } = target.__albatoClickRange;
      if (!node.isConnected) return false;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      target.__albatoClickRect = range.getBoundingClientRect();
    }
    const rect = target.__albatoClickRect || target.getBoundingClientRect();
    const card = stepElement.closest('.react-flow__node') || stepElement;
    const cardRect = card.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (rect.width <= 0 || rect.height <= 0 || x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight ||
        x < cardRect.left || x > cardRect.right || y < cardRect.top || y > cardRect.bottom) return false;
    const hit = document.elementFromPoint(x, y);
    target.__albatoHitTarget = hit;
    if (!hit || !card.contains(hit) || hit.closest('[class*="kebab"], [class*="toolbar"], [class*="connection"], [class*="bgConditionNode"]')) return false;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      hit.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
    }
    hit.click();
    return true;
  }

  async function revealModuleTitle(stepElement, plannedStep) {
    let target = findModuleTitleElement(stepElement, plannedStep);
    const card = stepElement.closest('.react-flow__node') || stepElement;
    const rect = (target || card).getBoundingClientRect();
    const offscreen = rect.right <= 0 || rect.left >= window.innerWidth || rect.bottom <= 0 || rect.top >= window.innerHeight;
    if (!offscreen) return { target, fit_view_attempted: false };
    // React Flow uses a transformed canvas: scrollIntoView cannot bring a
    // node with negative viewport coordinates into the viewport. The built-in
    // Fit View control changes only the editor's view, not scenario settings.
    const controls = Array.from(document.querySelectorAll('button.react-flow__controls-fitview'))
      .filter(isVisible).filter(button => !button.disabled);
    if (controls.length !== 1) return { target, fit_view_attempted: false, reason: 'Fit View control not uniquely available.' };
    const before = card.getBoundingClientRect();
    activateElement(controls[0]);
    await delay(450);
    const after = card.getBoundingClientRect();
    if (Math.abs(after.left - before.left) < 4 && Math.abs(after.top - before.top) < 4) {
      return { target, fit_view_attempted: true, reason: 'Fit View did not move the target card.' };
    }
    const freshStep = findStepElement(plannedStep.number, plannedStep.raw);
    if (!freshStep) return { target: null, fit_view_attempted: true, reason: 'Card disappeared after Fit View.' };
    stepElement = freshStep;
    target = findModuleTitleElement(freshStep, plannedStep);
    return { target, stepElement: freshStep, fit_view_attempted: true };
  }

  function moduleTitleProbe(stepElement, target) {
    const card = stepElement.closest('.react-flow__node') || stepElement;
    const rect = card.getBoundingClientRect();
    const box = r => ({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    const titleNodes = [];
    let node;
    while ((node = walker.nextNode()) && titleNodes.length < 16) {
      const text = normalizeText(node.nodeValue, 100);
      if (!text || !node.parentElement || !isVisible(node.parentElement)) continue;
      titleNodes.push({ text: redact(text, 'title probe', 100), class_name: normalizeText(String(node.parentElement.className || ''), 100), box: box(node.parentElement.getBoundingClientRect()) });
    }
    const targetRect = target?.__albatoClickRect || target?.getBoundingClientRect();
    const x = targetRect ? targetRect.left + targetRect.width / 2 : null;
    const y = targetRect ? targetRect.top + targetRect.height / 2 : null;
    const hit = x !== null && x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight ? document.elementFromPoint(x, y) : null;
    return { card: box(rect), viewport: { width: window.innerWidth, height: window.innerHeight },
      target: targetRect ? box(targetRect) : null, hit: hit ? {
        inside_card: card.contains(hit), tag: hit.tagName.toLowerCase(), class_name: normalizeText(String(hit.className || ''), 120),
        text: redact(hit.innerText || hit.textContent || '', 'hit target', 100)
      } : null, title_nodes: titleNodes };
  }

  function summarizeScenarioStep(step) {
    const operation = step.operation || '';
    const titleMatch = operation.match(/((?:GS|Email|Пауза|Фильтр)\s*\d+\s*[—–-]\s*.+)$/i);
    return {
      number: step.number,
      app: step.app,
      name: titleMatch ? normalizeText(titleMatch[1], 320) : normalizeText(operation, 320),
      operation: normalizeText(operation, 600),
      connection: step.connection || null,
      enabled: step.enabled !== false
    };
  }

  function captureScenario() {
    const snapshot = capture('scenario');
    return {
      schema: 'albato-scenario/v1',
      capture_mode: 'scenario',
      captured_at: new Date().toISOString(),
      read_only: true,
      page: snapshot.page,
      scenario: snapshot.scenario,
      steps: (snapshot.evidence?.steps || []).map(summarizeScenarioStep),
      evidence: {
        active_view: snapshot.evidence?.active_view,
        errors: snapshot.evidence?.errors || [],
        visible_text: snapshot.evidence?.visible_text || ''
      },
      limits: [
        'Считаны структура и названия видимых шагов.',
        'Настройки модулей не открывались.',
        'Журнал не читался.'
      ]
    };
  }

  function visibleTextForTest(snapshot) {
    return [
      snapshot?.evidence?.visible_text || '',
      ...(snapshot?.evidence?.dialogs || []).map(dialog => dialog.text || ''),
      ...(snapshot?.evidence?.buttons || []).map(button => `${button.text || ''} ${button.label || ''}`),
      ...(snapshot?.evidence?.controls || []).map(control => control.value || '')
    ].join(' ').replace(/\s+/g, ' ').trim();
  }

  function findTestStepButton() {
    const scopes = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog, [class*="drawer"], [class*="modal"], [class*="popover"]')).filter(isVisible);
    for (const scope of scopes) {
      const button = Array.from(scope.querySelectorAll('button, [role="button"]'))
        .filter(isVisible)
        .find(element => !element.disabled && /^(?:тестировать шаг|test step)$/i.test(normalizeText(element.innerText || element.textContent || '', 120)));
      if (button) return button;
    }
    return null;
  }

  function findSampleOptions() {
    const candidates = Array.from(document.querySelectorAll('button, [role="option"], [role="menuitem"], [role="button"]'))
      .filter(isVisible)
      .map(element => ({ element, text: normalizeText(element.innerText || element.textContent || '', 180) }))
      .map(item => ({ ...item, match: item.text.match(/(?:образец|sample)\s*(\d+)/i) }))
      .filter(item => item.match && !isDangerousAction(item.element))
      .sort((a, b) => Number(b.match[1]) - Number(a.match[1]));
    return candidates;
  }

  function findScopedTestButton() {
    const scopes = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog, [class*="drawer"], [class*="modal"], [class*="popover"]')).filter(isVisible);
    for (const scope of scopes) {
      const button = Array.from(scope.querySelectorAll('button, [role="button"]'))
        .filter(isVisible)
        .find(element => !element.disabled && /^(?:протестировать|test)$/i.test(normalizeText(element.innerText || element.textContent || '', 120)));
      if (button) return button;
    }
    return null;
  }

  async function runModuleTest(plannedStep) {
    const result = {
      requested: true,
      status: 'not_confirmed',
      selected_sample: null,
      sample_options: [],
      fallback_test_clicked: false,
      evidence: null
    };
    const testStepButton = findTestStepButton();
    if (testStepButton) {
      const beforeTest = pageFingerprint();
      activateElement(testStepButton);
      await waitForUiChange(beforeTest, 2500);
      await delay(400);
    }
    const samples = findSampleOptions();
    result.sample_options = samples.map(item => item.text).slice(0, 20);
    let snapshot = null;
    if (samples.length) {
      const selected = samples[0];
      result.selected_sample = selected.text;
      activateElement(selected.element);
      await delay(500);
      snapshot = capture('module-test-sample');
    } else {
      const testButton = findScopedTestButton();
      if (testButton) {
        result.fallback_test_clicked = true;
        activateElement(testButton);
        await delay(1200);
        snapshot = capture('module-test-result');
      }
    }
    if (!snapshot) {
      result.status = 'not_available';
      result.evidence = { reason: 'Кнопка теста или образцы данных в настройках не найдены.' };
      return result;
    }
    const text = visibleTextForTest(snapshot);
    const failed = /(ошиб|error|failed|не удалось|неуспеш)/i.test(text);
    const passed = /(успеш|success|выполн|готов|получен|данные)/i.test(text);
    result.status = failed ? 'failed' : (passed || result.selected_sample ? 'completed' : 'not_confirmed');
    result.evidence = {
      errors: snapshot.evidence?.errors || [],
      dialogs: snapshot.evidence?.dialogs || [],
      controls: snapshot.evidence?.controls || [],
      visible_text: snapshot.evidence?.visible_text || '',
      page: snapshot.page
    };
    return result;
  }

  function relatedClickableCandidates(scope) {
    return Array.from(scope.querySelectorAll('button, [role="button"], [aria-label], [title]'))
      .filter(isVisible)
      .filter(element => !isDangerousAction(element));
  }

  function findModuleRelatedTarget(stepElement, kind) {
    if (kind === 'filter') {
      const globalFilterCandidates = Array.from(document.querySelectorAll('[class*="bgConditionNode"], [class*="bg-bgConditionNode"], [class*="toolbar"]'))
        .filter(isVisible)
        .map(element => ({ element, text: normalizeText(element.innerText || element.textContent || '', 120), rect: element.getBoundingClientRect() }))
        .filter(item => /\bфильтр\b|\bfilter\b/i.test(item.text))
        .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
      if (globalFilterCandidates[0]) return globalFilterCandidates[0].element;
    }
    const cardRect = stepElement.getBoundingClientRect();
    if (kind === 'filter') {
      const explicitCandidates = Array.from(document.querySelectorAll('.al-step-card-wrapper-pro-mode__toolbar, [class*="bgConditionNode"], [class*="bg-bgConditionNode"], [class*="cursor-pointer"]'))
        .filter(isVisible)
        .map(element => ({ element, text: normalizeText(element.innerText || element.textContent || '', 180), rect: element.getBoundingClientRect() }))
        .filter(item => /\bфильтр\b|\bfilter\b/i.test(item.text))
        .filter(item => item.rect.left >= cardRect.left - 12 && item.rect.right <= cardRect.right + 12 && item.rect.top >= cardRect.top + cardRect.height * 0.55)
        .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height) || a.text.length - b.text.length);
      if (explicitCandidates[0]) return explicitCandidates[0].element;
      const filterHit = document.elementFromPoint(cardRect.left + cardRect.width * 0.5, cardRect.top + cardRect.height * 1.03);
      const filterScope = filterHit?.closest?.('[class*="bgConditionNode"], [class*="toolbar"], [class*="filter"]') || filterHit;
      if (filterScope && isVisible(filterScope) && /фильтр|filter/i.test(normalizeText(filterScope.innerText || filterScope.textContent || '', 120))) return filterScope;
    } else {
      const icon = Array.from(document.querySelectorAll('button.al-icon-button, button[class*="al-icon-button"]'))
        .filter(isVisible)
        .map(element => ({ element, rect: element.getBoundingClientRect() }))
        .filter(item => item.rect.left > cardRect.left + cardRect.width * 0.72 && item.rect.top >= cardRect.top + cardRect.height * 0.45 && item.rect.top <= cardRect.bottom + 20)
        .sort((a, b) => a.rect.left - b.rect.left)[0];
      if (icon) return icon.element;
    }
    const all = Array.from(document.querySelectorAll('*'))
      .filter(isVisible)
      .filter(element => !isDangerousAction(element));
    if (kind === 'filter') {
      const candidates = all
        .map(element => ({ element, text: normalizeText(element.innerText || element.textContent || '', 180), rect: element.getBoundingClientRect() }))
        .filter(item => /\bфильтр\b|\bfilter\b/i.test(item.text))
        .filter(item => item.rect.left >= cardRect.left - 12 && item.rect.right <= cardRect.right + 12 && item.rect.top >= cardRect.top + cardRect.height * 0.55)
        .sort((a, b) => a.text.length - b.text.length);
      return candidates[0]?.element || null;
    }
    const connectionCandidates = all
      .map(element => ({ element, text: normalizeText(element.innerText || element.textContent || '', 180), rect: element.getBoundingClientRect() }))
      .filter(item => /connection to|подключени/i.test(item.text) && item.rect.left >= cardRect.left - 12 && item.rect.right <= cardRect.right + 12)
      .sort((a, b) => a.text.length - b.text.length);
    const connection = connectionCandidates[0];
    if (!connection) return null;
    const candidates = all
      .filter(element => element !== connection.element)
      .map(element => ({ element, text: normalizeText(element.innerText || element.textContent || '', 120), rect: element.getBoundingClientRect(), tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || '' }))
      .filter(item => item.rect.left >= connection.rect.right - 8 && item.rect.left <= cardRect.right + 12 && Math.abs(item.rect.top - connection.rect.top) < Math.max(30, connection.rect.height * 1.8))
      .filter(item => item.rect.width <= 52 && item.rect.height <= 52)
      .filter(item => !item.text || /settings|setup|настро|параметр|⚙|◈/i.test(item.text) || item.tag === 'svg' || item.role === 'button')
      .sort((a, b) => {
        const aPriority = a.tag === 'svg' || a.role === 'button' ? 0 : 1;
        const bPriority = b.tag === 'svg' || b.role === 'button' ? 0 : 1;
        return aPriority - bPriority || a.rect.left - b.rect.left;
      });
    return candidates[0]?.element || null;
  }

  function collectRelatedAreaDiagnostics(stepElement) {
    const cardRect = stepElement.getBoundingClientRect();
    const elements = Array.from(document.querySelectorAll('*')).filter(isVisible);
    const describe = element => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || null,
        text: normalizeText(element.innerText || element.textContent || '', 180),
        class_name: normalizeText(typeof element.className === 'string' ? element.className : '', 180),
        rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
      };
    };
    const withinCard = elements
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= cardRect.left - 8 && rect.right <= cardRect.right + 8 && rect.top >= cardRect.top - 8 && rect.bottom <= cardRect.bottom + 60;
      })
      .map(describe)
      .filter(item => item.text || item.role || /svg|button|path/i.test(item.tag))
      .slice(0, 80);
    const textMatches = elements
      .map(describe)
      .filter(item => /фильтр|filter|connection to|подключени|настро|параметр/i.test(item.text))
      .slice(0, 50);
    return {
      document_visibility: document.visibilityState,
      card: describe(stepElement),
      within_card: withinCard,
      text_matches: textMatches
    };
  }

  async function scanModuleOneAreas(stepElement, plannedStep, includeFilter = true) {
    const result = { requested: plannedStep.number === 1, records: [], skipped: [] };
    if (!result.requested) return result;
    await closeAllSafePanels();
    const freshStepElement = findStepElement(plannedStep.number, plannedStep.raw) || stepElement;
    result.diagnostics = collectRelatedAreaDiagnostics(freshStepElement);
    for (const area of [
      { kind: 'connection-extra-settings', label: 'Дополнительные настройки подключения' },
      ...(includeFilter ? [{ kind: 'filter', label: 'Фильтр' }] : [])
    ]) {
      const currentStepElement = findStepElement(plannedStep.number, plannedStep.raw) || freshStepElement;
      const target = findModuleRelatedTarget(currentStepElement, area.kind === 'filter' ? 'filter' : 'connection-extra');
      if (!target) {
        result.skipped.push({ kind: area.kind, reason: `Элемент «${area.label}» не найден в карточке модуля.` });
        continue;
      }
      const before = pageFingerprint();
      activateElement(target);
      const changed = await waitForUiChange(before);
      await delay(350);
      const snapshot = capture(`module-${area.kind}`);
      result.records.push({
        kind: area.kind,
        label: area.label,
        opened: changed || (snapshot.ui?.dialogs || 0) > 0,
        page: snapshot.page,
        ui: snapshot.ui,
        controls: snapshot.evidence?.controls || [],
        dialogs: snapshot.evidence?.dialogs || [],
        buttons: snapshot.evidence?.buttons || [],
        errors: snapshot.evidence?.errors || [],
        visible_text: snapshot.evidence?.visible_text || ''
      });
      await closeAllSafePanels();
    }
    return result;
  }

  // Filters are separate React Flow nodes: the webhook and every branch can
  // have one. Do not associate a chip with the nearest module by guesswork.
  function constructorFilterTargets() {
    const chips = Array.from(document.querySelectorAll('[class*="bgConditionNode"]'))
      .filter(isVisible)
      .filter(element => normalizeText(element.innerText || element.textContent, 80) === 'Фильтр')
      .filter(element => !Array.from(element.children).some(child =>
        isVisible(child) && normalizeText(child.innerText || child.textContent, 80) === 'Фильтр' &&
        String(child.className || '').includes('bgConditionNode')));
    const branchButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(isVisible)
      .filter(element => /Фильтр\s*(?:вкл|выкл)\./i.test(normalizeText(element.innerText || element.textContent, 300)))
      .filter(element => !/^\s*(?:Подсказка\s*)?\d+\./i.test(normalizeText(element.innerText || element.textContent, 300)))
      .filter(element => !Array.from(element.querySelectorAll('button, [role="button"]')).some(child =>
        isVisible(child) && /Фильтр\s*(?:вкл|выкл)\./i.test(normalizeText(child.innerText || child.textContent, 300))));
    return [...chips.map(element => ({ element, kind: 'webhook-or-module' })),
      ...branchButtons.map(element => ({ element, kind: 'branch' }))].slice(0, 60).map(({ element, kind }, index) => {
      const node = element.closest('[data-id], [data-node-id], .react-flow__node');
      const rect = element.getBoundingClientRect();
      const label = normalizeText(element.innerText || element.textContent, 260);
      return {
        element,
        kind,
        branch_name: kind === 'branch' ? redact(label.replace(/Фильтр\s*(?:вкл|выкл)\..*$/i, ''), 'branch name', 160) : null,
        filter_enabled: kind === 'branch' ? /Фильтр\s*вкл\./i.test(label) : null,
        index: index + 1,
        node_id: node?.getAttribute('data-id') || node?.getAttribute('data-node-id') || null,
        node_label: redact(node?.innerText || node?.textContent || '', 'filter node', 180),
        position: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
      };
    });
  }

  function branchTitleTarget(branch) {
    const title = branch.branch_name;
    if (!title) return null;
    const candidates = Array.from(branch.element.querySelectorAll('span, div, p, strong'))
      .filter(isVisible)
      .filter(element => normalizeText(element.innerText || element.textContent, 180) === title)
      .sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height -
        b.getBoundingClientRect().width * b.getBoundingClientRect().height);
    return candidates[0] || null;
  }

  async function scanConstructorFilters() {
    const planned = constructorFilterTargets().map(({ index, kind, branch_name, filter_enabled, node_id, node_label, position }) =>
      ({ index, kind, branch_name, filter_enabled, node_id, node_label, position }));
    const records = [];
    const skipped = [];
    for (const plan of planned) {
      await closeAllSafePanels();
      if (collectDialogs().length) {
        skipped.push({ filter: plan, reason: 'Предыдущая панель не закрылась; обход фильтров остановлен.' });
        break;
      }
      const candidates = constructorFilterTargets().filter(item =>
        item.kind === plan.kind && (plan.node_id ? item.node_id === plan.node_id : item.index === plan.index) &&
        (plan.kind !== 'branch' || item.branch_name === plan.branch_name));
      const fresh = candidates.length === 1 ? candidates[0] : null;
      if (!fresh) {
        skipped.push({ filter: plan, reason: 'Фильтр не удалось однозначно найти повторно.' });
        continue;
      }
      const target = fresh.kind === 'branch' ? branchTitleTarget(fresh) : fresh.element;
      if (!target) {
        skipped.push({ filter: plan, reason: 'Заголовок ветки не найден отдельно от переключателя фильтра; клик пропущен.',
          title_candidates: Array.from(fresh.element.querySelectorAll('span, div')).filter(isVisible).slice(0, 12).map(element => ({
            text: redact(element.innerText || element.textContent || '', 'branch title', 120),
            class_name: normalizeText(String(element.className || ''), 120)
          })) });
        continue;
      }
      const before = pageFingerprint();
      activateElement(target);
      const changed = await waitForUiChange(before);
      const snapshot = capture('filter');
      const dialogs = snapshot.evidence?.dialogs || [];
      const confirmed = changed && dialogs.some(dialog => /фильтр|услови|поведени/i.test(dialog.text || ''));
      if (confirmed) records.push({ filter: plan, opened: true,
        controls: snapshot.evidence?.controls || [], dialogs,
        visible_text: snapshot.evidence?.visible_text || '' });
      else skipped.push({ filter: plan, reason: 'Настройки фильтра не подтверждены после открытия.' });
      await closeAllSafePanels();
      if (collectDialogs().length) break;
    }
    for (const plan of planned) {
      if (records.some(record => record.filter.index === plan.index) || skipped.some(item => item.filter.index === plan.index)) continue;
      skipped.push({ filter: plan, reason: 'Обход остановлен до чтения этого фильтра.' });
    }
    return { planned: planned.length, records, skipped,
      limits: ['Привязка к ветке подтверждается только при наличии ID/подписи узла; позиция на схеме не доказывает принадлежность ветке.'] };
  }

  function exactErrorHandlerMenuItem() {
    const scopes = Array.from(document.querySelectorAll('[role="menu"], [class*="dropdown"], [class*="popover"], [class*="menu"]'))
      .filter(isVisible);
    const candidates = scopes.flatMap(scope => Array.from(scope.querySelectorAll('[role="menuitem"], button, [role="button"], [class*="item"]')))
      .filter(isVisible)
      .filter(element => normalizeText(element.innerText || element.textContent, 100) === 'Обработчик ошибок');
    return [...new Set(candidates)].length === 1 ? candidates[0] : null;
  }

  function verifiedSelectedHandler(dialog) {
    if (!dialog) return null;
    const scopes = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], .al-modal__content'))
      .filter(isVisible).filter(element => /Обработчик ошибок/i.test(element.innerText || ''));
    const selected = scopes.flatMap(scope => Array.from(scope.querySelectorAll('input:checked, option:checked, [aria-checked="true"], [aria-selected="true"]')))
      .filter(element => isVisible(element) || isVisible(element.closest('label, [role="radio"], [role="option"], [role="menuitemradio"]')))
      .map(element => {
        const label = element.closest('label, [role="radio"], [role="option"], [role="menuitemradio"]');
        return redact(label?.innerText || elementLabel(element) || element.value || '', 'error handler choice', 200);
      }).filter(Boolean);
    return [...new Set(selected)].length === 1 ? selected[0] : null;
  }

  function errorHandlerChoiceDiagnostics() {
    const choices = [
      'Остановить связку при ошибке',
      'Игнорировать ошибки на этом шаге, продолжить работу связки.',
      'При ошибке перейти к выбранному шагу'
    ];
    const panel = Array.from(document.querySelectorAll('.al-modal__content, [role="dialog"], [aria-modal="true"]'))
      .filter(isVisible)
      .filter(element => /Обработчик ошибок/i.test(element.innerText || ''))
      .find(element => choices.every(choice => (element.innerText || '').includes(choice)));
    if (!panel) return [];
    return choices.map(choice => {
      const exact = Array.from(panel.querySelectorAll('span, label, div, p'))
        .filter(isVisible)
        .filter(element => normalizeText(element.innerText || element.textContent, 260) === choice)
        .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
      const ancestors = [];
      for (let node = exact, depth = 0; node && node !== panel && depth < 5; node = node.parentElement, depth += 1) {
        ancestors.push({
          tag: node.tagName.toLowerCase(),
          class_name: normalizeText(String(node.className || ''), 180),
          role: node.getAttribute('role') || null,
          aria_checked: node.getAttribute('aria-checked'),
          aria_selected: node.getAttribute('aria-selected'),
          data_state: node.getAttribute('data-state'),
          checked: node.matches('input') ? node.checked : null
        });
      }
      return { choice, found: Boolean(exact), ancestors };
    });
  }

  async function scanModuleErrorHandler(plannedStep) {
    if (collectDialogs().length) return { status: 'not_confirmed', reason: 'Предыдущая панель не закрылась.' };
    const step = findStepElement(plannedStep.number, plannedStep.raw);
    if (!step) return { status: 'not_confirmed', reason: 'Карточка модуля не найдена.' };
    // Only an explicitly marked menu control is safe; never use an anonymous
    // button or right-click on the entire React Flow node.
    const rect = step.getBoundingClientRect();
    const node = step.closest('[data-id], [data-node-id], .react-flow__node');
    const explicitButtons = node ? Array.from(node.querySelectorAll('button.al-kebab-menu__button.wl-kebab-menu-button')).filter(isVisible) : [];
    const menuButtons = explicitButtons.length ? explicitButtons : Array.from(document.querySelectorAll('button.al-kebab-menu__button.wl-kebab-menu-button, button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"], button[aria-label], button[title]'))
      .filter(isVisible).filter(button => {
        const r = button.getBoundingClientRect();
        const name = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`;
        return r.left >= rect.left + rect.width * 0.65 && r.right <= rect.right + 8 &&
          r.top >= rect.top - 8 && r.bottom <= rect.top + rect.height * 0.55 &&
          r.width <= 48 && r.height <= 48 &&
          (button.matches('button.al-kebab-menu__button.wl-kebab-menu-button') || button.getAttribute('aria-haspopup') === 'menu' || /^(?:more|options|menu|действия|меню|ещё|еще|⋮|…)[\s.]*$/i.test(name.trim()));
      });
    if (menuButtons.length !== 1) {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], [class*="menu"], [class*="more"]'))
        .filter(isVisible).filter(element => {
          const r = element.getBoundingClientRect();
          return r.left >= rect.left - 8 && r.right <= rect.right + 8 && r.top >= rect.top - 8 && r.bottom <= rect.bottom + 8 && r.width <= 48 && r.height <= 48;
        }).slice(0, 12).map(element => ({
          tag: element.tagName.toLowerCase(),
          class_name: normalizeText(String(element.className || ''), 160),
          label: redact(`${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`, 'menu label', 100)
        }));
      return { status: 'not_confirmed', reason: `Однозначная кнопка меню не найдена (${menuButtons.length}).`, menu_candidates: candidates };
    }
    const before = pageFingerprint();
    activateElement(menuButtons[0]);
    if (!await waitForUiChange(before)) return { status: 'not_confirmed', reason: 'Контекстное меню не открылось.' };
    const item = exactErrorHandlerMenuItem();
    if (!item) {
      await closeAllSafePanels();
      return { status: 'not_confirmed', reason: 'Пункт «Обработчик ошибок» не найден однозначно.' };
    }
    const menuBefore = pageFingerprint();
    activateElement(item);
    const changed = await waitForUiChange(menuBefore);
    const snapshot = capture('error-handler');
    const dialogs = (snapshot.evidence?.dialogs || []).filter(dialog => /Обработчик ошибок/i.test(dialog.text || ''));
    const panel = dialogs.find(dialog => /Выберите действие при возникновении ошибок/i.test(dialog.text || ''));
    const selected = changed && panel ? verifiedSelectedHandler(panel) : null;
    const result = {
      status: selected ? 'confirmed' : 'not_confirmed',
      panel_opened: Boolean(changed && panel),
      selected: selected || null,
      reason: selected ? null : (panel ? 'Панель открыта, но выбранный вариант не имеет подтверждённого DOM-признака.' : 'Панель обработчика не подтверждена.'),
      choice_diagnostics: panel ? errorHandlerChoiceDiagnostics() : [],
      dialogs,
      controls: snapshot.evidence?.controls || [],
      visible_text: snapshot.evidence?.visible_text || ''
    };
    await closeAllSafePanels();
    return result;
  }

  async function captureModuleSettings(stepNumber, runTest = false) {
    const overview = capture('scenario');
    const plannedStep = (overview.evidence?.steps || []).map(summarizeScenarioStep).find(step => step.number === Number(stepNumber));
    if (!plannedStep) {
      return {
        schema: 'albato-module-audit/v1',
        capture_mode: 'module-debug',
        captured_at: new Date().toISOString(),
        read_only: true,
        scenario: overview.scenario,
        step: { number: Number(stepNumber) },
        module_opened: false,
        module_settings_opened: false,
        module_detection: { detail_kind: 'not-found', reason: 'Шаг не найден на текущем экране.' }
      };
    }
    await closeAllSafePanels();
    const element = findStepElement(plannedStep.number, plannedStep.operation);
    if (!element) {
      return {
        schema: 'albato-module-audit/v1',
        capture_mode: 'module-debug',
        captured_at: new Date().toISOString(),
        read_only: true,
        scenario: overview.scenario,
        step: plannedStep,
        module_opened: false,
        module_settings_opened: false,
        module_detection: { detail_kind: 'not-found', reason: 'Карточка шага не найдена после обновления DOM.' }
      };
    }
    const revealed = await revealModuleTitle(element, plannedStep);
    const titleTarget = revealed.target;
    const currentElement = revealed.stepElement || element;
    const before = pageFingerprint();
    const clicked = activateModuleTitle(titleTarget, currentElement);
    const changed = clicked ? await waitForUiChange(before) : false;
    if (clicked) await delay(350);
    const snapshot = capture('module-debug');
    const detection = clicked ? moduleEvidence(overview, snapshot, changed, plannedStep)
      : { opened: false, module_settings_opened: false, detail_kind: 'unsafe-title-target', reason: 'Заголовок не найден или точка клика вне карточки/перекрыта.', title_probe: moduleTitleProbe(element, titleTarget) };
    const test = runTest
      ? (detection.module_settings_opened ? await runModuleTest(plannedStep) : { requested: true, status: 'not_available', evidence: { reason: 'Настройки модуля не открылись, тест не запускался.' } })
      : { requested: false, status: 'not_requested' };
    const subSettings = await scanModuleOneAreas(element, plannedStep);
    await closeAllSafePanels();
    const errorHandler = await scanModuleErrorHandler(plannedStep);
    const result = {
      schema: 'albato-module-audit/v1',
      capture_mode: 'module-debug',
      test_requested: Boolean(runTest),
      captured_at: new Date().toISOString(),
      read_only: !runTest,
      page: snapshot.page,
      scenario: overview.scenario,
      step: plannedStep,
      click_target: elementDescriptor(titleTarget),
      module_opened: detection.opened,
      module_settings_opened: detection.module_settings_opened,
      module_detection: detection,
      test,
      sub_settings: subSettings,
      error_handler: errorHandler,
      settings: {
        controls: snapshot.evidence?.controls || [],
        dialogs: snapshot.evidence?.dialogs || [],
        buttons: snapshot.evidence?.buttons || [],
        errors: snapshot.evidence?.errors || [],
        save_indicators: snapshot.evidence?.save_indicators || {},
        test_and_data: snapshot.evidence?.test_and_data || {},
        visible_text: snapshot.evidence?.visible_text || ''
      },
      limits: [
        'Снят только выбранный модуль.',
        runTest ? 'Тест модуля был запрошен пользователем; сохранение настроек не выполнялось.' : 'Сохранение и тестирование не выполнялись.',
        'Наличие кнопки «Сохранить» не является доказательством сохраненности.'
      ]
    };
    await closeAllSafePanels();
    return result;
  }

  async function runFullAudit(includeJournal = false) {
    const started = new Date().toISOString();
    await chrome.storage.local.set({ fullAuditState: { status: 'running', started_at: started, page_url: location.href } });
    try {
    const overview = capture('overview');
    const stepPlan = collectStepElements().map(stepElementData).filter(step => step.number !== null);
    const modules = [];
    const skipped = [];
    reportProgress(`Найдено шагов: ${stepPlan.length}. Начинаю read-only обход.`);

    for (const plannedStep of stepPlan) {
      const element = findStepElement(plannedStep.number, plannedStep.raw);
      if (!element) {
        skipped.push({ step: plannedStep, reason: 'Карточка шага не найдена после обновления DOM.' });
        continue;
      }
      const revealed = await revealModuleTitle(element, plannedStep);
      const titleTarget = revealed.target;
      const currentElement = revealed.stepElement || element;
      reportProgress(`Открываю шаг ${plannedStep.number}: ${plannedStep.app || plannedStep.operation}`);
      const baseline = overview;
      const before = pageFingerprint();
      const clicked = activateModuleTitle(titleTarget, currentElement);
      const changed = clicked ? await waitForUiChange(before) : false;
      if (clicked) await delay(350);
      const snapshot = capture('module');
      const detection = clicked ? moduleEvidence(baseline, snapshot, changed, plannedStep)
        : { opened: false, module_settings_opened: false, detail_kind: 'unsafe-title-target', reason: 'Заголовок не найден или точка клика вне карточки/перекрыта.', title_probe: moduleTitleProbe(element, titleTarget) };

      snapshot.step = plannedStep;
      snapshot.click_target = elementDescriptor(titleTarget);
      snapshot.module_opened = detection.opened;
      snapshot.module_settings_opened = detection.module_settings_opened;
      snapshot.module_detection = detection;
      if (plannedStep.number === 1) snapshot.sub_settings = await scanModuleOneAreas(element, plannedStep, false);
      if (!detection.module_settings_opened) {
        skipped.push({ step: plannedStep, reason: detection.reason });
      }
      await closeAllSafePanels();
      snapshot.error_handler = await scanModuleErrorHandler(plannedStep);
      if (snapshot.error_handler.status !== 'confirmed') {
        skipped.push({ step: plannedStep, area: 'error_handler', reason: snapshot.error_handler.reason });
      }
      modules.push(snapshot);
      await closeAllSafePanels();
    }

    reportProgress('Считываю фильтры после вебхука и на ветках конструктора.');
    const filters = await scanConstructorFilters();
    skipped.push(...filters.skipped.map(item => ({ area: 'filter', ...item })));
    let journal = null;
    if (includeJournal) {
      const href = journalHref();
      if (href && detectView() === 'constructor') {
        reportProgress('Открываю журнал в отдельной фоновой вкладке без изменения текущей страницы.');
        try {
          const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_JOURNAL', url: href });
          if (response?.ok) journal = response.audit;
          else skipped.push({ area: 'journal', reason: response?.error || 'Журнал не вернул данные.' });
        } catch (error) {
          skipped.push({ area: 'journal', reason: error?.message || String(error) });
        }
      } else if (detectView() === 'journal') {
        journal = capture('journal');
      } else {
        skipped.push({ area: 'journal', reason: 'Ссылка на журнал не найдена на текущем экране.' });
      }
    } else {
      reportProgress('Проверка журнала отключена переключателем.');
    }

    const result = {
      schema: 'albato-audit/v2',
      capture_mode: 'full',
      captured_at: new Date().toISOString(),
      started_at: started,
      read_only: true,
      source: { kind: 'chrome-extension-autonomous-read-only-audit', page_url: location.href },
      options: { include_journal: Boolean(includeJournal) },
      scenario: overview.scenario,
      overview,
      modules,
      filters,
      journal,
      summary: {
        planned_steps: stepPlan.length,
        attempted_modules: modules.length,
        opened_modules: modules.filter(module => module.module_opened).length,
        unopened_modules: modules.filter(module => !module.module_opened).length,
        configured_modules: modules.filter(module => module.module_detection?.module_settings_opened).length,
        connection_only_modules: modules.filter(module => module.module_detection?.detail_kind === 'connection-settings').length,
        unconfirmed_module_settings: modules.filter(module => !module.module_detection?.module_settings_opened).length,
        filters_found: filters.planned,
        filters_read: filters.records.length,
        filters_unconfirmed: filters.skipped.length,
        branch_filters_found: filters.records.filter(record => record.filter.kind === 'branch').length + filters.skipped.filter(item => item.filter.kind === 'branch').length,
        branch_filters_read: filters.records.filter(record => record.filter.kind === 'branch').length,
        error_handler_panels_opened: modules.filter(module => module.error_handler?.panel_opened).length,
        error_handlers_confirmed: modules.filter(module => module.error_handler?.status === 'confirmed').length,
        error_handlers_unconfirmed: modules.filter(module => module.error_handler?.status !== 'confirmed').length,
        skipped_items: skipped.length + (journal?.summary?.journal_details_skipped || 0),
        journal_requested: Boolean(includeJournal),
        journal_captured: Boolean(journal && journal.page?.readability?.status === 'readable'),
        journal_runs_seen: journal?.summary?.journal_runs_seen ?? null,
        journal_details_read: journal?.summary?.journal_details_read ?? 0,
        journal_details_skipped: journal?.summary?.journal_details_skipped ?? 0,
        journal_details_complete: journal?.summary?.journal_details_complete === true
      },
      skipped,
      limits: [
        'Расширение открывает карточки, явно найденные фильтры и однозначные пункты меню «Обработчик ошибок»; настройки не меняет.',
        'Кнопки сохранения, запуска, тестирования, сброса и удаления заблокированы для обхода.',
        'Наличие значения на экране не является самостоятельным доказательством сохранения.',
        'Если Albato не отдает значение в DOM или доступном журнале, оно отмечается как непроверенное.'
      ]
    };
    await chrome.storage.local.set({ latestAudit: result, latestFullAudit: result,
      fullAuditState: { status: 'completed', started_at: started, captured_at: result.captured_at, page_url: location.href } });
    reportProgress(`Готово: открыто модулей ${result.summary.opened_modules}/${stepPlan.length}, настройки подтверждены для ${result.summary.configured_modules}, журнал: ${result.summary.journal_captured ? 'прочитан' : 'не подтвержден'}.`);
    return result;
    } catch (error) {
      await chrome.storage.local.set({ fullAuditState: { status: 'failed', started_at: started, page_url: location.href, error: error?.message || String(error) } });
      throw error;
    }
  }

  function detectView() {
    const path = location.pathname.toLowerCase();
    if (/\/bundle\/history\/\d+\/dashboard/.test(path)) return 'analytics';
    if (/\/bundle\/history\/\d+/.test(path)) return 'journal';
    if (/\/bundle\/edit\/\d+/.test(path)) return 'constructor';
    return 'unknown';
  }

  function collectStepCards(buttons) {
    return buttons
      .filter(item => /^(?:Подсказка\s*)?\d+\.\s*/.test(item.text))
      .map(item => {
        const header = item.text.replace(/^Подсказка\s*/i, '').split(/Connection to/i)[0].trim();
        const match = header.match(/^(\d+)\.\s*([^:]+):\s*(.*)$/);
        const connection = item.text.match(/(Connection to .+?)(?=Фильтр|Миграция|$)/i);
        return {
          number: match ? Number(match[1]) : null,
          app: match ? normalizeText(match[2], 120) : null,
          operation: match ? normalizeText(match[3], 500) : header,
          connection: connection ? normalizeText(connection[1], 220) : null,
          enabled: !/(отключен|disabled|выключен)/i.test(item.text),
          raw: item.text
        };
      })
      .slice(0, MAX_ITEMS);
  }

  function collectTables() {
    const tables = Array.from(document.querySelectorAll('table, [role="grid"]'))
      .filter(isVisible)
      .map((table, index) => {
        const headers = Array.from(table.querySelectorAll('thead th, [role="columnheader"]'))
          .map(cell => redact(cell.textContent, 'table-header', 180))
          .filter(Boolean)
          .slice(0, 40);
        const rows = Array.from(table.querySelectorAll('tbody tr, [role="row"]'))
          .filter(isVisible)
          .map(row => Array.from(row.querySelectorAll('th, td, [role="gridcell"], [role="cell"]'))
            .map(cell => redact(cell.textContent, 'table-cell', 500))
            .filter(Boolean))
          .filter(row => row.length)
          .slice(0, MAX_TABLE_ROWS);
        return { index: index + 1, headers, rows };
      })
      .filter(table => table.headers.length || table.rows.length);
    return tables;
  }

  function collectSaveIndicators(buttons, visibleText) {
    const controls = buttons
      .filter(item => /(save|saved|unsaved|сохран|изменен|применить)/i.test(`${item.text} ${item.label}`))
      .slice(0, 20);
    const markers = visibleText
      .split(/\s{2,}|[.!?]\s+/)
      .map(value => normalizeText(value, 220))
      .filter(value => /(save|saved|unsaved|сохран|изменен|применить)/i.test(value))
      .slice(0, 20);
    return { controls, markers };
  }

  function collectJournalRows(activeView, visibleText) {
    if (activeView !== 'journal') return [];
    const header = /дата\s*\/\s*время\s+сервис\s+результат\s+статус/i.exec(visibleText);
    if (!header) return [];
    const body = visibleText.slice(header.index + header[0].length);
    const dates = Array.from(body.matchAll(/\b\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}(?::\d{2})?\b/g));
    return dates.slice(0, MAX_TABLE_ROWS).map((match, index) => {
      const detail = body.slice(match.index + match[0].length, dates[index + 1]?.index ?? body.length).trim();
      const status = detail.match(/(?:Успех|Ошибка|Выполняется|Отменено|Success|Error|Failed|Running)\s*$/i)?.[0] || null;
      const step = detail.match(/^(\d+)\.\s+/);
      return {
        date_time: match[0],
        kind: step ? 'step' : 'execution',
        step_number: step ? Number(step[1]) : null,
        result: redact(detail.replace(/\s+(?:Успех|Ошибка|Выполняется|Отменено|Success|Error|Failed|Running)\s*$/i, ''), 'journal-result', 600),
        status,
        complete: Boolean(status)
      };
    }).filter(row => row.complete && (row.kind === 'step' || /Связка отработала|execution/i.test(row.result)));
  }

  function diagnoseJournalDom() {
    if (detectView() !== 'journal' || document.visibilityState !== 'visible') {
      throw new Error('Откройте видимую вкладку Журнал нужной связки.');
    }
    const describe = node => {
      if (!(node instanceof Element)) return null;
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName.toLowerCase(),
        class_name: String(node.className?.baseVal || node.className || '').slice(0, 200),
        role: node.getAttribute('role'),
        aria_label: redact(node.getAttribute('aria-label') || '', 'label', 100),
        aria_expanded: node.getAttribute('aria-expanded'),
        data_testid: redact(node.getAttribute('data-testid') || '', 'attribute', 100),
        visible: isVisible(node),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        child_buttons: Array.from(node.querySelectorAll('button, [role="button"]')).slice(0, 8).map(button => ({
          tag: button.tagName.toLowerCase(), class_name: String(button.className?.baseVal || button.className || '').slice(0, 150),
          label: redact(button.getAttribute('aria-label') || button.getAttribute('title') || '', 'label', 100),
          text: redact(button.innerText || '', 'button', 80), expanded: button.getAttribute('aria-expanded')
        }))
      };
    };
    const ancestry = (node, depth = 7) => {
      const result = [];
      for (let element = node, n = 0; element && n < depth; element = element.parentElement, n += 1) result.push(describe(element));
      return result;
    };
    const datePattern = /^\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}(?::\d{2})?$/;
    const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const dateNodes = [];
    for (let textNode = textWalker.nextNode(); textNode && dateNodes.length < 4; textNode = textWalker.nextNode()) {
      if (datePattern.test(normalizeText(textNode.nodeValue, 40)) && isVisible(textNode.parentElement)) dateNodes.push(textNode.parentElement);
    }
    const dates = dateNodes.map(node => ({ date_time: normalizeText(node.textContent, 40), ancestors: ancestry(node) }));
    const details = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(isVisible).filter(node => /^Детали$/i.test(normalizeText(node.innerText || node.textContent || '', 40)))
      .slice(0, 3).map(node => ({ ancestors: ancestry(node) }));
    const panels = Array.from(document.querySelectorAll('.al-modal, .al-modal__header, .al-modal__content'))
      .filter(isVisible).slice(0, 5).map(node => ({ structure: describe(node),
        header_controls: Array.from(node.matches('.al-modal__header') ? node.querySelectorAll('*') :
          (node.querySelector('.al-modal__header')?.querySelectorAll('*') || []))
          .filter(child => child.matches('button, [role="button"], [title], [aria-label], [class*="close"], svg, [class*="icon"]'))
          .slice(0, 20).map(describe),
        headings: Array.from(node.querySelectorAll('h1,h2,h3,[role="heading"]')).slice(0, 6)
          .map(h => redact(h.textContent, 'heading', 100)) }));
    const eventContainers = Array.from(document.querySelectorAll('.al-bundle-history-table__event-container')).filter(isVisible);
    const events = eventContainers.slice(0, 5).map((container, index) => {
      const structural = node => ({
        ...describe(node),
        children: Array.from(node.children).slice(0, 12).map(child => ({
          tag: child.tagName.toLowerCase(),
          class_name: String(child.className?.baseVal || child.className || '').slice(0, 200),
          role: child.getAttribute('role'),
          aria_expanded: child.getAttribute('aria-expanded'),
          visible: isVisible(child),
          child_count: child.children.length
        }))
      });
      const header = Array.from(container.children).find(child => !child.classList.contains('al-bundle-history-table__step-list')) || container.firstElementChild;
      const headerNodes = header ? [header, ...Array.from(header.querySelectorAll('*')).slice(0, 45)] : [];
      return {
        index: index + 1,
        container: structural(container),
        header: header ? structural(header) : null,
        header_nodes: headerNodes.filter(node => node !== header &&
          (node.matches('button, [role="button"], [aria-expanded], [class*="arrow"], [class*="chevron"], [class*="expand"], svg') || node.children.length === 0))
          .slice(0, 25).map(structural),
        step_containers: container.querySelectorAll('.al-bundle-history-table__step-container').length,
        details_buttons: Array.from(container.querySelectorAll('button.al-bundle-history-table__details-button')).filter(isVisible).length
      };
    });
    return {
      schema: 'albato-journal-dom-diagnostic/v2', captured_at: new Date().toISOString(),
      read_only: true, interactions: 0, route: location.pathname,
      scenario_id: extractScenarioId(location.pathname),
      evidence: { dates, details, panels, events, event_containers_total: eventContainers.length,
        table_rows: document.querySelectorAll('tr, [role="row"]').length },
      limits: ['Ни одна кнопка не нажата: снимок фиксирует только текущее состояние DOM.',
        'Сравните events до и после ручного раскрытия одной и той же записи.',
        'Показаны первые пять контейнеров; текст полей и содержимое панели намеренно не включены.']
    };
  }

  function journalEventContainers() {
    return Array.from(document.querySelectorAll('.al-bundle-history-table__event-container')).filter(isVisible);
  }

  function journalEventExpanded(container) {
    const list = container?.querySelector('.al-bundle-history-table__step-list');
    return Boolean(container?.classList.contains('al-bundle-history-table__event-container_expanded') &&
      list && !list.classList.contains('rah-static--height-zero') && isVisible(list));
  }

  function journalDetailsPanel() {
    return Array.from(document.querySelectorAll('.al-modal__content')).find(isVisible) || null;
  }

  async function waitForJournalState(check, timeout = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (check()) return true;
      await delay(100);
    }
    return Boolean(check());
  }

  // Albato mounts the modal before its asynchronous payload has finished updating.
  // Never associate the first nonempty text with the clicked step.
  async function settledJournalDetails(previousText, expectedSummary) {
    const started = Date.now();
    let lastText = '';
    let changedAt = Date.now();
    while (Date.now() - started < 4500) {
      const panel = journalDetailsPanel();
      const text = normalizeText(panel?.innerText || '', 12001);
      if (text !== lastText) { lastText = text; changedAt = Date.now(); }
      const runTime = (expectedSummary.match(/\b\d{2}\.\d{2}\.\d{4}\s+(\d{2}:\d{2}:\d{2})/) || [])[1];
      const payloadTime = (text.match(/Дата и время запроса\s+\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2}:\d{2})/) || [])[1];
      if (text && text !== previousText && Date.now() - changedAt >= 550 &&
          (!runTime || !payloadTime || runTime === payloadTime)) return { panel, text };
      await delay(100);
    }
    return null;
  }

  async function closeJournalDetails() {
    const panel = journalDetailsPanel();
    if (!panel) return true;
    const modal = panel.closest('.al-modal');
    // Confirmed by the user's no-click DOM diagnostic: a div, not a button.
    const closeIcons = Array.from(modal?.querySelectorAll('.al-modal__header .al-modal__control.icon-close') || []).filter(isVisible);
    if (closeIcons.length !== 1) return false;
    closeIcons[0].click();
    return waitForJournalState(() => !journalDetailsPanel());
  }

  async function captureJournalDeep() {
    const audit = capture('journal');
    if (audit.page.active_view !== 'journal' || document.visibilityState !== 'visible') return audit;
    const records = [];
    const skipped = [];
    const total = journalEventContainers().length;
    const limit = Math.min(total, MAX_TABLE_ROWS);
    let blocked = false;
    let previousDetailsText = '';
    if (journalDetailsPanel()) {
      skipped.push({ reason: 'Открыто окно «Детали»; закройте его перед обходом.' });
      blocked = true;
    }
    for (let index = 0; index < limit && !blocked; index += 1) {
      const container = journalEventContainers()[index];
      if (!container) { skipped.push({ run: index + 1, reason: 'Контейнер запуска исчез из DOM.' }); continue; }
      const header = container.querySelector('.al-bundle-history-table__row_type_event-head');
      const arrow = header?.querySelector('.al-bundle-history-event-step-counter__arrow');
      const date = normalizeText(header?.querySelector('.al-bundle-history-table__cell-event-date')?.textContent || '', 80);
      const status = redact(header?.querySelector('.al-bundle-history-table__cell_type_status')?.innerText || '', 'journal-status', 100);
      const record = { index: index + 1, date_time: date || null, status: status || null, expanded: false, steps: [] };
      records.push(record);
      if (!header || !arrow || !isVisible(arrow)) {
        skipped.push({ run: index + 1, reason: 'Заголовок или стрелка запуска не распознаны.' });
        continue;
      }
      const initiallyExpanded = journalEventExpanded(container);
      if (!initiallyExpanded) {
        // The arrow is a span; the parent event-head row is its scoped disclosure control.
        header.click();
        if (!await waitForJournalState(() => journalEventExpanded(container))) {
          skipped.push({ run: index + 1, reason: 'Раскрытие записи не подтверждено по классам и видимости списка шагов.' });
          continue;
        }
      }
      record.expanded = true;
      const list = container.querySelector('.al-bundle-history-table__step-list');
      const stepContainers = Array.from(list?.querySelectorAll('.al-bundle-history-table__step-container') || []).filter(isVisible);
      if (!stepContainers.length) skipped.push({ run: index + 1, reason: 'Раскрытая запись не содержит видимых шагов.' });
      const stepLimit = Math.min(stepContainers.length, 30);
      if (stepContainers.length > stepLimit) skipped.push({ run: index + 1, reason: `Шаги ограничены: ${stepLimit} из ${stepContainers.length}.` });
      for (let stepIndex = 0; stepIndex < stepLimit; stepIndex += 1) {
        const scope = stepContainers[stepIndex];
        const buttons = Array.from(scope.querySelectorAll('button.al-bundle-history-table__details-button'))
          .filter(node => isVisible(node) && /^Детали$/i.test(normalizeText(node.innerText || node.textContent, 40)));
        const step = { index: stepIndex + 1,
          summary: redact(scope.querySelector('.al-bundle-history-table__row')?.innerText || scope.innerText || '', 'journal-step', 700),
          details_opened: false };
        record.steps.push(step);
        if (buttons.length !== 1) {
          skipped.push({ run: index + 1, step: stepIndex + 1, reason: `Ожидалась одна видимая кнопка «Детали», найдено ${buttons.length}.` });
          continue;
        }
        if (journalDetailsPanel()) {
          skipped.push({ run: index + 1, step: stepIndex + 1, reason: 'Предыдущее окно «Детали» осталось открытым.' });
          blocked = true;
          break;
        }
        activateElement(buttons[0]);
        if (!await waitForJournalState(() => Boolean(journalDetailsPanel()))) {
          skipped.push({ run: index + 1, step: stepIndex + 1, reason: 'Окно «Детали» не открылось.' });
          continue;
        }
        const settled = await settledJournalDetails(previousDetailsText, step.summary);
        const raw = settled?.text || '';
        if (raw) previousDetailsText = raw;
        const isDelay = /Задержка связки|Пауза\s+02/.test(step.summary);
        const isEmail = /Отправить HTML-письмо|Письмо отправлено/.test(step.summary);
        const isFilter = /Фильтр\s+04|Фильтр пройден/.test(step.summary);
        const isUpdate = /Записать дату отправки|Обновлена существующая строка/.test(step.summary);
        const isSheet = /GS\s+0[13]|Получена новая строка|Искомое значение/.test(step.summary);
        const related = Boolean(raw) && (
          isDelay ? /Задержка связки \(в минутах\)/.test(raw) :
          isEmail ? /Тема письма|Текст письма|SMTP/.test(raw) :
          isFilter ? ((/Фильтр|Условие/.test(raw) ||
            (/Нет новых данных/i.test(raw) && /Токен запроса\s*:?\s*\S+/i.test(raw))) &&
            !/Файл таблицы|Текст письма|Номер строки|SMTP/i.test(raw)) :
          isUpdate ? /Дата отправки ответа|Обновлена существующая строка/.test(raw) :
          isSheet ? /Файл таблицы|Лист таблицы|Номер строки/.test(raw) : false);
        step.details_opened = Boolean(journalDetailsPanel());
        step.details_verified = related;
        if (!related) skipped.push({ run: index + 1, step: stepIndex + 1,
          reason: raw ? 'Содержимое окна не подтверждает принадлежность этому шагу (или совпало с предыдущим).' : 'Окно не дало нового устойчивого содержимого.' });
        step.details = { text: related ? redact(raw, 'journal-details', 12000) : '[unverified]' };
        step.truncated = related && raw.length > 12000;
        if (step.truncated) skipped.push({ run: index + 1, step: stepIndex + 1, reason: 'Содержимое окна «Детали» усечено до 12000 символов.' });
        if (!await closeJournalDetails()) {
          skipped.push({ run: index + 1, step: stepIndex + 1, reason: 'Не удалось безопасно закрыть окно «Детали»; обход остановлен.' });
          blocked = true;
          break;
        }
      }
      if (!initiallyExpanded && !blocked && header.isConnected) {
        header.click();
        if (!await waitForJournalState(() => !journalEventExpanded(container))) {
          skipped.push({ run: index + 1, reason: 'Не удалось восстановить свёрнутое состояние записи.' });
          blocked = true;
        }
      }
    }
    if (total > limit) skipped.push({ reason: `Лимит запусков: обработано не более ${limit} из ${total}.` });
    audit.evidence.journal_details = records;
    audit.evidence.journal_details_skipped = skipped;
    audit.ui.journal_details_read = records.reduce((sum, run) => sum + run.steps.filter(step => step.details_verified).length, 0);
    audit.summary = { journal_runs_seen: total, journal_runs_expanded: records.filter(run => run.expanded).length,
      journal_details_read: audit.ui.journal_details_read, journal_details_skipped: skipped.length,
      journal_details_complete: total > 0 && !blocked && skipped.length === 0 && records.length === total &&
        records.every(run => run.expanded && run.steps.length > 0 && run.steps.every(step => step.details_verified && !step.truncated)) };
    audit.limits.push('Обход ограничен текущими DOM-контейнерами загруженной страницы; пропуски и усечение перечислены отдельно.');
    return audit;
  }

  function collectTestAndDataEvidence(visibleText, dialogs, buttons, controls) {
    const sources = [
      visibleText || '',
      ...(dialogs || []).map(dialog => dialog.text || ''),
      ...(buttons || []).map(button => `${button.text || ''} ${button.label || ''}`),
      ...(controls || []).map(control => `${control.label || ''} ${control.value || ''} ${control.placeholder || ''}`)
    ];
    const text = sources.join(' | ').replace(/\s+/g, ' ').trim();
    const testMatches = text.match(/[^|.!?]*(?:тест|test|протестир|успешно|success|failed|ошибк|error)[^|.!?]*/gi) || [];
    const dataMatches = text.match(/[^|.!?]*(?:данн|data|sample|payload|input|output|получен|сохранен)[^|.!?]*/gi) || [];
    const testFailed = /(тест[^.]{0,80}(?:ошиб|не удалось|неуспеш)|test[^.]{0,80}(?:fail|error)|failed|error)/i.test(text);
    const testPassed = /(тест[^.]{0,80}(?:успеш|пройден|выполн)|test[^.]{0,80}(?:pass|success)|данные получены|получены данные)/i.test(text);
    const emptyData = /(нет данных|данные отсутствуют|данных нет|пуст(?:о|ые)|no data|empty)/i.test(text);
    const availableData = /(тестовые данные|sample data|payload|input data|output data|данные получены|получены данные|сохраненн(?:ые|ых) данные|доступн(?:ые|ы) данн)/i.test(text);
    const saveVisible = (buttons || []).some(button => /(save|сохранить)/i.test(`${button.text || ''} ${button.label || ''}`));
    const savedMarker = /(настройки сохранены|сохранено|saved successfully|settings saved)/i.test(text);
    return {
      testing: {
        status: testFailed ? 'failed' : (testPassed ? 'passed' : 'not_confirmed'),
        evidence: [...new Set(testMatches.map(value => normalizeText(value, 260)).filter(Boolean))].slice(0, 12)
      },
      operational_data: {
        status: emptyData ? 'empty' : (availableData ? 'available' : 'not_confirmed'),
        evidence: [...new Set(dataMatches.map(value => normalizeText(value, 300)).filter(Boolean))].slice(0, 12)
      },
      settings: {
        status: savedMarker ? 'saved_marker_visible' : 'not_confirmed',
        save_control_visible: saveVisible
      }
    };
  }

  function assessReadability(activeView, visibleText, tables, dialogs, journalRows = []) {
    const text = String(visibleText || '');
    if (activeView === 'journal') {
      if (document.visibilityState === 'hidden') {
        return { status: 'not_readable', reason: 'Страница журнала снята в hidden-вкладке; пустой или неполный результат нельзя считать подтверждением.' };
      }
      const hasHeader = /дата\s*\/\s*время.*сервис.*результат.*статус/i.test(text);
      const emptyJournal = hasHeader && /(?:нет\s+(?:данных|запусков|выполнений)|no\s+(?:data|runs|executions))/i.test(text.slice(text.search(/дата\s*\/\s*время/i)));
      if (journalRows.length || emptyJournal) {
        return { status: 'readable', reason: journalRows.length ? `Подтверждены записи журнала: ${journalRows.length} (только видимая часть страницы).` : 'Журнал явно сообщает об отсутствии записей.' };
      }
      return { status: 'not_confirmed', reason: hasHeader ? 'Заголовок журнала виден, но структурированные записи или явное сообщение о пустом журнале не найдены.' : 'Разметка журнала не подтверждена.' };
    }
    if (text.length >= 250 || dialogs.length || tables.length) {
      return { status: 'readable', reason: 'Страница содержит доступный текст или детали модуля.' };
    }
    return { status: 'not_confirmed', reason: 'На странице доступно слишком мало содержимого для уверенного аудита.' };
  }

  function capture(mode = 'screen') {
    const identity = pageIdentity();
    const controls = collectControls();
    const buttons = collectButtons();
    const headings = collectHeadings();
    const errors = collectMessages();
    const visibleText = collectVisibleText();
    const activeView = detectView();
    const steps = collectStepCards(buttons);
    const tables = collectTables();
    const dialogs = collectDialogs();
    const journalRows = collectJournalRows(activeView, visibleText);
    const saveIndicators = collectSaveIndicators(buttons, visibleText);
    const testAndData = activeView === 'journal'
      ? { testing: { status: 'not_applicable', evidence: [] }, operational_data: { status: 'not_applicable', evidence: [] }, settings: { status: 'not_applicable', save_control_visible: false } }
      : collectTestAndDataEvidence(visibleText, dialogs, buttons, controls);
    const readability = assessReadability(activeView, visibleText, tables, dialogs, journalRows);
    const audit = {
      schema: 'albato-audit/v1',
      capture_mode: mode,
      captured_at: new Date().toISOString(),
      read_only: true,
      source: {
        kind: 'chrome-extension-visible-page',
        visibility: document.visibilityState,
        frame: window.top === window ? 'top' : 'nested'
      },
      page: {
        ...identity,
        active_view: activeView,
        readability
      },
      scenario: {
        name: identity.name,
        id: extractScenarioId(location.pathname),
        status: findStatus(visibleText, buttons)
      },
      ui: {
        form_controls: controls.length,
        buttons: buttons.length,
        headings: headings.length,
        steps: steps.length,
        tables: tables.length,
        dialogs: dialogs.length,
        journal_rows: journalRows.length,
        visible_text_chars: visibleText.length
      },
      evidence: {
        active_view: activeView,
        headings,
        steps,
        controls,
        tables,
        dialogs,
        journal_rows: journalRows,
        buttons,
        errors,
        save_indicators: saveIndicators,
        test_and_data: testAndData,
        step_hints: collectStepHints(headings, buttons, visibleText),
        visible_text: visibleText
      },
      limits: [
        'Снята только текущая загруженная страница и раскрытые на ней элементы.',
        'Закрытые/нераскрытые модули не проверялись.',
        'Новые тесты, сохранения и внешние записи не выполнялись.',
        'Наличие кнопки или значения на экране не доказывает, что настройка сохранена.'
      ],
      redactions: [
        'Секретные поля и значения замаскированы.',
        'Токены в Bearer/JWT/query-параметрах замаскированы.'
      ]
    };
    return audit;
  }

  function extractScenarioId(url) {
    const value = String(url || '');
    const bundleMatch = value.match(/\/bundle\/edit\/(\d+)/i);
    if (bundleMatch) return bundleMatch[1];
    const numericSegments = value.match(/\/(\d+)(?:\/|$)/g);
    return numericSegments ? numericSegments[numericSegments.length - 1].replace(/\//g, '') : null;
  }

  function findStatus(text, buttons) {
    const candidates = [...buttons.map(item => item.text), text.slice(0, 1600)];
    const status = candidates.join(' ').match(/\b(active|paused|draft|error|enabled|disabled|активн\w*|пауза|черновик|ошиб\w*|включен\w*|выключен\w*)\b/i);
    return status ? status[1] : 'not-confirmed';
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'CAPTURE_SCENARIO') {
      try {
        sendResponse({ ok: true, audit: captureScenario() });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return true;
    }
    if (message?.type === 'CAPTURE_MODULE_SETTINGS') {
      captureModuleSettings(message.step_number, message.run_test === true)
        .then(audit => sendResponse({ ok: true, audit }))
        .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    }
    if (message?.type === 'DIAGNOSE_JOURNAL_DOM') {
      try { sendResponse({ ok: true, audit: diagnoseJournalDom() }); }
      catch (error) { sendResponse({ ok: false, error: error?.message || String(error) }); }
      return true;
    }
    if (message?.type === 'CAPTURE_AUDIT') {
      try {
        const operation = message.mode === 'journal' ? captureJournalDeep() : Promise.resolve(capture(message.mode || 'screen'));
        operation.then(audit => sendResponse({ ok: true, audit }))
          .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return true;
    }
    if (message?.type === 'RUN_FULL_AUDIT') {
      runFullAudit(message.include_journal === true)
        .then(audit => sendResponse({ ok: true, audit }))
        .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    }
    return undefined;
  });
})();
