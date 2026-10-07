Tender Package Builder

A frontend-only web app that helps office staff turn a set of tender PDFs into one complete, checked and correctly ordered PDF package, ready to submit. Works fully in Bangla and English.

- **Name:** Kamruzzaman Amit
- **Live link:** https://kamruzzaman-cse.github.io/tender-package-builder/
- **Built at:** AI Dev Fest 2026 — Vibe Coding Competition (DIU CPC, Daffodil International University), solo, in 90 minutes

## How to use

1. Click **Open requirements.json** and choose the tender's `requirements.json`.
2. Add all PDF files (click the box or drag and drop).
3. Choose the right file for each document (or click **Auto-match by file name**), and enter expiry dates where asked.
4. When every status is OK or Not provided, click **Generate package**. The file downloads as `<tender_id>_Package.pdf`.

## Features

- Loads `requirements.json`, shows tender details and the document list sorted by `order`
- Uploads many PDFs at once, shows file name and page count
- Rejects non-PDF files (checked by file content, not only the name)
- One file per document, change or undo any match at any time
- Live status for every document: Missing, Expiry date needed, Expired, Not provided, OK
- Duplicate detection by SHA-256 content hash, even with different file names
- Generate button stays disabled while any problem exists, with a list of reasons
- Generated PDF: English cover page, index, documents in order, and a `<tender_id> | Page X of Y` footer on every page that never covers the original content
- Full Bangla / English switch
- Export checklist as CSV, auto-match by file name, auto-save in the browser
- Damaged or password-protected PDFs show a clear message instead of crashing
- All files stay in the browser; nothing is uploaded to any server

## Tech

HTML, CSS, JavaScript, [pdf-lib](https://pdf-lib.js.org/). Built with the help of Claude (Anthropic).

## License

MIT
