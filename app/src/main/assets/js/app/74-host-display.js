function hostDisplayIndex(session, value) {
  var rows = session.msgs || [],
    index;
  if (value == null || value === 'last') index = rows.length - 1;
  else if (value === 'last_user' || value === 'last_char')
    index = rows.findLastIndex(function (row) {
      return row.role === (value === 'last_user' ? 'user' : 'assistant');
    });
  else if (typeof value === 'number' && Number.isInteger(value)) index = value < 0 ? rows.length + value : value;
  if (index == null || index < 0 || index >= rows.length) throw new Error('消息楼层不存在：' + String(value));
  return index;
}
function hostDisplayFormat(live, text, option) {
  var context = cardFrontendRequireCurrent(live),
    index = hostDisplayIndex(context.session, option && option.message_id),
    message = context.session.msgs[index],
    role = message.role,
    source = promptTemplateDisplayText(String(text), role, context.char, message),
    formatted = hostWriteFormatRegexedString(live, {
      text: source,
      source: role === 'user' ? 'user_input' : 'ai_output',
      destination: 'display',
      option: { depth: regexScriptMessageDepths(context.session.msgs)[index] },
    });
  var html = md(cleanDisplayText(formatted, role), {
    role: role,
    preserveImages: true,
    mediaAssets: context.char.media_assets || [],
    mediaOwnerId: context.char.id,
  });
  return promptTemplateDisplayHtml(html, String(text), role, context.char, message);
}
async function hostDisplayRefresh(live, value) {
  var context = cardFrontendRequireCurrent(live),
    index = hostDisplayIndex(context.session, value),
    message = context.session.msgs[index],
    depth = regexScriptMessageDepths(context.session.msgs)[index];
  _promptTemplateRenderCache.delete(message);
  await promptTemplateAwaitRender(message, function () {
    return messageHtml(context.char, message, index, null, depth);
  });
  var cache = _promptTemplateRenderCache.get(message);
  await prepareRegexScriptDisplayTexts(context.char, context.session.msgs);
  if (cache)
    await prepareRegexScriptTexts(
      context.char,
      Array.from(cache.values())
        .filter(function (row) {
          return row.state === 'ready' && row.renderState;
        })
        .map(function (row) {
          return {
            text: row.value,
            message: message,
            role: message.role,
            phase: 'display',
            index: index,
            depth: depth,
          };
        })
    );
  cardFrontendRequireCurrent(live);
  if (context.session.msgs[index] !== message) throw new Error('刷新期间消息已改变');
  renderChat();
  await cardFrontendAwaitBroadcastEvent(
    message.role === 'user' ? 'user_message_rendered' : 'character_message_rendered',
    [index]
  );
}
function hostDisplayCall(live, name, args) {
  if (name === 'formatAsDisplayedMessage')
    return { handled: true, value: hostDisplayFormat(live, args.text, args.option) };
  if (name === 'refreshOneMessage') return { handled: true, value: hostDisplayRefresh(live, args.id) };
  if (name === 'retrieveDisplayedMessage') {
    cardFrontendRequireCurrent(live);
    var id = Number(args.id);
    return {
      handled: true,
      value: Number.isInteger(id) ? document.querySelectorAll('[data-msg-idx="' + id + '"] .msg-bubble') : [],
    };
  }
  return null;
}
