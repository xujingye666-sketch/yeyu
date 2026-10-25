async function hostMvuCall(live, name, args) {
  var context = cardFrontendRequireCurrent(live),
    char = context.char;
  if (mvuRuntimeOwner(char) === 'bundle') {
    var runtime = window.Mvu;
    if (!runtime || typeof runtime[name] !== 'function') throw new Error('卡片 MVU bundle 尚未提供 ' + name);
    return runtime[name].apply(runtime, args);
  }
  if (!mvuCanRun(char)) throw new Error('当前角色没有已启用的 MVU 运行区');
  await mvuEnsureSchema(char);
  cardFrontendRequireCurrent(live);
  if (name === 'parseMessage') {
    var output = cloneData(args[1]),
      result = await mvuApplyCandidate(char, output.stat_data || {}, String(args[0]));
    cardFrontendRequireCurrent(live);
    if (result.error) throw new Error(result.error);
    output.stat_data = result.state;
    return output;
  }
  if (name === 'reloadInitVar') {
    if (!mvuInitEntry(char)) return false;
    var source = mvuInitialSource(char);
    if (!source.trim()) return false;
    var initial = await mvuCall(char, { type: 'validate', value: mvuYamlValue(source) });
    cardFrontendRequireCurrent(live);
    args[0].stat_data = initial;
    return true;
  }
  if (name === 'setMvuVariable') {
    var data = args[0],
      path = self.YeyuMvuVendor._.toPath(args[1]),
      pointer =
        '/' +
        path
          .map(function (part) {
            return String(part).replace(/~/g, '~0').replace(/\//g, '~1');
          })
          .join('/'),
      before = self.YeyuMvuVendor._.get(data.stat_data, path);
    if (!self.YeyuMvuVendor._.has(data.stat_data, path)) return false;
    var updated = await mvuCall(char, {
      type: 'apply',
      base: data.stat_data,
      operations: [{ op: 'replace', path: pointer, value: args[2] }],
    });
    cardFrontendRequireCurrent(live);
    data.stat_data = updated;
    if (args[3] && args[3].is_recursive)
      await cardFrontendAwaitBroadcastEvent('mag_variable_updated', [data.stat_data, args[1], before, args[2]]);
    return true;
  }
  throw new Error('未知 MVU 操作：' + name);
}
