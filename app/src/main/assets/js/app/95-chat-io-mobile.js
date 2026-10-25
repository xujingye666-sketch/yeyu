// ===== Prompt preset export =====
function presetExportStatus() {
  return $('prompt-import-status');
}
function handlePresetSaveResult(result) {
  var text = String(result || ''),
    status = presetExportStatus();
  if (text.indexOf('OK:') === 0) {
    var path = text.slice(3);
    if (status)
      status.innerHTML = '<span class="status-line ok">' + uiIcon('check') + ' 已保存：' + esc(path) + '</span>';
    toast('提示词预设已保存到 ' + path, 'ok');
    return 'ok';
  }
  var message = text.replace(/^ERR:/, '') || '未知错误';
  if (status)
    status.innerHTML = '<span class="status-line err">' + uiIcon('alert') + ' 导出失败：' + esc(message) + '</span>';
  toast('导出失败：' + message, 'err');
  return 'error';
}
function downloadBlobFile(blob, filename) {
  var url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 3000);
}
function saveTextFileExport(content, filename, mime, nativeTitle, downloadMessage) {
  try {
    if (window.AndroidBridge && typeof AndroidBridge.saveFile === 'function')
      return handlePresetSaveResult(AndroidBridge.saveFile(content, filename, mime, nativeTitle));
    downloadBlobFile(new Blob([content], { type: mime }), filename);
    var status = presetExportStatus();
    if (status)
      status.innerHTML =
        '<span class="status-line ok">' + uiIcon('check') + ' 已提交浏览器下载：' + esc(filename) + '</span>';
    toast(downloadMessage || '已提交浏览器下载', 'ok');
  } catch (error) {
    handlePresetSaveResult('ERR:' + error.message);
  }
}
