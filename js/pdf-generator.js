/**
 * pdf-generator.js - HTML template based PDF generator.
 *
 * Flow:
 * 1) User provides activity IDs and selects an HTML template file.
 * 2) App fetches each activity from OFS API.
 * 3) Template placeholders ({{...}}) are populated from OFS data.
 * 4) One PDF is generated per activity.
 * 5) If multiple PDFs are generated, they are packaged into a ZIP.
 */
const PDFGenerator = (() => {
  const PAGE_WIDTH_MM = {
    a4: 210,
    letter: 215.9,
    legal: 215.9,
  };

  let _templateText = '';
  let _outputBlob = null;
  let _outputName = '';
  let _outputType = 'pdf';

  function init() {
    OFSApp.initPage();

    const activityIdsEl = document.getElementById('activityIds');
    const templateFileEl = document.getElementById('templateFile');
    const generateBtn = document.getElementById('generatePdf');
    const downloadBtn = document.getElementById('downloadPdf');
    const generateAgainBtn = document.getElementById('generateAgain');

    if (activityIdsEl) activityIdsEl.addEventListener('input', _updateCount);
    if (templateFileEl) templateFileEl.addEventListener('change', _onTemplateFileSelected);
    if (generateBtn) generateBtn.addEventListener('click', _onGenerate);
    if (downloadBtn) downloadBtn.addEventListener('click', _download);
    if (generateAgainBtn) generateAgainBtn.addEventListener('click', () => _showPanel('previewEmpty'));

    _updateCount();
  }

  function _updateCount() {
    const countEl = document.getElementById('activityCount');
    if (countEl) countEl.textContent = _getIds().length;
  }

  function _getIds() {
    const el = document.getElementById('activityIds');
    if (!el) return [];
    return el.value.split('\n').map(s => s.trim()).filter(Boolean);
  }

  function _showPanel(id) {
    ['previewEmpty', 'previewProgress', 'previewResults', 'previewError']
      .forEach(p => document.getElementById(p)?.classList.add('d-none'));
    document.getElementById(id)?.classList.remove('d-none');
  }

  function _log(msg, type = 'info') {
    const log = document.getElementById('progressLog');
    if (!log) return;
    const ts = new Date().toLocaleTimeString();
    log.insertAdjacentHTML('beforeend',
      `<div class="log-${type}">[${ts}] ${OFSApp.escHtml(msg)}</div>`);
    log.scrollTop = log.scrollHeight;
  }

  function _progress(cur, total, msg) {
    const pct = total > 0 ? Math.round((cur / total) * 100) : 0;
    const bar = document.getElementById('progressBar');
    const text = document.getElementById('progressText');
    if (bar) bar.style.width = `${pct}%`;
    if (text) text.textContent = msg || `${cur} / ${total}`;
    if (msg) _log(msg);
  }

  async function _onTemplateFileSelected(event) {
    const file = event.target?.files?.[0];
    const nameEl = document.getElementById('templateFileName');
    const errEl = document.getElementById('templateError');

    _templateText = '';
    if (errEl) errEl.classList.add('d-none');

    if (!file) {
      if (nameEl) nameEl.textContent = 'No file selected';
      return;
    }

    if (!/\.html?$/i.test(file.name)) {
      if (nameEl) nameEl.textContent = file.name;
      if (errEl) {
        errEl.textContent = 'Please select an .html or .htm template file.';
        errEl.classList.remove('d-none');
      }
      return;
    }

    try {
      _templateText = await file.text();
      if (!_templateText.trim()) throw new Error('Template file is empty.');
      if (nameEl) nameEl.textContent = `${file.name} loaded`;
    } catch (e) {
      _templateText = '';
      if (errEl) {
        errEl.textContent = `Failed to read template: ${e.message}`;
        errEl.classList.remove('d-none');
      }
    }
  }

  async function _onGenerate() {
    const ids = _getIds();
    if (ids.length === 0) {
      OFSApp.showToast('Enter at least one Activity ID.', 'warning');
      return;
    }

    if (!_templateText.trim()) {
      OFSApp.showToast('Select an HTML template file before generating.', 'warning');
      return;
    }

    const creds = OFSApp.getStoredCredentials();
    if (!creds) {
      OFSApp.showToast('OFS credentials are not set. Please configure them on the Home page.', 'danger');
      return;
    }

    const opts = {
      pageSize: document.getElementById('pageSize')?.value || 'a4',
      orient: document.getElementById('pageOrientation')?.value || 'portrait',
    };

    _showPanel('previewProgress');
    document.getElementById('progressLog').innerHTML = '';
    document.getElementById('generatePdf').disabled = true;

    _outputBlob = null;
    _outputName = '';
    _outputType = 'pdf';

    const errors = [];
    const outputs = [];

    try {
      _log(`Starting - ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'} requested.`, 'info');

      const { results } = await OFSAPI.getActivities(
        creds,
        ids,
        (cur, total, msg) => _progress(cur, total * 2, msg)
      );

      for (let i = 0; i < results.length; i++) {
        const { id, data, error } = results[i];
        _progress(results.length + i + 1, results.length * 2, `Rendering PDF for activity ${id}...`);

        if (error) {
          errors.push(`Activity ${id}: ${error}`);
          _log(`Skipped activity ${id} - ${error}`, 'error');
          continue;
        }

        try {
          const html = _fillTemplate(_templateText, _buildTemplateContext(data));
          const blob = await _renderHtmlToPdfBlob(html, opts);
          outputs.push({ id, blob, fileName: `activity-${_safeName(id)}.pdf` });
          _log(`Rendered activity ${id}`, 'success');
        } catch (renderErr) {
          errors.push(`Activity ${id}: ${renderErr.message}`);
          _log(`Failed render for ${id} - ${renderErr.message}`, 'error');
        }
      }

      if (outputs.length === 0) {
        throw new Error('No files were generated. Check warnings and template placeholders.');
      }

      if (outputs.length === 1) {
        _outputBlob = outputs[0].blob;
        _outputName = outputs[0].fileName;
        _outputType = 'pdf';
        _setDownloadLabel('Download PDF');
      } else {
        if (!window.JSZip) throw new Error('JSZip library is not available.');
        const zip = new JSZip();
        for (const item of outputs) zip.file(item.fileName, item.blob);
        _outputBlob = await zip.generateAsync({ type: 'blob' });
        _outputName = `ofs-activities-${new Date().toISOString().slice(0, 10)}.zip`;
        _outputType = 'zip';
        _setDownloadLabel('Download ZIP');
      }

      _showPanel('previewResults');
      const summary = document.getElementById('resultSummary');
      if (summary) {
        summary.textContent =
          `${outputs.length} file${outputs.length === 1 ? '' : 's'} ready ` +
          `for ${outputs.length} activit${outputs.length === 1 ? 'y' : 'ies'}.`;
      }

      const errBox = document.getElementById('resultErrors');
      const errList = document.getElementById('errorList');
      if (errors.length > 0 && errBox && errList) {
        errBox.classList.remove('d-none');
        errList.innerHTML = errors
          .map(e => `<li><i class="bi bi-exclamation-circle text-warning me-1"></i>${OFSApp.escHtml(e)}</li>`)
          .join('');
      } else {
        errBox?.classList.add('d-none');
      }

      _log(`Done - ${outputs.length} output ${_outputType.toUpperCase()} ready.`, 'success');
    } catch (e) {
      _showPanel('previewError');
      const msgEl = document.getElementById('errorMessage');
      if (msgEl) msgEl.textContent = e.message;
      _log(`Error: ${e.message}`, 'error');
    } finally {
      document.getElementById('generatePdf').disabled = false;
    }
  }

  function _setDownloadLabel(text) {
    const label = document.getElementById('downloadLabel');
    if (label) label.textContent = text;
  }

  function _fillTemplate(template, context) {
    // Support encoded placeholders often found in copied templates.
    const normalized = template
      .replace(/%7B%7B/g, '{{')
      .replace(/%7D%7D/g, '}}');

    return normalized.replace(/{{\s*([^{}]+?)\s*}}/g, (_, expression) => {
      const key = expression.trim();
      let value = _resolve(context, key);
      if (value === undefined && key.startsWith('activity.')) {
        value = _resolve(context.activity || {}, key.slice('activity.'.length));
      }
      if (value === undefined) {
        value = _resolve(context.activity || {}, key);
      }
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });
  }

  function _buildTemplateContext(activity) {
    return {
      activity,
      resource: activity.resource || {},
      signature: activity.signature || activity.customerSignature || '',
      tech_signature: activity.tech_signature || activity.technicianSignature || '',
      reported_duration: activity.reported_duration || activity.duration || '',
    };
  }

  async function _renderHtmlToPdfBlob(html, opts) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: opts.orient,
      unit: 'mm',
      format: opts.pageSize,
    });

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    host.style.width = `${_getRenderWidthPx(opts)}px`;
    host.style.background = '#ffffff';
    host.innerHTML = html;
    document.body.appendChild(host);

    try {
      await new Promise((resolve, reject) => {
        doc.html(host, {
          x: 0,
          y: 0,
          margin: [0, 0, 0, 0],
          autoPaging: 'text',
          html2canvas: {
            scale: 0.9,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
          },
          callback: () => resolve(),
        });

        setTimeout(() => reject(new Error('Timed out while rendering HTML template to PDF.')), 60000);
      });
    } finally {
      document.body.removeChild(host);
    }

    return doc.output('blob');
  }

  function _getRenderWidthPx(opts) {
    const widthMm = PAGE_WIDTH_MM[opts.pageSize] || PAGE_WIDTH_MM.a4;
    const width = opts.orient === 'landscape' ? 297 : widthMm;
    return Math.round((width / 25.4) * 96);
  }

  function _resolve(obj, path) {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
  }

  function _safeName(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  function _download() {
    if (!_outputBlob || !_outputName) return;
    const url = URL.createObjectURL(_outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = _outputName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { init };
})();
