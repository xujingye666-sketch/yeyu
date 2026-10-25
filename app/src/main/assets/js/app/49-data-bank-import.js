/* global pdfjsLib, Readability, isProbablyReaderable */
// Loaded on demand from js/vendor/pdf-4.7.76.js and readability-0.6.0.js.
// ===== Attachment extraction using local browser capabilities =====
var _dataBankLibraryLoads = new Map();
function dataBankLoadLibrary(path) {
  if (!_dataBankLibraryLoads.has(path)) {
    var pending = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = path;
      script.onload = resolve;
      script.onerror = function () {
        script.remove();
        reject(new Error('附件解析器加载失败，请重试'));
      };
      document.head.appendChild(script);
    }).catch(function (error) {
      _dataBankLibraryLoads.delete(path);
      throw error;
    });
    _dataBankLibraryLoads.set(path, pending);
  }
  return _dataBankLibraryLoads.get(path);
}
function dataBankProcessText(text, collapse) {
  text = String(text)
    .replace(/\r/g, '')
    .replace(/[\t\u00a0]/g, ' ');
  if (collapse !== false)
    text = text
      .split('\n')
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean)
      .join('\n');
  else
    text = text
      .replace(/\n{4,}/g, '\n\n\n\n')
      .split('\n')
      .map(function (line) {
        return /^\s+$/.test(line) ? '' : line;
      })
      .join('\n');
  return text.replace(/ {2,}/g, ' ').trim();
}
function dataBankXML(text) {
  var doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('附件 XML 无法解析');
  return doc;
}
function dataBankMarkupText(root) {
  var parts = [],
    blocks = new Set([
      'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset',
      'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
      'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'td', 'th', 'tr', 'ul',
    ]);
  function visit(node) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      parts.push(node.nodeValue);
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName.toLowerCase();
    if (['script', 'style', 'template'].includes(tag)) return;
    if (tag === 'br') {
      parts.push('\n');
      return;
    }
    var block = blocks.has(tag);
    if (block) parts.push('\n');
    Array.from(node.childNodes).forEach(visit);
    if (block) parts.push('\n');
  }
  visit(root);
  return dataBankProcessText(parts.join(''));
}
async function dataBankExtractFile(file) {
  var ext = String(file.name || '')
    .split('.')
    .pop()
    .toLowerCase();
  if (ext === 'pdf' || file.type === 'application/pdf') {
    await dataBankLoadLibrary('js/vendor/pdf-4.7.76.js');
    await dataBankLoadLibrary('js/vendor/pdf-worker-4.7.76.js');
    var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false })
        .promise,
      pages = [];
    try {
      for (var index = 1; index <= pdf.numPages; index++) {
        var page = await pdf.getPage(index),
          content = await page.getTextContent();
        pages.push(
          content.items
            .map(function (item) {
              return item.str;
            })
            .join(' ')
        );
      }
      return dataBankProcessText(pages.join('\n'));
    } finally {
      await pdf.destroy();
    }
  }
  if (ext === 'epub' || file.type === 'application/epub+zip') {
    var zip = await YeyuCharx.openArchive(await file.arrayBuffer(), 'EPUB');
    async function entry(path) {
      var row = zip.entries.find(function (row) {
        return row.path === path;
      });
      if (!row) throw new Error('EPUB 缺少文件：' + path);
      return new TextDecoder().decode(await zip.read(row));
    }
    var container = dataBankXML(await entry('META-INF/container.xml')),
      rootfile = container.getElementsByTagNameNS('*', 'rootfile')[0],
      opfPath = rootfile && YeyuCharx.normalizePath(rootfile.getAttribute('full-path'));
    if (!opfPath) throw new Error('EPUB 缺少内容目录');
    var opf = dataBankXML(await entry(opfPath)),
      base = opfPath.substring(0, opfPath.lastIndexOf('/') + 1),
      items = Array.from(opf.getElementsByTagNameNS('*', 'item')),
      chapters = [];
    for (var ref of Array.from(opf.getElementsByTagNameNS('*', 'itemref'))) {
      var item = items.find(function (item) {
        return item.getAttribute('id') === ref.getAttribute('idref');
      });
      if (!item) throw new Error('EPUB 章节目录无效');
      var chapter = dataBankXML(
          await entry(YeyuCharx.normalizePath(base + decodeURIComponent(item.getAttribute('href').split('#')[0])))
        ),
        body = chapter.getElementsByTagNameNS('*', 'body')[0];
      if (body) {
        var text = dataBankMarkupText(body);
        if (text) chapters.push(text);
      }
    }
    return dataBankProcessText(chapters.join('\n'), false);
  }
  if (['html', 'htm'].includes(ext) || file.type === 'text/html') {
    await dataBankLoadLibrary('js/vendor/readability-0.6.0.js');
    var doc = new DOMParser().parseFromString(DOMPurify.sanitize(await file.text()), 'text/html');
    if (isProbablyReaderable(doc)) {
      var article = new Readability(doc).parse();
      if (!article) throw new Error('无法解析 HTML 正文，请另存为文本后导入');
      doc = new DOMParser().parseFromString(article.content, 'text/html');
    }
    return dataBankMarkupText(doc.body);
  }
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'].includes(ext))
    throw new Error('请先将 Office 文档导出为 PDF 或文本，再导入资料库');
  if (['md', 'markdown'].includes(ext) || file.type === 'text/markdown')
    return dataBankProcessText(await file.text(), false);
  if (
    file.type &&
    !file.type.startsWith('text/') &&
    !['application/json', 'application/xml', 'application/javascript'].includes(file.type)
  )
    throw new Error('无法提取此文件的文本，请导入文本、HTML、PDF 或 EPUB');
  return file.text();
}
