'use strict';
const { archive } = require('./charx_fixture');
function pdf() {
  const stream = 'BT /F1 12 Tf 40 100 Td (PDF attachment text) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, index) => { offsets.push(text.length); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = text.length;
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(text + `trailer\n<< /Root 1 0 R /Size ${offsets.length} >>\nstartxref\n${xref}\n%%EOF\n`);
}
const epub = archive({
  'mimetype': 'application/epub+zip',
  'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
  'OPS/book.opf': '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>',
  'OPS/a.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body>第二章\n文本 A</body></html>',
  'OPS/b.xhtml': '<html xmlns="http://www.w3.org/1999/xhtml"><body>第一章\n文本 B</body></html>',
});
const article = '<html><head><title>资料文章</title></head><body><nav>导航条</nav><article><h1>资料文章</h1>' +
  Array.from({ length: 8 }, (_, index) => '<p>' + ('第 ' + index + ' 段有足够长的内容，用于正文提取。').repeat(30) + '</p>').join('') + '</article></body></html>';
module.exports = { pdf: pdf(), epub, article };
