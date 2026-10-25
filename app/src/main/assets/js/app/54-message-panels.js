// ===== Message-derived objective and announcement panels =====
var MESSAGE_PANEL_MAX_INPUT_CHARS = 1000000,
  MESSAGE_PANEL_MAX_BLOCKS = 24,
  MESSAGE_PANEL_SCAN_MAX_MESSAGES = 200,
  MESSAGE_PANEL_SCAN_MAX_CHARS = 200000,
  STORY_OBJECTIVE_MAX_BLOCKS = 24,
  STORY_OBJECTIVE_MAX_ITEMS = 40;

function messagePanelAssistantSource(value, char, message, displayOptions) {
  if (
    typeof isRisuCharacter === 'function' &&
    isRisuCharacter(char) &&
    message &&
    value === message.content &&
    typeof assistantMessageParts === 'function'
  )
    value = assistantMessageParts(message).content;
  var template =
      typeof promptTemplateDisplayText === 'function'
        ? promptTemplateDisplayText(value, 'assistant', char, message, displayOptions)
        : String(value || ''),
    display =
      typeof regexScriptDisplayText === 'function'
        ? regexScriptDisplayText(template, 'assistant', char, message, displayOptions)
        : template;
  display = cleanDisplayText(display, 'assistant', displayOptions || {});
  if (message && message.continued && storyObjectiveMatches(display).length > 1) {
    var latest = StoryDirection.extractBlocks(display);
    display =
      latest.body && latest.objective ? latest.body + '\n\n' + latest.objective : latest.body || latest.objective;
  }
  return display;
}
function storyObjectiveHeaderLine(value) {
  return /^\s*(?:\*\*\s*【剧情目标】\s*\*\*|【剧情目标】)\s*$/.test(String(value || ''));
}
function storyObjectiveFieldLine(value) {
  var match = /^\s*(目标|支线|已完成)\s*[：:]\s*(.*)$/.exec(String(value || ''));
  return match ? { key: match[1], value: String(match[2] || '').trim() } : null;
}
function storyObjectiveItemText(value) {
  return String(value || '')
    .replace(/^\s*[-*+•]\s*/, '')
    .trim();
}
function storyObjectiveMeaningfulItem(value) {
  var text = storyObjectiveItemText(value);
  return !!(text && !/^(?:无|暂无|没有|未有|无可记录|—|-)$/.test(text));
}
function storyObjectiveLineRecords(value) {
  var source = String(value || ''),
    rows = [],
    pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g,
    match;
  while ((match = pattern.exec(source))) {
    var raw = String(match[0] || '');
    if (!raw && match.index >= source.length) break;
    rows.push({ start: match.index, end: match.index + raw.length, text: raw.replace(/[\r\n]+$/, '') });
    if (!raw.length) break;
  }
  return rows;
}
function storyObjectiveMatches(value) {
  var source = String(value || ''),
    matches = [];
  if (!source || source.length > MESSAGE_PANEL_MAX_INPUT_CHARS) return matches;
  var lines = storyObjectiveLineRecords(source);
  for (var i = 0; i < lines.length && matches.length < STORY_OBJECTIVE_MAX_BLOCKS; i++) {
    if (!storyObjectiveHeaderLine(lines[i].text)) continue;
    var fields = { goals: [], branches: [], completed: [] },
      seen = Object.create(null),
      section = '',
      lastEnd = lines[i].end;
    for (var j = i + 1; j < lines.length; j++) {
      var text = String(lines[j].text || ''),
        trimmed = text.trim();
      if (!trimmed) continue;
      var field = storyObjectiveFieldLine(text),
        bullet = /^\s*[-*+•]\s+(.+)$/.exec(text);
      if (field) {
        section = field.key;
        seen[field.key] = true;
        if (field.value) {
          var inline = storyObjectiveItemText(field.value),
            target = field.key === '目标' ? fields.goals : field.key === '支线' ? fields.branches : fields.completed;
          if (target.length < STORY_OBJECTIVE_MAX_ITEMS) target.push(inline);
        }
        lastEnd = lines[j].end;
        continue;
      }
      if (bullet && (section === '目标' || section === '支线' || section === '已完成')) {
        var item = storyObjectiveItemText(bullet[1]),
          items = section === '目标' ? fields.goals : section === '支线' ? fields.branches : fields.completed;
        if (items.length < STORY_OBJECTIVE_MAX_ITEMS) items.push(item);
        lastEnd = lines[j].end;
        continue;
      }
      break;
    }
    if (
      ['目标', '支线', '已完成'].every(function (key) {
        return seen[key] === true;
      })
    ) {
      var parsed = { goals: fields.goals, branches: fields.branches, completed: fields.completed };
      matches.push({
        start: lines[i].start,
        end: lastEnd,
        content: source.slice(lines[i].start, lastEnd),
        kind: 'story-objective',
        parsed: parsed,
      });
    }
  }
  return matches;
}
function assistantPanelBracketLine(value) {
  var text = String(value || '').trim(),
    last = text.slice(-1),
    first = text.charAt(0);
  if (text.length < 2 || !((first === '[' && last === ']') || (first === '【' && last === '】'))) return null;
  return { text: text, inner: text.slice(1, -1).trim() };
}
function assistantPanelMatches(value, excludedMatches) {
  var source = String(value || ''),
    matches = [];
  if (!source || source.length > MESSAGE_PANEL_MAX_INPUT_CHARS) return matches;
  var lines = storyObjectiveLineRecords(source),
    fenceChar = '',
    fenceLength = 0,
    group = [];
  function overlapsExcluded(candidate) {
    return (Array.isArray(excludedMatches) ? excludedMatches : []).some(function (match) {
      return match && candidate.start < match.end && match.start < candidate.end;
    });
  }
  function flush() {
    if (group.length >= 2 && matches.length < MESSAGE_PANEL_MAX_BLOCKS) {
      var start = group[0].line.start,
        end = group[group.length - 1].line.end,
        candidate = {
          start: start,
          end: end,
          content: source.slice(start, end).replace(/[\r\n]+$/, ''),
          kind: 'assistant-panel',
          lineCount: group.length,
          summary: group[0].bracket.inner,
        };
      if (!overlapsExcluded(candidate)) matches.push(candidate);
    }
    group = [];
  }
  lines.forEach(function (line) {
    var marker = /^\s*(`{3,}|~{3,})/.exec(String(line.text || ''));
    if (marker) {
      flush();
      var token = marker[1],
        character = token.charAt(0);
      if (!fenceChar) {
        fenceChar = character;
        fenceLength = token.length;
      } else if (character === fenceChar && token.length >= fenceLength) {
        fenceChar = '';
        fenceLength = 0;
      }
      return;
    }
    if (fenceChar) {
      flush();
      return;
    }
    var bracket = assistantPanelBracketLine(line.text);
    if (!bracket) {
      flush();
      return;
    }
    group.push({ line: line, bracket: bracket });
  });
  flush();
  return matches;
}
function latestStoryObjectiveMatch(messages, char, options) {
  options = options || {};
  var rows = Array.isArray(messages) ? messages : [],
    end = Math.max(
      0,
      Math.min(rows.length, Number.isFinite(Number(options.endIndex)) ? Number(options.endIndex) : rows.length)
    ),
    maxMessages = Math.max(1, Number(options.maxMessages) || MESSAGE_PANEL_SCAN_MAX_MESSAGES),
    maxChars = Math.max(1, Number(options.maxChars) || MESSAGE_PANEL_SCAN_MAX_CHARS),
    depths = options.display === true ? regexScriptMessageDepths(rows) : [],
    scanned = 0,
    chars = 0;
  for (var i = end - 1; i >= 0 && scanned < maxMessages; i--, scanned++) {
    var message = rows[i];
    if (!message || message.role !== 'assistant' || message.reverted === true) continue;
    var raw = String(message.content || '');
    chars += raw.length;
    if (chars > maxChars) return null;
    var source = options.display === true ? messagePanelAssistantSource(raw, char, message, { depth: depths[i] }) : raw,
      matches = storyObjectiveMatches(source);
    if (matches.length) {
      var match = matches[matches.length - 1];
      return {
        message: message,
        messageIndex: i,
        source: source,
        raw: source.slice(match.start, match.end),
        match: match,
        parsed: match.parsed,
      };
    }
  }
  return null;
}
function previousStoryObjectiveParsed(char, message) {
  var session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null,
    rows = session && Array.isArray(session.msgs) ? session.msgs : [],
    index = rows.indexOf(message);
  if (index < 0 && message && Number(message.seq) > 0)
    index = rows.findIndex(function (row) {
      return row && Number(row.seq) === Number(message.seq);
    });
  if (index <= 0) return null;
  var found = latestStoryObjectiveMatch(rows, char, { endIndex: index, display: true });
  return (found && found.parsed) || null;
}
function createMessagePanelRenderContext(messages, char, startIndex) {
  var rows = Array.isArray(messages) ? messages : [],
    start = Math.max(
      0,
      Math.min(rows.length, Number.isFinite(Number(startIndex)) ? Math.floor(Number(startIndex)) : 0)
    ),
    scanStart = Math.max(0, start - MESSAGE_PANEL_SCAN_MAX_MESSAGES),
    depths = regexScriptMessageDepths(rows),
    lastObjective = null,
    lastObjectiveIndex = -1,
    lastObjectiveCharsBefore = 0,
    assistantChars = 0;
  function previousObjectiveFor(index) {
    return lastObjective &&
      index - lastObjectiveIndex <= MESSAGE_PANEL_SCAN_MAX_MESSAGES &&
      assistantChars - lastObjectiveCharsBefore <= MESSAGE_PANEL_SCAN_MAX_CHARS
      ? lastObjective
      : null;
  }
  function advance(message, index, source, objectiveMatches) {
    if (!message || message.role !== 'assistant' || message.reverted === true) return;
    var raw = String(message.content || ''),
      charsBefore = assistantChars;
    assistantChars += raw.length;
    var display =
        source === undefined ? messagePanelAssistantSource(raw, char, message, { depth: depths[index] }) : source,
      objectives = Array.isArray(objectiveMatches) ? objectiveMatches : storyObjectiveMatches(display);
    if (objectives.length) {
      lastObjective = objectives[objectives.length - 1].parsed;
      lastObjectiveIndex = index;
      lastObjectiveCharsBefore = charsBefore;
    }
  }
  for (var i = scanStart; i < start; i++) advance(rows[i], i);
  return { previousObjectiveFor: previousObjectiveFor, advance: advance };
}
function assistantPanelSummaryText(match) {
  var text =
      String((match && match.summary) || '')
        .replace(/\s+/g, ' ')
        .trim() || '面板内容',
    suffix = ' · 共 ' + Math.max(2, Number(match && match.lineCount) || 2) + ' 行',
    limit = Math.max(1, 52 - suffix.length);
  return (text.length > limit ? text.slice(0, Math.max(1, limit - 1)) + '…' : text) + suffix;
}
function assistantPanelBlockHtml(match) {
  return (
    '<details class="message-panel-card assistant-panel-card" data-panel-source="bracket-lines"><summary><span class="message-panel-head"><span class="message-panel-title">面板</span><span class="message-panel-summary">' +
    esc(assistantPanelSummaryText(match)) +
    '</span></span></summary><div class="message-panel-body"><div class="assistant-panel-raw">' +
    esc((match && match.content) || '') +
    '</div></div></details>'
  );
}
function storyObjectiveEntryKey(value) {
  return storyObjectiveItemText(value).replace(/\s+/g, ' ').toLowerCase();
}
function storyObjectiveComparison(parsed, previousParsed) {
  if (!previousParsed) return null;
  var previous = Object.create(null);
  (previousParsed.completed || []).filter(storyObjectiveMeaningfulItem).forEach(function (item) {
    previous[storyObjectiveEntryKey(item)] = true;
  });
  var fresh = Object.create(null);
  (parsed.completed || []).filter(storyObjectiveMeaningfulItem).forEach(function (item) {
    var key = storyObjectiveEntryKey(item);
    if (!previous[key]) fresh[key] = true;
  });
  return { freshCompleted: fresh };
}
function storyObjectiveSummaryText(parsed) {
  var goals = (Array.isArray(parsed && parsed.goals) ? parsed.goals : []).filter(storyObjectiveMeaningfulItem),
    first = storyObjectiveItemText(goals[0] || ''),
    text = first ? '进行中 ' + first + (goals.length > 1 ? ' 等 ' + goals.length + ' 项' : '') : '查看目标记录';
  return text.length > 52 ? text.slice(0, 51) + '…' : text;
}
function storyObjectiveListHtml(items, completed, comparison) {
  var rows = Array.isArray(items) ? items : [],
    visible = completed ? rows.slice(-3) : rows;
  if (!visible.length) visible = ['无'];
  return (
    '<span class="story-objective-list' +
    (completed ? ' completed' : '') +
    '">' +
    visible
      .map(function (item) {
        var meaningful = storyObjectiveMeaningfulItem(item),
          fresh = meaningful && comparison && comparison.freshCompleted[storyObjectiveEntryKey(item)],
          text = esc(storyObjectiveItemText(item) || '无');
        return (
          '<span class="story-objective-entry' +
          (meaningful ? '' : ' is-empty') +
          '">' +
          (completed && meaningful ? '<s>' + text + '</s>' : '<span>' + text + '</span>') +
          (fresh ? '<b class="story-objective-new-badge">新完成</b>' : '') +
          '</span>'
        );
      })
      .join('') +
    '</span>'
  );
}
function storyObjectiveBlockHtml(match, previousParsed, options) {
  options = options || {};
  var parsed = match.parsed || {},
    comparison = storyObjectiveComparison(parsed, previousParsed),
    body =
      '<div class="message-panel-row story-objective-list-row"><span class="message-panel-key">目标</span><span class="message-panel-value">' +
      storyObjectiveListHtml(parsed.goals, false, comparison) +
      '</span></div>' +
      '<div class="message-panel-row story-objective-list-row"><span class="message-panel-key">支线</span><span class="message-panel-value">' +
      storyObjectiveListHtml(parsed.branches, false, comparison) +
      '</span></div>' +
      '<div class="message-panel-row story-objective-list-row"><span class="message-panel-key">已完成</span><span class="message-panel-value">' +
      storyObjectiveListHtml(parsed.completed, true, comparison) +
      '</span></div>';
  return (
    '<details class="message-panel-card story-objective-card" data-objective-source="literal"' +
    (options.open ? ' open' : '') +
    '><summary><span class="message-panel-head"><span class="message-panel-title">目标</span><span class="message-panel-summary">' +
    esc(storyObjectiveSummaryText(parsed)) +
    '</span></span></summary><div class="message-panel-body">' +
    body +
    '</div></details>'
  );
}
var StoryDirection = (function () {
  var MAX_LONG_TEXT = 4000,
    MAX_QUEUE_ITEMS = 40,
    MAX_ITEM_TEXT = 600,
    MAX_ITEM_BUDGET = 999,
    panelDraft = null;
  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function text(value, limit) {
    return String(value == null ? '' : value).slice(0, limit);
  }
  function normalize(value) {
    var source = object(value),
      seen = Object.create(null),
      queue = [];
    (Array.isArray(source.queue) ? source.queue : []).slice(0, MAX_QUEUE_ITEMS).forEach(function (raw, index) {
      raw = object(raw);
      var itemText = text(raw.text, MAX_ITEM_TEXT);
      if (!itemText.trim()) return;
      var base = text(raw.id, 120).trim() || 'direction-' + (index + 1),
        id = base,
        suffix = 1;
      while (seen[id]) id = base + '-' + ++suffix;
      seen[id] = true;
      var budget = Math.floor(Number(raw.budget));
      if (!Number.isFinite(budget)) budget = 1;
      queue.push({ id: id, text: itemText, budget: Math.max(1, Math.min(MAX_ITEM_BUDGET, budget)) });
    });
    var activatedAfterUserSeq = Math.max(0, Math.floor(Number(source.activatedAfterUserSeq) || 0)),
      ownerSeqs = Object.create(null),
      roundOwners = [];
    (Array.isArray(source.roundOwners) ? source.roundOwners : []).forEach(function (raw) {
      raw = object(raw);
      var userSeq = Math.max(0, Math.floor(Number(raw.userSeq) || 0)),
        targetId = text(raw.targetId, 120).trim();
      if (!userSeq || !targetId || ownerSeqs[userSeq]) return;
      ownerSeqs[userSeq] = true;
      roundOwners.push({ userSeq: userSeq, targetId: targetId });
    });
    roundOwners.sort(function (a, b) {
      return a.userSeq - b.userSeq;
    });
    var trackedThroughUserSeq = Math.max(activatedAfterUserSeq, Math.floor(Number(source.trackedThroughUserSeq) || 0));
    roundOwners.forEach(function (owner) {
      trackedThroughUserSeq = Math.max(trackedThroughUserSeq, owner.userSeq);
    });
    return {
      longTerm: text(source.longTerm, MAX_LONG_TEXT),
      queue: queue,
      activatedAfterUserSeq: activatedAfterUserSeq,
      trackedThroughUserSeq: trackedThroughUserSeq,
      roundOwners: roundOwners,
    };
  }
  function roundUser(message) {
    return !!(
      message &&
      message.role === 'user' &&
      message.reverted !== true &&
      message.kind !== 'branch-return' &&
      message.branchReturnSummary !== true &&
      message.branchReturnCopy !== true
    );
  }
  function roundAssistant(message) {
    var incomplete = messageIsIncomplete(message);
    return !!(
      message &&
      message.role === 'assistant' &&
      message.reverted !== true &&
      message.kind !== 'branch-return-copy' &&
      message.branchReturnCopy !== true &&
      !incomplete
    );
  }
  function latestUserSeq(messages) {
    var latest = 0;
    (Array.isArray(messages) ? messages : []).forEach(function (message) {
      if (roundUser(message)) latest = Math.max(latest, Math.max(0, Number(message.seq) || 0));
    });
    return latest;
  }
  function completedUserSeqs(messages) {
    var pending = 0,
      completed = [];
    (Array.isArray(messages) ? messages : []).forEach(function (message) {
      if (roundUser(message)) {
        pending = Math.max(0, Number(message.seq) || 0);
        return;
      }
      if (roundAssistant(message) && pending) {
        completed.push(pending);
        pending = 0;
      }
    });
    return completed;
  }
  function deriveRoundOwnership(direction, messages) {
    var completed = completedUserSeqs(messages)
        .filter(function (seq) {
          return seq > direction.activatedAfterUserSeq;
        })
        .sort(function (a, b) {
          return a - b;
        }),
      completedSet = Object.create(null),
      ownedSeqs = Object.create(null),
      counts = Object.create(null);
    completed.forEach(function (seq) {
      completedSet[seq] = true;
    });
    direction.roundOwners.forEach(function (owner) {
      ownedSeqs[owner.userSeq] = true;
      if (completedSet[owner.userSeq]) counts[owner.targetId] = (counts[owner.targetId] || 0) + 1;
    });
    if (direction.queue.length)
      completed.forEach(function (seq) {
        if (ownedSeqs[seq] || seq <= direction.trackedThroughUserSeq) return;
        var target = direction.queue.find(function (item) {
          return (counts[item.id] || 0) < item.budget;
        });
        if (target) {
          direction.roundOwners.push({ userSeq: seq, targetId: target.id });
          ownedSeqs[seq] = true;
          counts[target.id] = (counts[target.id] || 0) + 1;
        }
        direction.trackedThroughUserSeq = Math.max(direction.trackedThroughUserSeq, seq);
      });
    direction.roundOwners.sort(function (a, b) {
      return a.userSeq - b.userSeq;
    });
    return { completed: completed, completedSet: completedSet, counts: counts };
  }
  function progress(session, messages, directionOverride) {
    var direction = normalize(directionOverride === undefined ? session && session.storyDirection : directionOverride),
      ownership = deriveRoundOwnership(direction, messages),
      current = null,
      states = [];
    direction.queue.forEach(function (item, index) {
      var used = ownership.counts[item.id] || 0,
        status = used >= item.budget ? 'completed' : !current ? 'current' : 'pending',
        remaining = Math.max(0, item.budget - used);
      if (status === 'current')
        current = { id: item.id, index: index, text: item.text, budget: item.budget, remaining: remaining };
      states.push({
        id: item.id,
        index: index,
        text: item.text,
        budget: item.budget,
        remaining: remaining,
        status: status,
      });
    });
    return {
      direction: direction,
      consumed: direction.roundOwners.filter(function (owner) {
        return ownership.completedSet[owner.userSeq];
      }).length,
      current: current,
      states: states,
    };
  }
  function recordReplyRound(session, userSeq, targetId, directionSnapshot) {
    if (!session || !session.storyDirection) return null;
    var direction = normalize(directionSnapshot || session.storyDirection),
      seq = Math.max(0, Math.floor(Number(userSeq) || 0)),
      ownerId = text(targetId, 120).trim();
    if (!seq || seq <= direction.activatedAfterUserSeq) return progress(session, session.msgs);
    if (
      ownerId &&
      !direction.roundOwners.some(function (owner) {
        return owner.userSeq === seq;
      })
    )
      direction.roundOwners.push({ userSeq: seq, targetId: ownerId });
    direction.trackedThroughUserSeq = Math.max(direction.trackedThroughUserSeq, seq);
    session.storyDirection = normalize(direction);
    return progress(session, session.msgs);
  }
  function reconcile(session, messages) {
    if (!session || !session.storyDirection) return progress(session, messages);
    var state = progress(session, messages);
    session.storyDirection = state.direction;
    return state;
  }
  function progressInstruction(current) {
    if (!current) return '';
    if (current.remaining === 1)
      return '这是该阶段目标的最后一次回复：必须在本次回复内让这个阶段目标在剧情中自然落定、给出明确结果；禁止把它留到下一回合，禁止开启新支线；收尾要与已有铺垫呼应，不得突兀跳跃。';
    if (current.remaining > current.budget / 2)
      return '现在处于这个阶段的前期。围绕阶段目标铺垫场景、动机和冲突，让事件开始朝它靠拢；本次回复至少出现一个与目标相关的进展或伏笔，但不要急于收束，也不要提前揭示结局。';
    return '这个阶段剩余回合不多。本次回复必须让剧情朝阶段目标取得明确、可见的进展，收拢已铺开的线索；不要引入与目标无关的新地点、新人物或新支线，为按时落定留出空间。';
  }
  function messageForBuild(session, messages, buildOptions) {
    var rows =
        buildOptions && Array.isArray(buildOptions.storyDirectionMessages)
          ? buildOptions.storyDirectionMessages
          : messages,
      state = progress(session, rows),
      parts = [];
    if (state.direction.longTerm.trim()) parts.push('长期方向：\n' + state.direction.longTerm);
    if (state.current) {
      parts.push('当前阶段目标：\n' + state.current.text);
      parts.push(
        '执行约束：以上是给你的导演指令，只能通过剧情内的事件、对话和行动自然实现；不得在正文中提及“目标”“指令”“预算”等字样，不得由旁白直接宣布目标完成。'
      );
      parts.push('进度要求：' + progressInstruction(state.current));
      parts.push(
        '剩余预算：' + state.current.remaining + ' 次回复（包含本次）。请按剩余次数分配节奏，确保目标能在预算内完成。'
      );
    }
    if (!parts.length) return null;
    return { role: 'system', content: '[剧情方向]\n' + parts.join('\n\n'), state: state };
  }
  function blockEntries(value) {
    var source = String(value || ''),
      entries = storyObjectiveMatches(source).map(function (match) {
        return { type: 'objective', match: match };
      }),
      accepted = [],
      cursor = 0;
    entries.forEach(function (entry) {
      if (entry.match.start < cursor) return;
      accepted.push(entry);
      cursor = entry.match.end;
    });
    return { source: source, entries: accepted };
  }
  function extractBlocks(value) {
    var found = blockEntries(value),
      source = found.source,
      parts = [],
      cursor = 0,
      objective = null;
    found.entries.forEach(function (entry) {
      parts.push(source.slice(cursor, entry.match.start));
      objective = source.slice(entry.match.start, entry.match.end).trim();
      cursor = entry.match.end;
    });
    parts.push(source.slice(cursor));
    return { body: parts.join('').replace(/^\s+|\s+$/g, ''), objective: objective };
  }
  function mergeContinuation(base, addition) {
    var previous = extractBlocks(base),
      next = extractBlocks(addition),
      body = joinContinuationText(previous.body, next.body),
      objective = next.objective || previous.objective;
    return body && objective ? body + '\n\n' + objective : body || objective || '';
  }
  function queueRowHtml(row) {
    var completed = row.status === 'completed',
      label = completed ? '已完成' : row.status === 'current' ? '当前 · 剩 ' + row.remaining + ' 次' : '待进行',
      className = completed ? ' is-complete' : row.status === 'current' ? ' is-current' : ' is-pending',
      budget = completed
        ? '用了 ' + row.budget + ' 次回复'
        : '持续 <input class="story-direction-budget-input" type="number" min="1" max="' +
          MAX_ITEM_BUDGET +
          '" inputmode="numeric" value="' +
          row.budget +
          '" data-direction-field="budget" aria-label="持续回复次数"> 次回复';
    return (
      '<div class="story-direction-queue-row' +
      className +
      '" data-direction-id="' +
      escAttr(row.id) +
      '"><span class="story-direction-order" aria-hidden="true">' +
      (completed ? uiIcon('check') : row.index + 1) +
      '</span><div class="story-direction-main"><input class="story-direction-text-input" type="text" maxlength="' +
      MAX_ITEM_TEXT +
      '" value="' +
      escAttr(row.text) +
      '" placeholder="写下这一阶段要发生什么" data-direction-field="text" aria-label="阶段目标 ' +
      (row.index + 1) +
      '"><div class="story-direction-meta"><span class="story-direction-budget">' +
      budget +
      '</span><span class="story-direction-progress">' +
      esc(label) +
      '</span></div></div><button type="button" class="btn icon sm text story-direction-delete" aria-label="删除这个阶段目标">' +
      uiIcon('trash') +
      '</button></div>'
    );
  }
  function currentPanelSession() {
    if (!panelDraft) return null;
    var box = D && D.chats && D.chats[panelDraft.charId];
    return box && Array.isArray(box.sessions)
      ? box.sessions.find(function (session) {
          return session && session.id === panelDraft.sessionId;
        })
      : null;
  }
  function panelQueueStates(session) {
    if (!panelDraft) return [];
    var state = progress(session, session && session.msgs, panelDraft.value),
      byId = Object.create(null);
    state.states.forEach(function (row) {
      byId[row.id] = row;
    });
    return panelDraft.value.queue.map(function (item, index) {
      var view = byId[item.id];
      return (
        view || {
          id: item.id,
          index: index,
          text: String(item.text || ''),
          budget: Math.max(1, Math.min(MAX_ITEM_BUDGET, Math.floor(Number(item.budget)) || 1)),
          remaining: Math.max(1, Math.floor(Number(item.budget)) || 1),
          status: 'pending',
        }
      );
    });
  }
  function renderQueue(modal, session) {
    var target = modal && modal.querySelector('.story-direction-queue');
    if (!target || !panelDraft) return;
    var rows = panelQueueStates(session),
      ordered = rows
        .filter(function (row) {
          return row.status !== 'completed';
        })
        .concat(
          rows.filter(function (row) {
            return row.status === 'completed';
          })
        );
    target.innerHTML =
      ordered.map(queueRowHtml).join('') || '<p class="ui-empty compact">还没有阶段目标。添加后会按顺序逐项推进。</p>';
  }
  function bindPanel(modal) {
    if (!modal || modal.dataset.storyDirectionBound === '1') return;
    modal.dataset.storyDirectionBound = '1';
    var longInput = modal.querySelector('.story-direction-long-term-input'),
      queue = modal.querySelector('.story-direction-queue'),
      add = modal.querySelector('.story-direction-add'),
      save = modal.querySelector('.story-direction-save');
    if (longInput)
      longInput.addEventListener('input', function () {
        if (panelDraft) panelDraft.value.longTerm = text(longInput.value, MAX_LONG_TEXT);
      });
    if (add)
      add.addEventListener('click', function () {
        if (!panelDraft) return;
        if (panelDraft.value.queue.length >= MAX_QUEUE_ITEMS) {
          toast('阶段目标最多添加 ' + MAX_QUEUE_ITEMS + ' 项', 'info');
          return;
        }
        panelDraft.value.queue.push({
          id: typeof uid === 'function' ? uid() : 'direction-' + Date.now(),
          text: '',
          budget: 4,
        });
        renderQueue(modal, currentPanelSession());
        var input = modal.querySelector(
          '.story-direction-queue-row input[data-direction-field="text"]:placeholder-shown'
        );
        if (input) input.focus();
      });
    if (queue) {
      queue.addEventListener('input', function (event) {
        var field = event.target && event.target.getAttribute('data-direction-field'),
          row = event.target && event.target.closest('.story-direction-queue-row');
        if (!panelDraft || !field || !row) return;
        var item = panelDraft.value.queue.find(function (candidate) {
          return candidate.id === row.getAttribute('data-direction-id');
        });
        if (!item) return;
        if (field === 'text') item.text = text(event.target.value, MAX_ITEM_TEXT);
        else item.budget = event.target.value;
      });
      queue.addEventListener('click', function (event) {
        var button = event.target && event.target.closest('.story-direction-delete'),
          row = button && button.closest('.story-direction-queue-row');
        if (!panelDraft || !row) return;
        var id = row.getAttribute('data-direction-id');
        panelDraft.value.queue = panelDraft.value.queue.filter(function (item) {
          return item.id !== id;
        });
        renderQueue(modal, currentPanelSession());
      });
    }
    if (save)
      save.addEventListener('click', async function () {
        if (!panelDraft) return;
        if (typeof blockDuringGeneration === 'function' && blockDuringGeneration('保存剧情方向')) return;
        var session = currentPanelSession();
        if (!session) {
          toast('当前对话已切换，请重新打开这个面板', 'info');
          return;
        }
        var blankCount = panelDraft.value.queue.filter(function (item) {
            return !String(item.text || '').trim();
          }).length,
          next = normalize(panelDraft.value),
          had = Object.prototype.hasOwnProperty.call(session, 'storyDirection'),
          before = had ? copyJsonData(session.storyDirection) : null,
          previous = progress(session, session.msgs).direction;
        if (!previous.queue.length && next.queue.length) {
          next.activatedAfterUserSeq = latestUserSeq(session.msgs);
          next.trackedThroughUserSeq = next.activatedAfterUserSeq;
          next.roundOwners = [];
        } else if (previous.queue.length && next.queue.length) {
          next.activatedAfterUserSeq = previous.activatedAfterUserSeq;
          next.trackedThroughUserSeq = Math.max(next.trackedThroughUserSeq, previous.trackedThroughUserSeq);
        } else if (!next.queue.length) {
          next.activatedAfterUserSeq = 0;
          next.trackedThroughUserSeq = 0;
          next.roundOwners = [];
        }
        if (next.longTerm.trim() || next.queue.length) session.storyDirection = next;
        else delete session.storyDirection;
        try {
          await saveData('sessions', { urgent: true });
        } catch (error) {
          if (had) session.storyDirection = before;
          else delete session.storyDirection;
          toast('剧情方向保存失败，原内容已恢复：' + String((error && error.message) || error), 'err');
          return;
        }
        panelDraft.value = normalize(session.storyDirection);
        var input = modal.querySelector('.story-direction-long-term-input');
        if (input) input.value = panelDraft.value.longTerm;
        renderQueue(modal, session);
        if (blankCount) toast('已忽略 ' + blankCount + ' 个空白阶段目标，其余方向已保存', 'info');
        else toast('剧情方向已保存，从下一次回复起生效', 'ok');
      });
  }
  function openPanel() {
    var modal = $('story-objective-modal'),
      char = typeof getChar === 'function' ? getChar() : null,
      session = char && typeof getActiveSession === 'function' ? getActiveSession(char.id) : null;
    if (!modal || !char || !session) {
      toast('请先选择角色和对话', 'info');
      return false;
    }
    panelDraft = { charId: char.id, sessionId: session.id, value: progress(session, session.msgs).direction };
    bindPanel(modal);
    var longInput = modal.querySelector('.story-direction-long-term-input');
    if (longInput) longInput.value = panelDraft.value.longTerm;
    renderQueue(modal, session);
    openModal('story-objective-modal');
    return !!(panelDraft.value.longTerm.trim() || panelDraft.value.queue.length);
  }
  function notifyAdvance(beforeState, afterState) {
    if (!beforeState || !beforeState.current || beforeState.current.remaining !== 1) return '';
    var beforeId = beforeState.current.id,
      after = afterState && afterState.current;
    if (after && after.id !== beforeId) {
      var label =
        '阶段目标已推进：' +
        String(after.text || '')
          .trim()
          .slice(0, 80);
      toast(label, 'ok');
      return label;
    }
    if (!after) {
      var done = '阶段目标队列已完成';
      toast(done, 'ok');
      return done;
    }
    return '';
  }
  return {
    normalize: normalize,
    progress: progress,
    recordReplyRound: recordReplyRound,
    reconcile: reconcile,
    messageForBuild: messageForBuild,
    extractBlocks: extractBlocks,
    mergeContinuation: mergeContinuation,
    openPanel: openPanel,
    notifyAdvance: notifyAdvance,
    latestUserSeq: latestUserSeq,
  };
})();
function renderMessagePanelText(
  value,
  markdownOptions,
  previousObjectiveParsed,
  preparedObjectiveMatches,
  preparedPanelMatches,
  renderBody
) {
  var renderText =
    renderBody ||
    function (text) {
      return md(text, markdownOptions || {});
    };
  var source = String(value || ''),
    objectives = Array.isArray(preparedObjectiveMatches) ? preparedObjectiveMatches : storyObjectiveMatches(source),
    panels = Array.isArray(preparedPanelMatches) ? preparedPanelMatches : assistantPanelMatches(source, objectives),
    combined = objectives
      .map(function (match) {
        return { type: 'objective', match: match };
      })
      .concat(
        panels.map(function (match) {
          return { type: 'panel', match: match };
        })
      )
      .sort(function (a, b) {
        return a.match.start - b.match.start;
      });
  if (!combined.length) return renderText(source);
  var html = '',
    cursor = 0,
    previousObjective = previousObjectiveParsed;
  combined.forEach(function (entry) {
    var match = entry.match;
    if (match.start < cursor) return;
    if (match.start > cursor) html += renderText(source.slice(cursor, match.start));
    if (entry.type === 'objective') {
      html += storyObjectiveBlockHtml(match, previousObjective);
      previousObjective = match.parsed;
    } else html += assistantPanelBlockHtml(match);
    cursor = match.end;
  });
  if (cursor < source.length) html += renderText(source.slice(cursor));
  return html;
}
function openLatestStoryObjective() {
  return StoryDirection.openPanel();
}
function assistantStructuredDisplayHtml(
  value,
  char,
  message,
  displayOptions,
  markdownOptions,
  previousObjective,
  messageIndex,
  prepared
) {
  var options = displayOptions || {},
    marked = String(value || ''),
    displaySource = messagePanelAssistantSource(marked, char, message, options),
    objectives = storyObjectiveMatches(displaySource),
    panels = assistantPanelMatches(displaySource, objectives),
    html = renderMessagePanelText(
      displaySource,
      markdownOptions || { role: 'assistant' },
      previousObjective,
      objectives,
      panels,
      options.renderBody
    );
  if (prepared) {
    prepared.displaySource = displaySource;
    prepared.objectives = objectives;
  }
  return typeof promptTemplateDisplayHtml === 'function'
    ? promptTemplateDisplayHtml(html, marked, 'assistant', char, message, options)
    : html;
}
function assistantMessageDisplayHtml(
  value,
  char,
  message,
  displayOptions,
  markdownOptions,
  renderContext,
  messageIndex
) {
  var options = displayOptions || {},
    previousObjective =
      renderContext && typeof renderContext.previousObjectiveFor === 'function'
        ? renderContext.previousObjectiveFor(messageIndex)
        : previousStoryObjectiveParsed(char, message),
    prepared = {};
  if (
    typeof isRisuCharacter === 'function' &&
    isRisuCharacter(char) &&
    typeof risuDisplayPlaceholderHtml === 'function'
  ) {
    var partIndex = 0;
    options = Object.assign({}, options, {
      renderBody: function (text) {
        return risuNeedsIsolatedDisplay(text)
          ? risuDisplayPlaceholderHtml(text, messageIndex, 'assistant', partIndex++)
          : md(text, markdownOptions || {});
      },
    });
  }
  var html = assistantStructuredDisplayHtml(
    value,
    char,
    message,
    options,
    markdownOptions,
    previousObjective,
    messageIndex,
    prepared
  );
  if (renderContext && typeof renderContext.advance === 'function')
    renderContext.advance(
      message,
      messageIndex,
      options.preserveImages === true ? undefined : prepared.displaySource,
      options.preserveImages === true ? undefined : prepared.objectives
    );
  return html;
}
