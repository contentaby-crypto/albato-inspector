const captureButton = document.querySelector('#capture');
const fullAuditButton = document.querySelector('#full-audit');
const journalToggle = document.querySelector('#include-journal');
const runTestsToggle = document.querySelector('#run-tests');
const copyButton = document.querySelector('#copy');
const downloadButton = document.querySelector('#download');
const statusNode = document.querySelector('#status');
const summaryNode = document.querySelector('#summary');
const moduleListNode = document.querySelector('#module-list');
const previewNode = document.querySelector('#preview');
const badgeNode = document.querySelector('#badge');

let latest = null;
const moduleAudits = new Map();

chrome.storage.local.get({ includeJournal: false, runModuleTests: false }).then(values => {
  journalToggle.checked = Boolean(values.includeJournal);
  runTestsToggle.checked = Boolean(values.runModuleTests);
});

journalToggle.addEventListener('change', () => {
  chrome.storage.local.set({ includeJournal: journalToggle.checked });
});

runTestsToggle.addEventListener('change', () => {
  chrome.storage.local.set({ runModuleTests: runTestsToggle.checked });
});

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle('error', isError);
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function fileName(audit) {
  const raw = audit?.scenario?.name || audit?.step?.name || 'albato-audit';
  const safe = raw.toString().replace(/[^a-zа-яё0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'albato-audit';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${safe}-${stamp}.json`;
}

async function copyJson(audit) {
  if (!audit) return;
  await navigator.clipboard.writeText(pretty(audit));
}

function downloadJson(audit) {
  if (!audit) return;
  const blob = new Blob([pretty(audit)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(audit);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || !tabs[0].id) throw new Error('Не удалось определить активную вкладку.');
  return tabs[0];
}

function setOutputLabels(mode) {
  const scenarioMode = mode === 'scenario';
  copyButton.textContent = scenarioMode ? 'Скопировать сценарий' : 'Скопировать JSON';
  downloadButton.textContent = scenarioMode ? 'Скачать сценарий' : 'Скачать JSON';
}

function renderScenario(audit) {
  setOutputLabels('scenario');
  latest = audit;
  previewNode.textContent = pretty(audit);
  copyButton.disabled = false;
  downloadButton.disabled = false;
  summaryNode.classList.remove('hidden');
  const name = audit.scenario?.name || 'Связка';
  const steps = audit.steps || audit.modules || [];
  summaryNode.textContent = `${name} · модулей: ${steps.length} · ID: ${audit.scenario?.id || 'не определен'}`;
  moduleAudits.clear();
  moduleListNode.textContent = '';
  moduleListNode.classList.remove('hidden');
  const title = document.createElement('div');
  title.className = 'module-list-title';
  title.textContent = 'Настройки отдельного модуля';
  moduleListNode.appendChild(title);
  for (const step of steps) {
    const row = document.createElement('div');
    row.className = 'module-row';
    const nameNode = document.createElement('div');
    nameNode.className = 'module-name';
    nameNode.textContent = `${step.number}. ${step.name || step.title || step.operation || step.app || 'Модуль'}`;
    const status = document.createElement('span');
    status.className = 'module-status';
    status.textContent = step.enabled === false ? 'выкл.' : '';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.stepNumber = String(step.number);
    button.textContent = 'Снять настройки';
    row.append(nameNode, status, button);
    moduleListNode.appendChild(row);
  }
  badgeNode.textContent = 'сценарий';
}

async function captureModuleSettings(stepNumber, button) {
  button.disabled = true;
  setStatus(`Открываю настройки модуля ${stepNumber}…`);
  try {
    const tab = await activeTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_MODULE_SETTINGS', step_number: Number(stepNumber), run_test: runTestsToggle.checked });
    if (!response?.ok || !response.audit) throw new Error(response?.error || 'Модуль не вернул настройки.');
    const audit = response.audit;
    renderAudit(audit);
    await chrome.storage.local.set({ latestAudit: audit, latestModuleAudit: audit });
    if (audit.module_settings_opened === true || audit.module_detection?.module_settings_opened === true) {
      moduleAudits.set(Number(stepNumber), audit);
      button.classList.add('verified');
      button.dataset.ready = 'true';
      button.textContent = 'Скопировать JSON';
      const testSuffix = runTestsToggle.checked ? ` Тест: ${audit.test?.status || 'не подтвержден'}.` : '';
      setStatus(`Настройки модуля ${stepNumber} сняты. Кнопка модуля теперь копирует JSON.${testSuffix}`);
    } else {
      setStatus(`Настройки модуля ${stepNumber} не подтверждены. JSON сохранен для анализа.`, true);
    }
  } catch (error) {
    setStatus(error?.message || String(error), true);
  } finally {
    button.disabled = false;
  }
}

moduleListNode.addEventListener('click', async event => {
  const button = event.target.closest('button[data-step-number]');
  if (!button) return;
  const stepNumber = Number(button.dataset.stepNumber);
  if (button.dataset.ready === 'true') {
    try {
      await copyJson(moduleAudits.get(stepNumber));
      setStatus(`JSON модуля ${stepNumber} скопирован в буфер обмена.`);
    } catch (error) {
      setStatus(`Не удалось скопировать JSON: ${error?.message || error}`, true);
    }
    return;
  }
  captureModuleSettings(stepNumber, button);
});

function renderAudit(audit) {
  setOutputLabels('json');
  latest = audit;
  const text = pretty(audit);
  previewNode.textContent = text;
  copyButton.disabled = false;
  downloadButton.disabled = false;
  summaryNode.classList.remove('hidden');
  const source = audit.schema === 'albato-audit/v2' ? audit.overview : audit;
  const scenario = audit.scenario?.name || source?.scenario?.name || 'Название не определено';
  const controls = source?.ui?.form_controls ?? 0;
  const errors = source?.evidence?.errors?.length ?? 0;
  const steps = audit.summary?.planned_steps ?? source?.ui?.steps ?? 0;
  const captured = audit.summary?.opened_modules ?? audit.summary?.captured_modules ?? source?.ui?.dialogs ?? 0;
  const configured = audit.summary?.configured_modules ?? captured;
  const tables = audit.summary?.journal_captured ? (audit.journal?.ui?.tables ?? 0) : (source?.ui?.tables ?? 0);
  const view = source?.page?.active_view || 'unknown';
  summaryNode.textContent = audit.schema === 'albato-audit/v2'
    ? `${scenario} · полный аудит · открыто: ${captured}/${steps} · настройки: ${configured}/${steps} · таблиц журнала: ${tables} · пропущено: ${audit.summary?.skipped_items ?? 0}`
    : `${scenario} · экран: ${view} · шагов: ${steps} · таблиц: ${tables} · полей: ${controls} · ошибок: ${errors}`;
  badgeNode.textContent = 'снято';
}

captureButton.addEventListener('click', async () => {
  captureButton.disabled = true;
  fullAuditButton.disabled = true;
  badgeNode.textContent = 'чтение…';
  setStatus('Читаю структуру сценария…');
  try {
    const tab = await activeTab();
    const url = tab.url || '';
    if (!/^https:\/\/(?:[^/]+\.)?albato\.(?:com|ru)\//i.test(url)) {
      throw new Error('Активная вкладка не является страницей Albato.');
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_SCENARIO' });
    if (!response?.ok || !response.audit) throw new Error(response?.error || 'Сценарий не вернул данные.');
    renderScenario(response.audit);
    await chrome.storage.local.set({ latestAudit: response.audit, latestScenario: response.audit });
    setStatus('Сценарий прочитан. Выберите модуль для отдельной диагностики.');
  } catch (error) {
    badgeNode.textContent = 'ошибка';
    setStatus(error?.message || String(error), true);
  } finally {
    captureButton.disabled = false;
    fullAuditButton.disabled = false;
  }
});

fullAuditButton.addEventListener('click', async () => {
  captureButton.disabled = true;
  fullAuditButton.disabled = true;
  badgeNode.textContent = 'аудит…';
  setStatus('Запускаю безопасный read-only обход. Не закрывайте это окно до завершения.');
  try {
    const tab = await activeTab();
    const url = tab.url || '';
    if (!/^https:\/\/(?:[^/]+\.)?albato\.(?:com|ru)\//i.test(url)) {
      throw new Error('Активная вкладка не является страницей Albato.');
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'RUN_FULL_AUDIT', include_journal: journalToggle.checked });
    if (!response?.ok || !response.audit) throw new Error(response?.error || 'Полный аудит не вернул данные.');
    renderAudit(response.audit);
    setStatus('Полный аудит завершен. Данные не отправлялись наружу — скопируйте единый JSON в чат агента.');
  } catch (error) {
    badgeNode.textContent = 'ошибка';
    setStatus(error?.message || String(error), true);
  } finally {
    captureButton.disabled = false;
    fullAuditButton.disabled = false;
  }
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'FULL_AUDIT_PROGRESS') setStatus(message.message);
});

copyButton.addEventListener('click', async () => {
  if (!latest) return;
  try {
    await copyJson(latest);
    setStatus('JSON скопирован в буфер обмена.');
  } catch (error) {
    setStatus(`Не удалось скопировать: ${error?.message || error}`, true);
  }
});

downloadButton.addEventListener('click', () => {
  if (!latest) return;
  downloadJson(latest);
  setStatus('JSON подготовлен для скачивания.');
});
