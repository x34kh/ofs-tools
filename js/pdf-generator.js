/**
 * pdf-generator.js – PDF Generator tool logic.
 *
 * Reads a list of OFS activity IDs and a JSON form configuration from the UI,
 * fetches each activity from the OFS REST API, populates the form template
 * in memory, and uses jsPDF to produce a downloadable PDF.
 *
 * Form configuration schema (JSON):
 * {
 *   "title": "Activity Service Report",      // PDF document title (optional)
 *   "sections": [
 *     {
 *       "title": "Section Name",             // Section heading
 *       "fields": [
 *         {
 *           "label":    "Customer Name",     // Human-readable label
 *           "property": "customerName",      // OFS activity field name
 *                                            // Supports dot-notation for nested: "links.0.href"
 *           "type":     "text"               // Optional: "text" | "date" | "multiline"
 *         }
 *       ]
 *     }
 *   ]
 * }
 *
 * OFS custom properties (prefixed c_) are supported in the same way.
 */
const PDFGenerator = (() => {

  /* ------------------------------------------------------------------ */
  /* Example form configuration shown when the user clicks "Load Example" */
  /* ------------------------------------------------------------------ */
  const EXAMPLE_CONFIG = {
    title: 'Activity Service Report',
    sections: [
      {
        title: 'Activity Information',
        fields: [
          { label: 'Activity ID',   property: 'activityId'   },
          { label: 'Status',        property: 'status'       },
          { label: 'Date',          property: 'date'         },
          { label: 'Duration (min)', property: 'duration'   },
          { label: 'Appt. Number',  property: 'apptNumber'  },
          { label: 'Time Zone',     property: 'timeZone'    },
        ],
      },
      {
        title: 'Customer Information',
        fields: [
          { label: 'Customer Name',  property: 'customerName'  },
          { label: 'Phone',          property: 'customerPhone' },
          { label: 'Email',          property: 'customerEmail' },
        ],
      },
      {
        title: 'Location',
        fields: [
          { label: 'Address',  property: 'address' },
          { label: 'City',     property: 'city'    },
          { label: 'State',    property: 'state'   },
          { label: 'Zip',      property: 'zip'     },
        ],
      },
      {
        title: 'Notes',
        fields: [
          { label: 'Activity Note', property: 'activityNote', type: 'multiline' },
        ],
      },
    ],
  };

  /* ------------------------------------------------------------------ */
  /* Theme / layout constants                                            */
  /* ------------------------------------------------------------------ */
  const THEME = {
    headerBg:    [52,  86, 155],   // dark-blue section headers
    headerText:  [255, 255, 255],
    rowEven:     [245, 247, 251],  // alternating row shading
    labelColor:  [60,  60,  80],
    valueColor:  [30,  30,  30],
    mutedColor:  [140, 140, 150],
    lineColor:   [200, 200, 210],
    titleColor:  [33,  37,  41],
    accentColor: [52,  86, 155],
  };

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  let _generatedBlob = null;

  /* ------------------------------------------------------------------ */
  /* Initialise – bind DOM events                                        */
  /* ------------------------------------------------------------------ */
  function init() {
    OFSApp.initPage();

    const activityIdsEl   = document.getElementById('activityIds');
    const formConfigEl    = document.getElementById('formConfig');
    const loadExampleBtn  = document.getElementById('loadExampleConfig');
    const generateBtn     = document.getElementById('generatePdf');
    const downloadBtn     = document.getElementById('downloadPdf');
    const generateAgainBtn = document.getElementById('generateAgain');

    if (activityIdsEl) activityIdsEl.addEventListener('input', _updateCount);
    if (formConfigEl)  formConfigEl.addEventListener('input', _validateConfigUI);
    if (loadExampleBtn) loadExampleBtn.addEventListener('click', _loadExample);
    if (generateBtn)    generateBtn.addEventListener('click', _onGenerate);
    if (downloadBtn)    downloadBtn.addEventListener('click', _download);
    if (generateAgainBtn) generateAgainBtn.addEventListener('click', () => _showPanel('previewEmpty'));

    _updateCount();
  }

  /* ------------------------------------------------------------------ */
  /* UI helpers                                                          */
  /* ------------------------------------------------------------------ */

  function _updateCount() {
    const countEl = document.getElementById('activityCount');
    if (countEl) countEl.textContent = _getIds().length;
  }

  function _getIds() {
    const el = document.getElementById('activityIds');
    if (!el) return [];
    return el.value.split('\n').map(s => s.trim()).filter(Boolean);
  }

  function _validateConfigUI() {
    const el      = document.getElementById('formConfig');
    const errEl   = document.getElementById('configError');
    if (!el) return null;

    const text = el.value.trim();
    if (!text) { errEl && errEl.classList.add('d-none'); return null; }

    try {
      const cfg = JSON.parse(text);
      errEl && errEl.classList.add('d-none');
      return cfg;
    } catch (e) {
      if (errEl) {
        errEl.textContent = `Invalid JSON: ${e.message}`;
        errEl.classList.remove('d-none');
      }
      return null;
    }
  }

  function _loadExample() {
    const el = document.getElementById('formConfig');
    if (el) {
      el.value = JSON.stringify(EXAMPLE_CONFIG, null, 2);
      _validateConfigUI();
    }
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
    const bar  = document.getElementById('progressBar');
    const text = document.getElementById('progressText');
    if (bar)  bar.style.width = `${pct}%`;
    if (text) text.textContent = msg || `${cur} / ${total}`;
    _log(msg);
  }

  /* ------------------------------------------------------------------ */
  /* Main generate handler                                               */
  /* ------------------------------------------------------------------ */
  async function _onGenerate() {
    const ids = _getIds();
    if (ids.length === 0) {
      OFSApp.showToast('Enter at least one Activity ID.', 'warning');
      return;
    }

    const config = _validateConfigUI();
    if (!config) {
      OFSApp.showToast('Fix the JSON configuration errors before generating.', 'warning');
      return;
    }

    const creds = OFSApp.getStoredCredentials();
    if (!creds) {
      OFSApp.showToast('OFS credentials are not set. Please configure them on the Home page.', 'danger');
      return;
    }

    const opts = {
      pageSize:   document.getElementById('pageSize')?.value || 'a4',
      orient:     document.getElementById('pageOrientation')?.value || 'portrait',
      skipEmpty:  document.getElementById('skipEmptyFields')?.checked ?? false,
      onePerPage: document.getElementById('onePerPage')?.checked ?? true,
    };

    _showPanel('previewProgress');
    document.getElementById('progressLog').innerHTML = '';
    document.getElementById('generatePdf').disabled = true;
    _generatedBlob = null;

    const errors     = [];
    const successIds = [];

    try {
      _log(`Starting – ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'} requested.`, 'info');

      /* ---- Phase 1: Fetch ---- */
      const { results } = await OFSAPI.getActivities(
        creds, ids,
        (cur, total, msg) => _progress(cur, total * 2, msg)
      );

      /* ---- Phase 2: Render PDF ---- */
      _log('Building PDF…', 'info');

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({
        orientation: opts.orient,
        unit:        'mm',
        format:      opts.pageSize,
      });

      let pageCount = 0;

      for (let i = 0; i < results.length; i++) {
        const { id, data, error } = results[i];
        _progress(results.length + i + 1, results.length * 2,
          `Rendering page for activity ${id}…`);

        if (error) {
          errors.push(`Activity ${id}: ${error}`);
          _log(`⚠ Skipped activity ${id} – ${error}`, 'error');
          continue;
        }

        if (pageCount > 0 && opts.onePerPage) doc.addPage();
        _renderPage(doc, data, config, opts);
        successIds.push(id);
        pageCount++;
        _log(`✓ Rendered activity ${id}`, 'success');
      }

      if (pageCount === 0) {
        throw new Error('No pages were generated. Check the errors in the log above.');
      }

      _generatedBlob = doc.output('blob');

      /* ---- Show results ---- */
      _showPanel('previewResults');
      const summary = document.getElementById('resultSummary');
      if (summary) summary.textContent =
        `${pageCount} ${pageCount === 1 ? 'page' : 'pages'} generated for ${successIds.length} ${successIds.length === 1 ? 'activity' : 'activities'}.`;

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

      _log(`Done – ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} in PDF.`, 'success');

    } catch (e) {
      _showPanel('previewError');
      const msgEl = document.getElementById('errorMessage');
      if (msgEl) msgEl.textContent = e.message;
      _log(`Error: ${e.message}`, 'error');
    } finally {
      document.getElementById('generatePdf').disabled = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* PDF page rendering                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Render one activity onto the current jsPDF page.
   */
  function _renderPage(doc, activity, config, opts) {
    const PW   = doc.internal.pageSize.getWidth();
    const PH   = doc.internal.pageSize.getHeight();
    const M    = 14;          // page margin (mm)
    const CW   = PW - M * 2; // content width
    let   y    = M;

    /* ---- Document title ---- */
    const reportTitle = config.title || 'Activity Report';
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    _setColor(doc, THEME.titleColor);
    doc.text(reportTitle, M, y + 7);
    y += 11;

    /* ---- Accent line under title ---- */
    _setDrawColor(doc, THEME.accentColor);
    doc.setLineWidth(0.8);
    doc.line(M, y, PW - M, y);
    y += 4;

    /* ---- Activity header row ---- */
    const actId   = _resolveStr(activity, 'activityId') || _resolveStr(activity, 'id') || '–';
    const actDate = _resolveStr(activity, 'date') || '–';
    const actStat = _resolveStr(activity, 'status') || '–';

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    _setColor(doc, THEME.mutedColor);
    doc.text(`Activity: ${actId}   |   Date: ${actDate}   |   Status: ${actStat}`, M, y + 4);
    doc.text(`Generated: ${new Date().toLocaleString()}`, PW - M, y + 4, { align: 'right' });
    y += 8;

    _setDrawColor(doc, THEME.lineColor);
    doc.setLineWidth(0.3);
    doc.line(M, y, PW - M, y);
    y += 5;

    /* ---- Sections ---- */
    for (const section of (config.sections || [])) {
      const fields = (section.fields || []).filter(f => {
        if (!f.property) return false;
        if (opts.skipEmpty) {
          const v = _resolve(activity, f.property);
          return v !== null && v !== undefined && v !== '';
        }
        return true;
      });

      if (fields.length === 0) continue;

      /* Section header band */
      if (y > PH - 30) { doc.addPage(); y = M; }

      _setFill(doc, THEME.headerBg);
      doc.roundedRect(M, y, CW, 7, 1, 1, 'F');
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      _setColor(doc, THEME.headerText);
      doc.text(section.title || 'Section', M + 3, y + 5);
      y += 10;

      /* Fields */
      const LABEL_W = CW * 0.36;
      const VALUE_X = M + LABEL_W + 2;
      const VALUE_W = CW - LABEL_W - 4;

      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const raw   = _resolve(activity, field.property);
        const disp  = _format(raw, field);

        const lines     = doc.setFontSize(9).splitTextToSize(disp, VALUE_W);
        const rowH      = Math.max(7, lines.length * 4.5 + 2);

        if (y + rowH > PH - 12) { doc.addPage(); y = M; }

        /* Alternating row shading */
        if (i % 2 === 0) {
          _setFill(doc, THEME.rowEven);
          doc.rect(M, y - 1, CW, rowH, 'F');
        }

        /* Label */
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        _setColor(doc, THEME.labelColor);
        const labelLines = doc.splitTextToSize(field.label || field.property, LABEL_W - 2);
        doc.text(labelLines, M + 2, y + 4);

        /* Value */
        doc.setFont('helvetica', 'normal');
        _setColor(doc, THEME.valueColor);
        doc.text(lines, VALUE_X, y + 4);

        y += rowH;
      }

      y += 3; // gap after section
    }

    /* ---- Footer ---- */
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'italic');
    _setColor(doc, THEME.mutedColor);
    doc.text(
      'Generated by OFS Tools – unofficial toolset, not affiliated with Oracle Corporation.',
      PW / 2, PH - 5, { align: 'center' }
    );
  }

  /* ------------------------------------------------------------------ */
  /* Data helpers                                                        */
  /* ------------------------------------------------------------------ */

  /** Resolve a (possibly dot-notation) property path from an object. */
  function _resolve(obj, path) {
    if (!path) return undefined;
    return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), obj);
  }

  function _resolveStr(obj, path) {
    const v = _resolve(obj, path);
    return (v !== null && v !== undefined) ? String(v) : '';
  }

  /** Format a raw value for display in the PDF. */
  function _format(value, field) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object')  return JSON.stringify(value, null, 2);
    return String(value);
  }

  /* ------------------------------------------------------------------ */
  /* jsPDF colour helpers (RGB arrays → setTextColor / setDrawColor …)  */
  /* ------------------------------------------------------------------ */
  function _setColor(doc, rgb) {
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  }
  function _setDrawColor(doc, rgb) {
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  }
  function _setFill(doc, rgb) {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  }

  /* ------------------------------------------------------------------ */
  /* Download handler                                                    */
  /* ------------------------------------------------------------------ */
  function _download() {
    if (!_generatedBlob) return;
    const url = URL.createObjectURL(_generatedBlob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `ofs-activities-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */
  return { init };
})();
