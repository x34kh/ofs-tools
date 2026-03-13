# ofs-tools

> **UNOFFICIAL** toolset for Oracle Field Service – not affiliated with or endorsed by Oracle Corporation.

A static HTML/JS UI hosted on GitHub Pages that lets you interact with your Oracle Field Service (OFS) REST API directly from your browser.

## Live site

Hosted via GitHub Pages on the `main` branch root.  
Enable GitHub Pages in your repository settings → *Source: Deploy from a branch → main → / (root)*.

---

## Features

### 🔑 Credentials Manager (Home page)
- Enter your OFS instance URL, username, and password.
- Optional **Remember credentials** checkbox saves them to a browser cookie (30-day expiry).
- Credentials are stored **locally in your browser only** and never sent to any third party.
- Built-in **Test Connection** button to verify connectivity before running tools.

---

### 📄 PDF Generator (`pdf-generator.html`)

OFS generates activity forms client-side and does not provide a native bulk-export option.  
This tool fills that gap:

1. Paste a list of **Activity IDs** (one per line).
2. Provide a **JSON form configuration** describing which fields to include and how to label them.
3. Click **Generate PDF** – the tool fetches each activity from the OFS REST API, populates the form template in memory, and produces a ready-to-download PDF.

#### Form configuration schema

```json
{
  "title": "Activity Service Report",
  "sections": [
    {
      "title": "Customer Information",
      "fields": [
        { "label": "Customer Name",  "property": "customerName"  },
        { "label": "Phone",          "property": "customerPhone" },
        { "label": "Custom Field",   "property": "c_myCustomProp" }
      ]
    }
  ]
}
```

| Key | Description |
|-----|-------------|
| `title` | Overall report heading printed at the top of each page. |
| `sections[].title` | Section heading band in the PDF. |
| `fields[].label` | Human-readable label shown in the left column. |
| `fields[].property` | OFS activity field name. Supports dot-notation for nested values (`links.0.href`). Custom properties are prefixed `c_`. |
| `fields[].type` | Optional: `"text"` (default), `"multiline"`, `"date"`. |

A full example configuration is available via the **Load Example** button in the tool.

---

## CORS

Because the tool runs entirely in your browser, the OFS instance must permit cross-origin requests from the GitHub Pages URL (or wherever you host this).

**Options:**

1. **OFS CORS configuration** – Ask your OFS administrator to add the page URL to  
   *OFS Core → Configuration → Cross-Origin Resource Sharing*.

2. **Browser extension (local testing only)** – Use an extension such as *Allow CORS: Access-Control-Allow-Origin* to temporarily bypass CORS restrictions in your browser.

---

## Project structure

```
index.html            – Home page: credentials + tool navigation
pdf-generator.html    – PDF Generator tool
css/
  styles.css          – Shared styles
js/
  app.js              – Credentials management (cookies / sessionStorage) + UI helpers
  ofs-api.js          – OFS REST API client (Basic Auth, activity fetcher)
  pdf-generator.js    – Form config parser, activity renderer, jsPDF output
.nojekyll             – Disables GitHub Pages Jekyll processing
```

## Dependencies (CDN, no build step required)

| Library | Version | Purpose |
|---------|---------|---------|
| [Bootstrap](https://getbootstrap.com/) | 5.3.2 | UI framework |
| [Bootstrap Icons](https://icons.getbootstrap.com/) | 1.11.3 | Icon set |
| [jsPDF](https://github.com/parallax/jsPDF) | 2.5.1 | Client-side PDF generation |

All dependencies are loaded from public CDNs. No `npm install` or build step is needed – open the HTML files directly or serve them from any static host.

