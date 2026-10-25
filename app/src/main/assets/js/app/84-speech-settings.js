// Global speech shares the settings save transaction; character overrides use their own modal.
var _speechEditor = null,
  _speechGlobalEditor = null;
function activeSpeechEditor() {
  return _speechEditor || _speechGlobalEditor;
}
function speechEditorRoot(editor) {
  return $(editor.charId ? 'speech-settings-fields' : 'speech-global-fields');
}
function loadGlobalSpeechEditor() {
  _speechGlobalEditor = { config: copyJsonData(speechConfiguration(null)), readFull: !!speechSettings().readFull };
  renderSpeechEditor(_speechGlobalEditor);
}
function globalSpeechSettingsDraft() {
  if (!_speechGlobalEditor) return D.settings.speech;
  captureSpeechEditor(_speechGlobalEditor);
  speechRequest(_speechGlobalEditor.config, '语音测试');
  return Object.assign({}, speechSettings(), {
    voice: copyJsonData(_speechGlobalEditor.config),
    readFull: _speechGlobalEditor.readFull,
  });
}
function openSpeechSettings() {
  var char = getChar();
  if (!char) return;
  var settings = speechSettings();
  _speechEditor = {
    charId: char.id,
    override: !!(settings.characters && settings.characters[char.id]),
    config: copyJsonData(speechConfiguration(char)),
  };
  $('speech-settings-title').textContent = '角色声音 · ' + char.name;
  renderSpeechEditor();
  openModal('speech-settings-modal');
}
function speechSwitchField(id, label, checked, hint, onChange) {
  return (
    '<div class="fg switch-field"><label class="switch-row" for="' +
    id +
    '"><span class="switch-copy"><strong>' +
    esc(label) +
    '</strong>' +
    (hint ? '<small>' + esc(hint) + '</small>' : '') +
    '</span><input id="' +
    id +
    '" type="checkbox"' +
    (checked ? ' checked' : '') +
    (onChange ? ' onchange="' + onChange + '"' : '') +
    '><span class="switch-control" aria-hidden="true"></span></label></div>'
  );
}
function speechEditorField(editor, voice, key, label, options) {
  options = options || {};
  var id = (editor.charId ? 'speech-field-' : 'speech-global-field-') + key,
    value = voice[key] == null ? '' : voice[key],
    input;
  if (options.choices) {
    input =
      '<select id="' +
      id +
      '">' +
      options.choices
        .map(function (entry) {
          return (
            '<option value="' +
            escAttr(entry[0]) +
            '"' +
            (String(value) === entry[0] ? ' selected' : '') +
            '>' +
            esc(entry[1]) +
            '</option>'
          );
        })
        .join('') +
      '</select>';
  } else if (options.type === 'checkbox') {
    return speechSwitchField(id, label, value, options.hint);
  } else if (options.type === 'textarea') {
    input =
      '<textarea id="' +
      id +
      '" rows="3" placeholder="' +
      escAttr(options.placeholder || '') +
      '">' +
      esc(String(value)) +
      '</textarea>';
  } else {
    input =
      '<input id="' +
      id +
      '" type="' +
      (options.type || 'text') +
      '" value="' +
      escAttr(String(value)) +
      '"' +
      (options.min != null
        ? ' min="' + options.min + '" max="' + options.max + '" step="' + (options.step || 1) + '"'
        : '') +
      (options.type === 'password' ? ' autocomplete="off"' : '') +
      '>';
  }
  return (
    '<div class="fg"><label for="' +
    id +
    '">' +
    esc(label) +
    '</label>' +
    input +
    (options.hint ? '<div class="hint">' + esc(options.hint) + '</div>' : '') +
    '</div>'
  );
}
function captureSpeechEditor(editor) {
  editor = editor || activeSpeechEditor();
  if (!editor) return;
  var resolved = speechResolvedVoice(editor.config),
    protocol = resolved.protocol,
    voice = resolved.voice;
  speechEditorRoot(editor)
    .querySelectorAll('[id*="field-"]')
    .forEach(function (input) {
      voice[input.id.split('field-')[1]] =
        input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    });
  editor.config[protocol] = voice;
  if (!editor.charId) editor.readFull = $('speech-read-full').checked;
}
function changeSpeechProtocol(value) {
  captureSpeechEditor();
  activeSpeechEditor().config.protocol = value;
  renderSpeechEditor();
}
function changeSpeechOverride(value) {
  captureSpeechEditor();
  _speechEditor.override = value;
  renderSpeechEditor();
}
function renderSpeechEditor(editor) {
  editor = editor || activeSpeechEditor();
  var resolved = speechResolvedVoice(editor.config),
    protocol = resolved.protocol,
    field = speechEditorField.bind(null, editor, resolved.voice),
    common =
      field('apiUrl', '接口地址', { hint: '可填基础地址或完整语音端点。' }) +
      field('apiKey', 'API Key', { type: 'password' }) +
      field('model', '模型') +
      field('voice', '音色 ID'),
    advanced = field('speed', '语速', {
      type: 'number',
      min: protocol === 'openai' ? 0.25 : 0.5,
      max: protocol === 'openai' ? 4 : 2,
      step: 0.01,
    });
  if (protocol === 'openai') {
    advanced += field('customVoice', '使用自定义声音 ID', { type: 'checkbox' });
    advanced += field('instructions', '风格指令', {
      type: 'textarea',
      hint: '填写语气、情绪或口音要求；需模型支持，tts-1 系列不支持。',
    });
  } else {
    advanced += field('vol', '音量（大于 0）', { type: 'number', min: 0, max: 10, step: 0.01 });
    advanced += field('pitch', '音调', { type: 'number', min: -12, max: 12 });
    advanced += field('emotion', '情绪', {
      choices: [
        ['', '自动'],
        ['happy', '高兴'],
        ['sad', '悲伤'],
        ['angry', '生气'],
        ['fearful', '害怕'],
        ['disgusted', '厌恶'],
        ['surprised', '惊讶'],
        ['calm', '平静'],
        ['fluent', '流畅'],
        ['whisper', '低语'],
      ],
      hint: '自动根据文本判断；流畅与低语等可用项取决于模型。',
    });
    advanced += field('language', '语言增强', {
      hint: 'auto 自动；Chinese 普通话；Chinese,Yue 粤语；也可填写服务支持的其他语言。',
    });
    advanced += field('normalization', '数字与文本读法', {
      choices: [
        ['', '默认'],
        ['basic', '基础规范化'],
        ['quality', '高质量规范化'],
      ],
      hint: '高质量可能增加等待时间，需模型支持。',
    });
    advanced += field('latex', '朗读 LaTeX 公式（中文）', { type: 'checkbox' });
    advanced += field('modifyPitch', '声音深沉 / 明亮', { type: 'number', min: -100, max: 100 });
    advanced += field('intensity', '声音强劲 / 柔和', { type: 'number', min: -100, max: 100 });
    advanced += field('timbre', '声音浑厚 / 清脆', { type: 'number', min: -100, max: 100 });
    advanced += field('effect', '声音效果', {
      choices: [
        ['', '无'],
        ['spacious_echo', '空旷回声'],
        ['auditorium_echo', '礼堂回声'],
        ['lofi_telephone', '电话音效'],
        ['robotic', '机器人'],
      ],
    });
    advanced += field('pronunciation', '读音词典', {
      type: 'textarea',
      placeholder: '处理/(chu3)(li3)',
      hint: '每行一条：原文/读法。',
    });
    advanced += field('mix', '混合音色', {
      type: 'textarea',
      placeholder: 'female-shaonv/70\nfemale-chengshu/30',
      hint: '最多 4 行：音色ID/权重（1～100）。填写后替代上方单一音色。',
    });
  }
  speechEditorRoot(editor).innerHTML =
    '<section class="ui-section">' +
    (editor.charId
      ? speechSwitchField(
          'speech-override',
          '此角色使用独立声音配置',
          editor.override,
          '关闭时沿用全局默认声音。',
          'changeSpeechOverride(this.checked)'
        )
      : speechSwitchField('speech-read-full', '读全文', editor.readFull, '关闭时只读引号内对白。')) +
    '</section><fieldset class="speech-fields ui-section"' +
    (editor.charId && !editor.override ? ' disabled' : '') +
    '><div class="fg"><label for="' +
    (editor.charId ? 'speech-protocol' : 'speech-global-protocol') +
    '">协议</label><select id="' +
    (editor.charId ? 'speech-protocol' : 'speech-global-protocol') +
    '" onchange="changeSpeechProtocol(this.value)"><option value="minimax"' +
    (protocol === 'minimax' ? ' selected' : '') +
    '>MiniMax</option><option value="openai"' +
    (protocol === 'openai' ? ' selected' : '') +
    '>OpenAI 兼容</option></select></div>' +
    common +
    '<details class="ui-fold"><summary><span class="ui-fold-title">高级</span></summary>' +
    advanced +
    '</details></fieldset>';
}
async function saveSpeechSettings() {
  if (!_speechEditor) return;
  captureSpeechEditor();
  var editor = _speechEditor,
    before = D.settings.speech,
    next = copyJsonData(speechSettings());
  try {
    if (editor.override) speechRequest(editor.config, '语音测试');
    if (
      !D.characters.some(function (char) {
        return char.id === editor.charId;
      })
    )
      throw new Error('角色已不存在');
    next.characters = Object.assign({}, next.characters);
    if (editor.override) next.characters[editor.charId] = copyJsonData(editor.config);
    else delete next.characters[editor.charId];
    D.settings.speech = next;
    await saveData('meta');
    stopSpeech();
    closeModal('speech-settings-modal');
    toast('语音设置已保存', 'ok');
  } catch (error) {
    if (D.settings.speech === next) D.settings.speech = before;
    toast(error.message, 'err');
  }
}
async function previewSpeechVoice() {
  captureSpeechEditor();
  var editor = activeSpeechEditor(),
    config = editor.charId && !editor.override ? speechSettings().voice || { protocol: 'minimax' } : editor.config;
  await speechPlay('你好，很高兴与你见面。', getChar(), null, config);
}
