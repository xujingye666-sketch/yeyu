(function (g) {
  'use strict';
  // Only __proto__ would rewire the merged object's prototype; constructor/prototype are ordinary data keys.
  var BLOCKED_KEY = '__proto__';
  function isMediaBlob(value) {
    return !!(
      value &&
      typeof value === 'object' &&
      typeof value.size === 'number' &&
      typeof value.arrayBuffer === 'function' &&
      typeof value.slice === 'function'
    );
  }
  function mergeObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && !isMediaBlob(value);
  }
  function copyMergeBase(value) {
    var out = {};
    if (!mergeObject(value)) return out;
    Object.keys(value).forEach(function (key) {
      if (key !== BLOCKED_KEY) out[key] = value[key];
    });
    return out;
  }
  function deepMerge(base, src) {
    var result = copyMergeBase(base);
    if (!mergeObject(src)) return result;
    var active = new WeakSet(),
      stack = [{ target: result, base: mergeObject(base) ? base : {}, source: src }];
    while (stack.length) {
      var frame = stack.pop();
      if (frame.exit) {
        active.delete(frame.source);
        continue;
      }
      if (active.has(frame.source)) throw new Error('数据包含循环对象引用，无法安全合并');
      active.add(frame.source);
      stack.push({ exit: true, source: frame.source });
      var keys = Object.keys(frame.source);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key === BLOCKED_KEY) continue;
        var value = frame.source[key],
          baseValue = Object.prototype.hasOwnProperty.call(frame.base, key) ? frame.base[key] : undefined;
        if (mergeObject(value)) {
          var childBase = mergeObject(baseValue) ? baseValue : {},
            child = copyMergeBase(childBase);
          frame.target[key] = child;
          stack.push({ target: child, base: childBase, source: value });
        } else frame.target[key] = value;
      }
    }
    return result;
  }
  function estTokens(text) {
    var chars = Array.from(String(text || '')),
      total = 0;
    chars.forEach(function (char) {
      var code = char.codePointAt(0);
      if (
        (code >= 0x3400 && code <= 0x9fff) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0x20000 && code <= 0x2fa1f) ||
        (code >= 0x3040 && code <= 0x30ff) ||
        (code >= 0x1100 && code <= 0x11ff) ||
        (code >= 0xac00 && code <= 0xd7af)
      )
        total += 0.6;
      else if (
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        (code >= 0xc0 && code <= 0x24f)
      )
        total += 0.25;
      else if (/\s/.test(char)) total += 0.05;
      // Measured against DeepSeek-V3 and o200k: ASCII punctuation in HTML, CSS and JSON costs about 0.7
      // a token, CJK and general punctuation, symbols and BMP emoji about one, and astral emoji more.
      else if (code <= 0x7f) total += 0.7;
      else if (code > 0xffff) total += 2;
      else if (
        (code >= 0x2000 && code <= 0x2bff) ||
        (code >= 0x3000 && code <= 0x303f) ||
        (code >= 0xfe00 && code <= 0xfe0f) ||
        (code >= 0xff00 && code <= 0xffef)
      )
        total += 1;
      else total += 0.6;
    });
    return Math.ceil(total);
  }
  function trimToTokenBudget(text, maxTokens) {
    text = String(text || '');
    maxTokens = parseInt(maxTokens) || 0;
    if (maxTokens <= 0 || estTokens(text) <= maxTokens) return text;
    var chars = Array.from(text),
      suffix = '…',
      low = 0,
      high = chars.length,
      best = '';
    while (low <= high) {
      var mid = Math.floor((low + high) / 2),
        candidate = chars.slice(0, mid).join('') + suffix;
      if (estTokens(candidate) <= maxTokens) {
        best = candidate;
        low = mid + 1;
      } else high = mid - 1;
    }
    return best || suffix;
  }
  function sanitizeText(text) {
    return String(text == null ? '' : text);
  }
  function parseSSEBuffer(buffer) {
    var events = [],
      parts = String(buffer || '').split(/\r?\n\r?\n/),
      rest = parts.pop() || '';
    parts.forEach(function (block) {
      var data = block
        .split(/\r?\n/)
        .filter(function (x) {
          return /^data:/.test(x);
        })
        .map(function (x) {
          return x.slice(5).replace(/^ /, '');
        })
        .join('\n');
      if (!data) return;
      if (data === '[DONE]') events.push({ done: true });
      else {
        try {
          events.push({ data: JSON.parse(data) });
        } catch (_) {
          events.push({ invalid: data });
        }
      }
    });
    return { events: events, rest: rest };
  }
  function worldBookSelectiveMatch(logic, results) {
    results = Array.isArray(results) ? results.map(Boolean) : [];
    if (!results.length) return true;
    var value = String(logic == null ? 0 : logic)
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
    if (value === '1' || value === 'notall') return !results.every(Boolean);
    if (value === '2' || value === 'notany') return !results.some(Boolean);
    if (value === '3' || value === 'andall' || value === 'all') return results.every(Boolean);
    return results.some(Boolean);
  }
  function stablePercent(seed) {
    var s = String(seed || ''),
      h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 100;
  }
  // The part of a message a reader actually reads. The visible-character budget and message search
  // share stripping rules, with the existing generation budget retaining code bodies and image labels.
  function readableMessageText(text, options) {
    var value = String(text || '');
    if (!options || options.keepCodeBodies !== true)
      value = value
        .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '\n')
        // Markdown fence rules: both delimiters own a line and the closing run repeats the opening
        // character, so a ``` written inside the block's own code does not end it early.
        .replace(/^[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*(?:[\s\S]*?\r?\n[ \t]{0,3}\1[`~]*[ \t]*(?=\r?\n|$)|[\s\S]*$)/gm, '\n');
    return value
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      // Markdown image labels become <img alt>; they are not body text while the image renders.
      // Removing the whole token also keeps asset names and addresses out of message search. A
      // caption written beside the image (including figcaption text) remains in the normal flow.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, options && options.keepImageLabels === true ? '$1' : '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Only a real fence line is dropped; a run of backticks inside a retained code body is text.
      .replace(/^[ \t]{0,3}(?:`{3,}|~{3,})[^\r\n]*\r?\n?/gm, '')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^\s{0,3}(?:#{1,6}|>|[-+])\s?/gm, '')
      .replace(/[\*_~]/g, '')
      .replace(/<[^>]+>/g, '');
  }
  function visibleCharacterCount(text) {
    return Array.from(readableMessageText(text, { keepCodeBodies: true, keepImageLabels: true }).replace(/\s+/gu, '')).length;
  }
  function snippetCut(text, at) {
    var code = text.charCodeAt(at);
    // Cutting between a surrogate pair would leave half a character in the snippet.
    return code >= 0xdc00 && code <= 0xdfff ? at + 1 : at;
  }
  function snippetMatch(source, needle) {
    if (!needle) return null;
    var foldedSource = source.toLowerCase(),
      foldedNeedle = needle.toLowerCase();
    // Lowercasing that keeps every code unit in place lets folded offsets index the original text.
    if (foldedSource.length === source.length && foldedNeedle.length === needle.length) {
      var at = foldedSource.indexOf(foldedNeedle);
      return at < 0 ? null : { at: at, end: at + needle.length };
    }
    var found = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(source);
    return found ? { at: found.index, end: found.index + found[0].length } : null;
  }
  function matchSnippetHtml(text, keyword, limit) {
    var source = String(text == null ? '' : text)
        .replace(/\s+/g, ' ')
        .trim(),
      needle = String(keyword == null ? '' : keyword),
      budget = Math.max(24, Math.floor(Number(limit) || 100)),
      match = snippetMatch(source, needle);
    if (!match) {
      var plainEnd = snippetCut(source, Math.min(source.length, budget));
      return escapeHtmlAttr(source.slice(0, plainEnd)) + (plainEnd < source.length ? '…' : '');
    }
    var at = match.at,
      matchEnd = match.end,
      rest = Math.max(0, budget - (matchEnd - at)),
      after = Math.min(source.length - matchEnd, Math.floor(rest / 2)),
      before = Math.min(at, rest - after),
      start = snippetCut(source, at - before),
      end = snippetCut(source, matchEnd + Math.min(source.length - matchEnd, rest - before));
    return (
      (start > 0 ? '…' : '') +
      escapeHtmlAttr(source.slice(start, at)) +
      '<mark>' +
      escapeHtmlAttr(source.slice(at, matchEnd)) +
      '</mark>' +
      escapeHtmlAttr(source.slice(matchEnd, end)) +
      (end < source.length ? '…' : '')
    );
  }
  function escapeHtmlAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function inlineJsArg(value) {
    return escapeHtmlAttr(
      JSON.stringify(String(value == null ? '' : value))
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
    );
  }
  function safeImageSource(value, allowBlob) {
    var src = String(value || '').trim();
    if (!src) return '';
    if (allowBlob && /^blob:[^\s]+$/i.test(src)) return src;
    if (/^file:\/\/\/android_asset\/[a-zA-Z0-9_./-]+$/i.test(src) && src.indexOf('..') < 0) return src;
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/i.test(src)) return src;
    return '';
  }
  function remoteImageUrl(value) {
    var src = String(value || '').trim();
    return /^https?:\/\/[^\s<>"']+$/i.test(src) ? src : '';
  }
  function safeImagePresentation(width, radius) {
    var w = String(width == null ? '' : width).trim(),
      r = String(radius == null ? '' : radius).trim(),
      out = {};
    var wm = w.match(/^(\d{1,3})(?:\.\d+)?%$/);
    if (wm) out.width = Math.max(10, Math.min(100, Number(wm[1]))) + '%';
    var rm = r.match(/^(\d{1,2})(?:\.\d+)?px$/i);
    if (rm) out.radius = Math.max(0, Math.min(24, Number(rm[1]))) + 'px';
    return out;
  }
  function decodeAttrText(value) {
    return String(value || '')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }
  function imageRefUrl(value) {
    var raw = decodeAttrText(value).trim();
    if (!raw) return '';
    var compact = raw.replace(/\s+/g, '');
    if (remoteImageUrl(compact) || /^(?:data|blob|file):/i.test(compact)) return compact;
    return raw;
  }
  function extractImageRefs(text) {
    var source = String(text || ''),
      refs = [],
      seen = [];
    function add(start, end, alt, url, attrs) {
      url = imageRefUrl(url);
      if (!url || start < 0 || end <= start) return;
      var key = start + ':' + end + ':' + url;
      if (seen.indexOf(key) >= 0) return;
      seen.push(key);
      attrs = attrs || {};
      var p = safeImagePresentation(attrs.width, attrs.radius);
      refs.push({
        start: start,
        end: end,
        alt: decodeAttrText(alt || '').trim(),
        url: url,
        width: p.width || '',
        radius: p.radius || '',
        kind: attrs.kind || 'inline',
      });
    }
    var md = /!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["']([^"']*)["'])?\s*\)/g,
      m;
    while ((m = md.exec(source))) add(m.index, m.index + m[0].length, m[1], m[2], { title: m[3] || '' });
    var html = /<img\b([^>]*?)>/gi;
    while ((m = html.exec(source))) {
      var a = m[1] || '',
        sm = a.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),
        am = a.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),
        wm = a.match(/\bwidth\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),
        rm = a.match(/\bborder-radius\s*:\s*([^;"']+)/i),
        stm = a.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),
        style = stm ? stm[1] || stm[2] || stm[3] || '' : '';
      if (sm) {
        var picked = sm,
          url = picked[1] || picked[2] || picked[3] || '',
          alt = am ? am[1] || am[2] || am[3] || '' : '';
        add(m.index, m.index + m[0].length, alt, url, {
          width: (style.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i) || [])[1] || (wm ? wm[1] || wm[2] || wm[3] || '' : ''),
          radius: (style.match(/(?:^|;)\s*border-radius\s*:\s*([^;]+)/i) || [])[1] || (rm ? rm[1] : ''),
        });
      }
    }
    return refs.sort(function (a, b) {
      return a.start - b.start;
    });
  }
  function cleanCreatorNotes(text) {
    var source = sanitizeText(text || ''),
      removed = [];
    source = source.replace(/<!--[\s\S]*?-->/g, function () {
      removed.push('comment');
      return '';
    });
    source = source.replace(
      /<\s*(script|style|link|svg|noscript|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      function (_, tag) {
        removed.push(String(tag).toLowerCase());
        return '';
      }
    );
    source = source.replace(/<\s*(script|style|link|svg|noscript|iframe|object|embed)\b[^>]*\/?>/gi, function (_, tag) {
      removed.push(String(tag).toLowerCase());
      return '';
    });
    source = source.replace(/<img\b([^>]*)>/gi, function (_, attrs) {
      var m = attrs.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),
        sm = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),
        alt = m ? decodeAttrText(m[1] || m[2] || m[3] || '') : '',
        src = sm ? decodeAttrText(sm[1] || sm[2] || sm[3] || '').trim() : '';
      if (/^https?:\/\/[^\s<>"']+$/i.test(src)) {
        var style = attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),
          styleText = style ? String(style[1] || style[2] || style[3] || '') : '';
        var width = (styleText.match(/(?:^|;)\s*width\s*:\s*([0-9]{1,3}(?:\.\d+)?%)/i) || [])[1] || '',
          radius = (styleText.match(/(?:^|;)\s*border-radius\s*:\s*([0-9]{1,2}(?:\.\d+)?px)/i) || [])[1] || '';
        return (
          '<img src="' +
          escapeHtmlAttr(src) +
          '" alt="' +
          escapeHtmlAttr(alt || '图片') +
          '"' +
          (width ? ' width="' + escapeHtmlAttr(width) + '"' : '') +
          (radius ? ' style="border-radius:' + escapeHtmlAttr(radius) + '"' : '') +
          '>'
        );
      }
      return alt ? '[图片：' + alt + ']' : '[图片]';
    });
    source = source
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(
        /<\/(?:p|div|li|h[1-6]|tr|blockquote|ul|ol|table|thead|tbody|section|article|header|footer|center|figure|figcaption)\s*>/gi,
        '\n'
      )
      .replace(
        /<\/?(?:p|div|span|li|h[1-6]|tr|blockquote|ul|ol|table|thead|tbody|section|article|header|footer|center|figure|figcaption)\b[^>]*>/gi,
        ''
      );
    source = source.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    source = source
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return {
      original: String(text || ''),
      cleaned: source,
      removed: Array.from(new Set(removed)),
      changed: source !== String(text || ''),
    };
  }
  function safeColor(value) {
    var s = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(s) ? s : '#6366f1';
  }
  function analyzeImagePixels(data) {
    var linearTotal = 0,
      toneTotal = 0,
      lightWeight = 0,
      weight = 0;
    if (!data || typeof data.length !== 'number') return { luminance: null, tone: null, lightRatio: 0 };
    function linear(v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    for (var i = 0; i + 3 < data.length; i += 4) {
      var a = data[i + 3] / 255;
      if (a < 0.08) continue;
      var r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        y = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b),
        tone = Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b) / 255;
      linearTotal += y * a;
      toneTotal += tone * a;
      if (tone >= 0.62) lightWeight += a;
      weight += a;
    }
    return {
      luminance: weight ? linearTotal / weight : null,
      tone: weight ? toneTotal / weight : null,
      lightRatio: weight ? lightWeight / weight : 0,
    };
  }
  function srgbLinear(v) {
    v = Math.max(0, Math.min(255, Number(v) || 0)) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function linearSrgb(v) {
    v = Number(v) || 0;
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055);
  }
  function rgbToOklab(r, g, b) {
    r = srgbLinear(r);
    g = srgbLinear(g);
    b = srgbLinear(b);
    var l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
      m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
      s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
      l3 = Math.cbrt(l),
      m3 = Math.cbrt(m),
      s3 = Math.cbrt(s);
    return {
      L: 0.2104542553 * l3 + 0.7936177853 * m3 - 0.0040720468 * s3,
      a: 1.9779984951 * l3 - 2.4285922053 * m3 + 0.4505937099 * s3,
      b: 0.0259040371 * l3 + 0.7827717662 * m3 - 0.8086757662 * s3,
    };
  }
  function oklabToLinearRgb(lab) {
    var L = Number(lab && lab.L) || 0,
      A = Number(lab && lab.a) || 0,
      B = Number(lab && lab.b) || 0,
      l = L + 0.3963377774 * A + 0.2158037573 * B,
      m = L - 0.1055613458 * A - 0.0638541728 * B,
      s = L - 0.0894841775 * A - 1.291485548 * B,
      l3 = l * l * l,
      m3 = m * m * m,
      s3 = s * s * s;
    return [
      4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
      -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
      -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
    ];
  }
  function oklabDistance(a, b) {
    var dl = a.L - b.L,
      da = a.a - b.a,
      db = a.b - b.b;
    return Math.sqrt(dl * dl + da * da + db * db);
  }
  function rgbToOklch(r, g, b) {
    var lab = rgbToOklab(r, g, b),
      chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b),
      hue = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
    return { L: lab.L, C: chroma, H: (hue + 360) % 360 };
  }
  function oklchToLinearRgb(L, C, H) {
    var rad = ((Number(H) || 0) * Math.PI) / 180;
    return oklabToLinearRgb({
      L: Number(L) || 0,
      a: Math.cos(rad) * (Number(C) || 0),
      b: Math.sin(rad) * (Number(C) || 0),
    });
  }
  function rgbHex(r, g, b) {
    return (
      '#' +
      [r, g, b]
        .map(function (v) {
          return Math.max(0, Math.min(255, Math.round(v)))
            .toString(16)
            .padStart(2, '0');
        })
        .join('')
    );
  }
  function oklchToHex(L, C, H) {
    var chroma = Math.max(0, Number(C) || 0),
      raw = [];
    for (var i = 0; i < 18; i++) {
      raw = oklchToLinearRgb(L, chroma, H);
      if (
        raw.every(function (v) {
          return v >= 0 && v <= 1;
        })
      )
        return rgbHex(linearSrgb(raw[0]), linearSrgb(raw[1]), linearSrgb(raw[2]));
      chroma *= 0.86;
    }
    return rgbHex(
      linearSrgb(Math.max(0, Math.min(1, raw[0]))),
      linearSrgb(Math.max(0, Math.min(1, raw[1]))),
      linearSrgb(Math.max(0, Math.min(1, raw[2])))
    );
  }
  function colorLuminance(hex) {
    var m = String(hex || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return 0;
    return (
      0.2126 * srgbLinear(parseInt(m[1], 16)) +
      0.7152 * srgbLinear(parseInt(m[2], 16)) +
      0.0722 * srgbLinear(parseInt(m[3], 16))
    );
  }
  function contrastRatio(foreground, background) {
    var a = colorLuminance(foreground),
      b = colorLuminance(background),
      hi = Math.max(a, b),
      lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }
  function paletteFallback(metrics, algorithmVersion) {
    return {
      colors: [],
      sourceColors: [],
      semanticColors: [],
      field: [],
      metrics: metrics,
      neutral: true,
      colorSource: 'neutral',
      lowChromaIgnored: true,
      clusters: [],
      sampleCount: 0,
      paletteConfidence: 0,
      algorithmVersion: algorithmVersion,
    };
  }
  function rgbSaturation(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    var max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      l = (max + min) / 2;
    if (max === min) return 0;
    var d = max - min;
    return l > 0.5 ? d / (2 - max - min) : d / (max + min);
  }
  function hueDistanceDegrees(a, b) {
    var d = Math.abs(Number(a) - Number(b)) % 360;
    return Math.min(d, 360 - d);
  }
  // Each hue keeps its value when it sits at least minGap from the hues placed before it; otherwise it
  // moves to the nearest hue within maxShift of its own that clears them, so a palette whose clusters
  // share one hue fans out around it and stays in that hue family. When nothing within reach clears,
  // it takes the reachable hue farthest from the placed ones. Earlier entries have priority.
  function spreadHues(hues, minGap, maxShift) {
    var gap = Math.max(0, Math.min(90, Number(minGap) || 0)),
      reach = Math.max(0, Math.min(180, maxShift === undefined ? 180 : Number(maxShift) || 0)),
      placed = [];
    function nearestPlaced(hue) {
      return placed.reduce(function (nearest, other) {
        return Math.min(nearest, hueDistanceDegrees(hue, other));
      }, 180);
    }
    (Array.isArray(hues) ? hues : []).forEach(function (value) {
      var own = Number.isFinite(Number(value)) ? (Number(value) + 360) % 360 : placed[0] || 0,
        best = own,
        bestDistance = nearestPlaced(own);
      for (var step = 1; bestDistance < gap && step <= reach; step++) {
        [(own + step) % 360, (own - step + 360) % 360].forEach(function (hue) {
          var distance = nearestPlaced(hue);
          if (bestDistance < gap && distance > bestDistance) {
            best = hue;
            bestDistance = distance;
          }
        });
      }
      placed.push(best);
    });
    return placed;
  }
  // An identity colour names an item (a wheel scheme) apart from its neighbours. Only its hue carries
  // meaning: lightness and chroma are fixed, and the theme pipeline pins every role's own lightness.
  var IDENTITY_HUE_GAP = 30;
  function identityColor(hue) {
    return oklchToHex(0.62, 0.16, (((Number(hue) || 0) % 360) + 360) % 360);
  }
  // The OKLCH hue of a #rrggbb colour, or null when the text is not one.
  function colorHue(hex) {
    var match = String(hex || '').match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return match ? rgbToOklch(parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)).H : null;
  }
  // Picks the hue for a new item once; the caller stores it, so it never moves afterwards. The first
  // item takes a hue hashed from its id. Later ones sit exactly IDENTITY_HUE_GAP beside an occupied hue
  // (the free spot nearest the hashed hue), so items pack tightly and twelve automatic hues fit around
  // the circle; when no spot is free the item takes the middle of the widest remaining arc.
  function identityHue(id, occupiedHues) {
    var occupied = (Array.isArray(occupiedHues) ? occupiedHues : [])
      .filter(function (hue) {
        return typeof hue === 'number' && isFinite(hue);
      })
      .map(normalizedHue)
      .sort(function (a, b) {
        return a - b;
      });
    function normalizedHue(hue) {
      return (Math.round((((hue % 360) + 360) % 360) * 10) / 10) % 360;
    }
    var own = normalizedHue(stablePercent(String(id || '')) * 3.6);
    if (!occupied.length) return own;
    var best = null;
    occupied.forEach(function (hue) {
      [hue - IDENTITY_HUE_GAP, hue + IDENTITY_HUE_GAP].forEach(function (candidate) {
        candidate = normalizedHue(candidate);
        var clear = occupied.every(function (other) {
          return hueDistanceDegrees(candidate, other) >= IDENTITY_HUE_GAP - 0.05;
        });
        if (clear && (best === null || hueDistanceDegrees(candidate, own) < hueDistanceDegrees(best, own)))
          best = candidate;
      });
    });
    if (best !== null) return best;
    var widest = 0;
    occupied.forEach(function (hue, index) {
      var next = index + 1 < occupied.length ? occupied[index + 1] : occupied[0] + 360;
      if (next - hue > widest) {
        widest = next - hue;
        best = normalizedHue(hue + widest / 2);
      }
    });
    return best;
  }
  // Four screen quadrants (top-left, top-right, bottom-left, bottom-right) each take the palette
  // cluster that is most present there, so page ambience keeps the background's colour layout.
  function paletteField(data, width, clusters, fallback) {
    var height = width > 1 ? Math.floor(data.length / 4 / width) : 0;
    if (!clusters.length || height < 2) return [fallback, fallback, fallback, fallback];
    var scores = [0, 1, 2, 3].map(function () {
        return clusters.map(function () {
          return 0;
        });
      }),
      totals = [0, 0, 0, 0],
      pixels = [0, 0, 0, 0];
    for (var i = 0; i + 3 < data.length; i += 4) {
      if (data[i + 3] < 191) continue;
      var pixel = i / 4,
        zone = (Math.floor(pixel / width) < height / 2 ? 0 : 2) + (pixel % width < width / 2 ? 0 : 1),
        lab = rgbToOklab(data[i], data[i + 1], data[i + 2]),
        chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
      pixels[zone]++;
      if (lab.L < 0.1 || lab.L > 0.94 || chroma < 0.03) continue;
      var nearest = 0,
        distance = Infinity;
      clusters.forEach(function (cluster, ci) {
        var d = oklabDistance(lab, cluster.lab);
        if (d < distance) {
          distance = d;
          nearest = ci;
        }
      });
      var presence = 0.35 + Math.min(1, chroma / 0.18);
      scores[zone][nearest] += presence;
      totals[zone] += presence;
    }
    var used = [];
    return scores.map(function (row, zone) {
      if (totals[zone] <= pixels[zone] * 0.03) return fallback;
      var order = row
          .map(function (score, ci) {
            return { score: score, ci: ci };
          })
          .sort(function (a, b) {
            return b.score - a.score;
          }),
        // A clearly present colour not shown elsewhere yet wins over repeating the same one.
        fresh = order.find(function (row) {
          return used.indexOf(row.ci) < 0 && row.score >= order[0].score * 0.6;
        }),
        pick = (fresh || order[0]).ci;
      used.push(pick);
      return clusters[pick].hex;
    });
  }
  function analyzePerceptualPalette(data, width) {
    var algorithmVersion = 1400,
      metrics = analyzeImagePixels(data),
      opaqueWeight = 0,
      histogram = new Map();
    if (!data || typeof data.length !== 'number') return paletteFallback(metrics, algorithmVersion);
    for (var i = 0; i + 3 < data.length; i += 4) {
      var alpha = data[i + 3] / 255;
      if (alpha < 0.75) continue;
      opaqueWeight += alpha;
      var r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        lch = rgbToOklch(r, g, b),
        saturation = rgbSaturation(r, g, b);
      // 极端明暗像素不适合作为控件色。浅粉、雾蓝等低色度像素仍保留
      // 色相证据，后续只有在整片区域共同支持该色相时才可入选。
      if (lch.L < 0.1 || lch.L > 0.94 || lch.C < 0.018 || saturation < 0.1) continue;
      var key = (r >> 3) + '|' + (g >> 3) + '|' + (b >> 3),
        row = histogram.get(key);
      if (!row) {
        row = { weight: 0, strongWeight: 0, variants: new Map() };
        histogram.set(key, row);
      }
      row.weight += alpha;
      if (lch.C >= 0.075 && saturation >= 0.3) row.strongWeight += alpha;
      var exact = rgbHex(r, g, b),
        count = row.variants.get(exact) || 0;
      row.variants.set(exact, count + alpha);
    }
    if (!opaqueWeight || !histogram.size) return paletteFallback(metrics, algorithmVersion);
    var points = [];
    histogram.forEach(function (row) {
      var bestHex = '',
        bestWeight = -1;
      row.variants.forEach(function (weight, hex) {
        if (weight > bestWeight) {
          bestHex = hex;
          bestWeight = weight;
        }
      });
      var r = parseInt(bestHex.slice(1, 3), 16),
        g = parseInt(bestHex.slice(3, 5), 16),
        b = parseInt(bestHex.slice(5, 7), 16),
        lab = rgbToOklab(r, g, b),
        lch = rgbToOklch(r, g, b);
      points.push({
        r: r,
        g: g,
        b: b,
        hex: bestHex,
        lab: lab,
        L: lch.L,
        chroma: lch.C,
        hue: lch.H,
        saturation: rgbSaturation(r, g, b),
        weight: row.weight,
        strongWeight: row.strongWeight,
      });
    });
    var chromaticWeight = points.reduce(function (sum, p) {
      return sum + p.weight;
    }, 0);
    if (chromaticWeight / opaqueWeight < 0.035) return paletteFallback(metrics, algorithmVersion);
    function hueSupport(hue, radius) {
      return (
        points.reduce(function (sum, p) {
          return sum + (hueDistanceDegrees(hue, p.hue) <= radius ? p.weight : 0);
        }, 0) / opaqueWeight
      );
    }
    var k = Math.min(
        8,
        Math.max(points.length >= 4 ? 4 : points.length >= 2 ? 2 : 1, Math.round(Math.sqrt(points.length / 8)))
      ),
      centroids = [];
    var first = points.reduce(function (best, p) {
      var score = p.weight * (0.7 + 0.3 * Math.min(1, p.chroma / 0.24));
      return !best || score > best.score ? { p: p, score: score } : best;
    }, null).p;
    centroids.push({ L: first.lab.L, a: first.lab.a, b: first.lab.b });
    while (centroids.length < k) {
      var pick = null,
        pickScore = -1;
      points.forEach(function (p) {
        var nearest = Math.min.apply(
            null,
            centroids.map(function (c) {
              return oklabDistance(p.lab, c);
            })
          ),
          score = nearest * nearest * p.weight;
        if (score > pickScore) {
          pick = p;
          pickScore = score;
        }
      });
      if (!pick || pickScore < 0.00002) break;
      centroids.push({ L: pick.lab.L, a: pick.lab.a, b: pick.lab.b });
    }
    var assignment = new Array(points.length);
    for (var turn = 0; turn < 10; turn++) {
      var sums = centroids.map(function () {
        return { L: 0, a: 0, b: 0, w: 0 };
      });
      points.forEach(function (p, pi) {
        var best = 0,
          dist = Infinity;
        centroids.forEach(function (c, ci) {
          var d = oklabDistance(p.lab, c);
          if (d < dist) {
            dist = d;
            best = ci;
          }
        });
        assignment[pi] = best;
        var sum = sums[best];
        sum.L += p.lab.L * p.weight;
        sum.a += p.lab.a * p.weight;
        sum.b += p.lab.b * p.weight;
        sum.w += p.weight;
      });
      centroids = centroids.map(function (c, ci) {
        var sum = sums[ci];
        return sum.w ? { L: sum.L / sum.w, a: sum.a / sum.w, b: sum.b / sum.w } : c;
      });
    }
    var clusters = centroids
      .map(function (c, ci) {
        var members = points.filter(function (_, pi) {
            return assignment[pi] === ci;
          }),
          weight = members.reduce(function (n, p) {
            return n + p.weight;
          }, 0),
          strongWeight = members.reduce(function (n, p) {
            return n + p.strongWeight;
          }, 0),
          rep = members.reduce(function (best, p) {
            var d = oklabDistance(p.lab, c);
            return !best || d < best.d ? { p: p, d: d } : best;
          }, null);
        if (!rep) return null;
        var lch = rgbToOklch(rep.p.r, rep.p.g, rep.p.b),
          share = weight / opaqueWeight,
          narrowSupport = hueSupport(lch.H, 15),
          saturation = rgbSaturation(rep.p.r, rep.p.g, rep.p.b),
          strong = lch.C >= 0.075 && saturation >= 0.3 && narrowSupport > 0.012,
          support = strong ? narrowSupport : hueSupport(lch.H, 45);
        return {
          hex: rep.p.hex,
          weight: weight,
          strongWeight: strongWeight,
          share: share,
          support: support,
          L: lch.L,
          chroma: lch.C,
          hue: lch.H,
          saturation: saturation,
          strong: strong,
          lab: rep.p.lab,
        };
      })
      .filter(Boolean);
    var candidates = clusters.filter(function (c) {
      return c.strong
        ? c.share >= 0.01 && c.support >= 0.015
        : c.share >= 0.025 && c.support >= 0.035 && c.chroma >= 0.025 && c.saturation >= 0.12;
    });
    if (!candidates.length) return paletteFallback(metrics, algorithmVersion);
    candidates.forEach(function (c) {
      var population = Math.min(1, c.support / 0.25) * 0.52 + Math.min(1, c.share / 0.12) * 0.18,
        chroma = Math.min(1, c.chroma / 0.18) * 0.3;
      c.score = population + chroma + (c.strong ? 0.04 : 0);
    });
    candidates.sort(function (a, b) {
      return b.score - a.score || b.support - a.support || b.share - a.share;
    });
    var strongCandidates = candidates.filter(function (c) {
        return c.strong;
      }),
      primary = (strongCandidates.length ? strongCandidates : candidates)[0],
      secondary = null,
      pairScore = -1;
    for (var ci = 0; ci < candidates.length; ci++) {
      var candidate = candidates[ci];
      if (candidate === primary) continue;
      var hueGap = hueDistanceDegrees(primary.hue, candidate.hue),
        distance = oklabDistance(primary.lab, candidate.lab);
      if (distance < 0.035) continue;
      var diversity = Math.min(1, hueGap / 85),
        harmony = hueGap > 165 ? 0.72 : hueGap > 120 ? 0.86 : 1,
        score = candidate.score * 0.52 + diversity * 0.28 + Math.min(1, distance / 0.24) * 0.14 + harmony * 0.06;
      if (score > pairScore) {
        secondary = candidate;
        pairScore = score;
      }
    }
    if (!secondary) secondary = primary;
    var semanticRows = [primary];
    if (secondary !== primary) semanticRows.push(secondary);
    while (semanticRows.length < Math.min(4, candidates.length)) {
      var next = null,
        nextScore = -1;
      candidates.forEach(function (candidate) {
        if (semanticRows.indexOf(candidate) >= 0) return;
        var nearest = Math.min.apply(
            null,
            semanticRows.map(function (selected) {
              return oklabDistance(candidate.lab, selected.lab);
            })
          ),
          hueNearest = Math.min.apply(
            null,
            semanticRows.map(function (selected) {
              return hueDistanceDegrees(candidate.hue, selected.hue);
            })
          ),
          score = candidate.score * 0.46 + Math.min(1, nearest / 0.22) * 0.3 + Math.min(1, hueNearest / 90) * 0.24;
        if (score > nextScore) {
          next = candidate;
          nextScore = score;
        }
      });
      if (!next) break;
      semanticRows.push(next);
    }
    candidates.forEach(function (c) {
      if (semanticRows.indexOf(c) < 0) semanticRows.push(c);
    });
    var tertiary = semanticRows[2] || secondary,
      sourceColors = [primary.hex, secondary.hex, tertiary.hex],
      sourceType = primary.strong ? 'chromatic' : 'pastel';
    return {
      colors: sourceColors.slice(),
      sourceColors: sourceColors,
      semanticColors: buildSemanticPalette(semanticRows),
      field: paletteField(data, Number(width) || 0, candidates, primary.hex),
      metrics: metrics,
      neutral: false,
      colorSource: sourceType,
      lowChromaIgnored: sourceType === 'chromatic',
      sampleCount: Math.round(opaqueWeight),
      paletteConfidence: Math.round(Math.min(1, primary.score) * 1000) / 1000,
      algorithmVersion: algorithmVersion,
      clusters: candidates.map(function (c) {
        return {
          hex: c.hex,
          share: Math.round(c.share * 1000) / 1000,
          support: Math.round(c.support * 1000) / 1000,
          chroma: Math.round(c.chroma * 1000) / 1000,
          saturation: Math.round(c.saturation * 1000) / 1000,
          hue: Math.round(c.hue * 10) / 10,
          strong: c.strong,
          score: Math.round(c.score * 1000) / 1000,
        };
      }),
    };
  }
  function buildSemanticPalette(clusters) {
    var rows = Array.isArray(clusters)
      ? clusters.filter(function (c) {
          return c && /^#[0-9a-f]{6}$/i.test(String(c.hex || ''));
        })
      : [];
    if (!rows.length) return [];
    var base = rows[0],
      levels = [0.68, 0.62, 0.56, 0.74],
      out = [];
    for (var i = 0; i < 4; i++) {
      var source = rows[i] || rows[i % Math.min(2, rows.length)] || base;
      var lch = rgbToOklch(
        parseInt(String(source.hex).slice(1, 3), 16),
        parseInt(String(source.hex).slice(3, 5), 16),
        parseInt(String(source.hex).slice(5, 7), 16)
      );
      // 语义文字需要鲜明，但色相必须来自图片中已确认的真实色簇。
      out.push(oklchToHex(levels[i], Math.max(0.13, Math.min(0.28, lch.C * 1.18)), lch.H));
    }
    return out;
  }
  function splitReasoningContent(value) {
    var content = sanitizeText(value || ''),
      reasoning = [],
      held = [];
    // MVU `<UpdateVariable>` may contain `<Analysis>`. That is protocol, not model thinking, so it
    // stays in the message body for the variable engine and is stripped later by the display path.
    function hold(pattern) {
      content = content.replace(pattern, function (block) {
        held.push(block);
        return '\uE012' + held.length + '\uE013';
      });
    }
    hold(/<\s*UpdateVariable\b[^>]*>[\s\S]*?<\s*\/\s*UpdateVariable\s*>/gi);
    hold(/<\s*UpdateVariable\b[^>]*>[\s\S]*$/i);
    function take(pattern) {
      content = content.replace(pattern, function (_, body) {
        body = String(body || '').trim();
        if (body) reasoning.push(body);
        return '';
      });
    }
    take(
      /<\s*(?:think|thinking|analysis|reasoning|thought)\b[^>]*>([\s\S]*?)<\s*\/\s*(?:think|thinking|analysis|reasoning|thought)\s*>/gi
    );
    take(/<\|(?:thinking|analysis|reasoning|thought)\|>([\s\S]*?)<\|end_(?:thinking|analysis|reasoning|thought)\|>/gi);
    take(
      /\[(?:think|thinking|analysis|reasoning|thought)\]([\s\S]*?)\[\/(?:think|thinking|analysis|reasoning|thought)\]/gi
    );
    var open = /<\s*(?:think|thinking|analysis|reasoning|thought)\b[^>]*>/i.exec(content);
    if (open) {
      var before = content.slice(0, open.index),
        rest = content.slice(open.index + open[0].length),
        marker =
          /(?:^|\n)\s*(?:最终答案|最终结果|最终回复|最终输出|final\s*(?:answer|response)|answer|output|response)\s*[:：]\s*/i.exec(
            rest
          );
      if (marker) {
        var thought = rest.slice(0, marker.index).trim();
        if (thought) reasoning.push(thought);
        content = before + rest.slice(marker.index + marker[0].length);
      } else {
        var pending = rest.trim();
        if (pending) reasoning.push(pending);
        content = before;
      }
    }
    content = content
      .replace(/<\s*\/\s*(?:think|thinking|analysis|reasoning|thought)\s*>/gi, '')
      .replace(/\uE012(\d+)\uE013/g, function (_, index) {
        return held[Number(index) - 1] || '';
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return {
      content: content,
      reasoning: reasoning
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    };
  }
  function resolveThemeMode(mode, metrics, current) {
    mode = String(mode || 'auto');
    if (mode === 'light' || mode === 'dark') return mode;
    if (typeof metrics === 'number') metrics = { tone: metrics, lightRatio: 0 };
    if (!metrics || typeof metrics.tone !== 'number' || !Number.isFinite(metrics.tone)) return 'dark';
    if (metrics.tone >= 0.5 || metrics.lightRatio >= 0.52) return 'light';
    return 'dark';
  }
  function filterSessions(sessions, query) {
    var q = String(query || '')
      .trim()
      .toLowerCase();
    return (Array.isArray(sessions) ? sessions : []).filter(function (item) {
      return (
        !q ||
        String((item && item.name) || '')
          .toLowerCase()
          .indexOf(q) >= 0
      );
    });
  }
  function redactExportCredentials(value) {
    var copy = JSON.parse(JSON.stringify(value || {}));
    var sensitiveFields = [
      'apiKey',
      'apiKeys',
      'embeddingApiKey',
      'grokSubscriptionAuth',
      'accessToken',
      'refreshToken',
      'access_token',
      'refresh_token',
      'id_token',
      'reverse_proxy',
      'proxy_password',
      'custom_include_headers',
    ];
    function scrub(node) {
      if (!node || typeof node !== 'object') return false;
      var changed = false;
      Object.keys(node).forEach(function (key) {
        if (sensitiveFields.includes(key)) {
          delete node[key];
          changed = true;
          return;
        }
        var child = node[key];
        if (typeof child === 'string') {
          if (!/^\s*[\[{]/.test(child)) return;
          var parsed;
          try {
            parsed = JSON.parse(child);
          } catch (_) {
            return;
          }
          if (parsed && typeof parsed === 'object' && scrub(parsed)) {
            node[key] = JSON.stringify(parsed);
            changed = true;
          }
        } else if (child && typeof child === 'object' && scrub(child)) changed = true;
      });
      return changed;
    }
    scrub(copy);
    return copy;
  }
  function uniqueTextList(values, max) {
    var out = [],
      seen = {};
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var text = sanitizeText(value)
        .replace(/^[\s"“”'‘’【】（）()\[\]]+|[\s"“”'‘’【】（）()\[\]]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      var key = text.toLowerCase();
      if (!text || text.length > 48 || seen[key]) return;
      seen[key] = true;
      out.push(text);
    });
    return max > 0 ? out.slice(0, max) : out;
  }
  function hasCjk(value) {
    return /[\u3400-\u9fff]/.test(String(value || ''));
  }
  function participantId(name, index) {
    var base = String(name || 'participant')
      .toLowerCase()
      .replace(/[^a-z0-9\u3400-\u9fff]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    return 'p_' + (base || index || 'x');
  }
  function extractParticipantRegistry(card) {
    card = card || {};
    var primary = String(card.localizedName || card.name || '角色').trim() || '角色',
      aliases = uniqueTextList([card.name, card.localizedName].concat(card.nameAliases || []), 20),
      scores = {},
      sources = {},
      rawTitle = String(card.name || '').trim(),
      titleSignals =
        /(?:\b(?:rpg|gm|game\s*master|world|simulator|simulation|version|mode|controller|lorebook)\b|角色扮演|游戏主持|世界|模拟器|模拟|版本|模式|控制器|设定集)/i,
      evidenceNames = [];
    // 世界书经常使用“阵营：”“位置：”这类状态字段。它们是资料键，不是说话人。
    var stateLabels =
      /^(?:姓名|名字|年龄|性别|种族|职业|阵营|弹幕|背包|位置|魔法|身体状况|声望|符卡|日元|威胁等级|重要|name|age|gender|sex|race|species|occupation|class|alignment|danmaku|inventory|location|magic|physical status|reputation|spell cards|yen|threat level|important|stats?|status)$/i;
    function evidenceKey(value) {
      return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    }
    function collectSpeakerEvidence(value, source) {
      String(value || '')
        .split(/\r?\n/)
        .forEach(function (line) {
          var m = line.match(/^\s*([^\n:：]{1,36})\s*[:：]\s*(.*)$/);
          if (!m || !m[2].trim()) return;
          var body = m[2].trim(),
            strong = /^["“'‘（(＊*]/.test(body);
          if (strong || (source === 'example' && body.length >= 2)) evidenceNames.push(evidenceKey(m[1]));
        });
    }
    collectSpeakerEvidence(card.mes_example, 'example');
    collectSpeakerEvidence(card.first_mes, 'greeting');
    (Array.isArray(card.alternate_greetings) ? card.alternate_greetings.slice(0, 8) : []).forEach(function (value) {
      collectSpeakerEvidence(value, 'alternate');
    });
    (Array.isArray(card.participants) ? card.participants : []).forEach(function (value) {
      var name = typeof value === 'string' ? value : value && (value.name || value.canonicalName || value.id);
      if (name) evidenceNames.push(evidenceKey(name));
    });
    function hasIndependentSpeakerEvidence(name) {
      return evidenceNames.indexOf(evidenceKey(name)) >= 0;
    }
    function looksLikeStandaloneSlashName(name) {
      var text = String(name || '').trim();
      return (
        !!text &&
        text.length <= 32 &&
        !titleSignals.test(text) &&
        !/^(?:[a-z]?\d+(?:\.\d+)*|[A-Z0-9_.-]{1,8})$/.test(text) &&
        !/^(?:https?|file|data|blob|storage|sdcard|cards?|users?|home|mnt)$/i.test(text) &&
        /[A-Za-z\u3400-\u9fff]/.test(text)
      );
    }
    var slashParts = uniqueTextList(rawTitle.split(/\s*\/\s*/), 12),
      slashEnsemble =
        rawTitle.indexOf('/') >= 0 &&
        slashParts.length >= 2 &&
        slashParts.length <= 8 &&
        slashParts.every(looksLikeStandaloneSlashName) &&
        slashParts.every(hasIndependentSpeakerEvidence),
      plainTitleParts = uniqueTextList(rawTitle.split(/\s*(?:[&＋+、]|\band\b|\bwith\b|和|与)\s*/i), 12),
      titleParts = slashEnsemble ? slashParts : plainTitleParts,
      ensemble = titleParts.length >= 2 && titleParts.length <= 8,
      titleIsController = titleSignals.test(rawTitle);
    function add(name, weight, source) {
      name = String(name || '')
        .replace(/\{\{(?:char|user)\}\}/gi, function (x) {
          return /user/i.test(x) ? '' : ensemble ? '' : primary;
        })
        .replace(/^[\s#*\-]+|[\s#*\-]+$/g, '')
        .trim();
      var explicit =
        ['title', 'card', 'alias', 'participants', 'worldbook-participant', 'worldbook-role'].indexOf(source) >= 0;
      if (
        !name ||
        (!explicit && !hasIndependentSpeakerEvidence(name)) ||
        stateLabels.test(name) ||
        /^(?:用户|旁白|系统|助手|角色|user|you|narrator|system|assistant|character|char)$/i.test(name) ||
        name.length > 40
      )
        return;
      var key = name.toLowerCase();
      scores[key] = (scores[key] || 0) + (weight || 1);
      sources[key] = sources[key] || { name: name, sources: [] };
      sources[key].sources.push(source || 'text');
    }
    function addSpeakerLabels(value, weight, source) {
      var lines = String(value || '').split(/\r?\n/);
      lines.forEach(function (line) {
        var m = line.match(/^\s*([^\n:：]{1,36})\s*[:：]\s*(.*)$/);
        if (!m) return;
        var label = m[1].trim(),
          body = m[2].trim();
        if (!body) return;
        var strong = /^["“'‘（(＊*]/.test(body);
        if (strong || (source === 'example' && body.length >= 2)) add(label, weight, source);
      });
    }
    if (ensemble)
      titleParts.forEach(function (x) {
        add(x, 6, 'title');
      });
    else if (!titleIsController) {
      add(primary, 8, 'card');
      aliases.forEach(function (x) {
        add(x, 2, 'alias');
      });
    }
    // 只有示例、开场白和明确的说话人字段用于自动创建成员，避免把世界书状态键误判为 NPC。
    addSpeakerLabels(card.mes_example, 5, 'example');
    addSpeakerLabels(card.first_mes, 4, 'greeting');
    (Array.isArray(card.alternate_greetings) ? card.alternate_greetings.slice(0, 8) : []).forEach(function (value) {
      addSpeakerLabels(value, 2, 'alternate');
    });
    [card.description, card.personality, card.scenario, card.system_prompt, card.post_history_instructions].forEach(
      function (value) {
        addSpeakerLabels(value, 2, 'card-text');
      }
    );
    (Array.isArray(card.participants) ? card.participants : []).forEach(function (value) {
      var name = typeof value === 'string' ? value : value && (value.name || value.canonicalName || value.id);
      if (name) add(name, 5, 'participants');
    });
    var book = card.character_book,
      bookEntries = book && book.entries;
    bookEntries = Array.isArray(bookEntries)
      ? bookEntries
      : bookEntries && typeof bookEntries === 'object'
        ? Object.values(bookEntries)
        : [];
    bookEntries.forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      var explicit = entry.participants || entry.characters || entry.speakers || entry.character_names;
      (Array.isArray(explicit) ? explicit : [explicit]).filter(Boolean).forEach(function (value) {
        add(typeof value === 'string' ? value : value && value.name, 4, 'worldbook-participant');
      });
      if (entry.role || entry.speaker) add(entry.role || entry.speaker, 4, 'worldbook-role');
      addSpeakerLabels(entry.content, 2, 'worldbook');
    });
    var rows = Object.keys(scores)
      .map(function (key) {
        return {
          key: key,
          name: sources[key].name,
          score: scores[key],
          sources: uniqueTextList(sources[key].sources, 8),
        };
      })
      .filter(function (row) {
        return (!ensemble && !titleIsController && row.name === primary) || row.score >= 4;
      })
      .sort(function (a, b) {
        return b.score - a.score || a.name.localeCompare(b.name);
      })
      .slice(0, 16);
    if (!rows.length && !titleIsController) rows = [{ name: primary, score: 8, sources: ['card'] }];
    var used = {};
    return rows.map(function (row, i) {
      var id = participantId(row.name, i + 1),
        n = 2;
      while (used[id]) id = participantId(row.name, i + 1) + '_' + n++;
      used[id] = true;
      var rowAliases = uniqueTextList([row.name].concat(!ensemble && row.name === primary ? aliases : []), 20);
      return {
        id: id,
        canonicalName: row.name,
        originalName: row.name,
        aliases: rowAliases,
        confidence: Math.min(1, row.score / 8),
        sources: row.sources,
      };
    });
  }
  // `includeOpen` is the streaming reader's view: a code fence or emphasis marker whose partner has
  // not arrived yet is treated as if it closed at the end of the text, so the prefix already reads as
  // the block it is going to be instead of flashing its raw marker. Only the display asks for this;
  // the text that is checkpointed, saved and committed never passes through here.
  function semanticSegments(text, includeOpen) {
    text = String(text || '');
    var pairs = Object.create(null),
      opens = Object.create(null),
      pairCount = 0,
      MAX_SEGMENTS = 8192,
      out = [],
      plain = '',
      i = 0,
      paragraphStarts = [0],
      paragraphBreak = /\r?\n[ \t]*\r?\n/g,
      paragraphMatch,
      codeRanges = [];
    while ((paragraphMatch = paragraphBreak.exec(text)))
      paragraphStarts.push(paragraphMatch.index + paragraphMatch[0].length);
    function escaped(at) {
      var slashes = 0;
      for (var back = at - 1; back >= 0 && text[back] === '\\'; back--) slashes++;
      return slashes % 2 === 1;
    }
    function addPair(start, end, type, marker) {
      if (pairCount >= MAX_SEGMENTS || start < 0 || end <= start || pairs[start]) return;
      pairs[start] = { end: end, type: type, marker: marker };
      pairCount++;
    }
    // 标记后面还没有内容时不临时闭合：一个还没跟上字的尾巴比一个空代码块或空强调更不打眼。
    function addOpen(start, type, marker) {
      if (!includeOpen || start < 0 || start + String(marker).length >= text.length || pairs[start] || opens[start])
        return;
      opens[start] = { end: text.length, type: type, marker: marker, open: true };
    }
    function pairSymmetric(token, type, accept, isolateParagraphs, closeWhenOpen) {
      if (pairCount >= MAX_SEGMENTS) return;
      var open = -1,
        openParagraph = 0,
        paragraph = 0,
        codeIndex = 0,
        nextParagraphStart = 1,
        length = token.length;
      for (var at = 0; at + length <= text.length && pairCount < MAX_SEGMENTS; at++) {
        while (codeIndex < codeRanges.length && at >= codeRanges[codeIndex].end) codeIndex++;
        if (codeIndex < codeRanges.length && at >= codeRanges[codeIndex].start) {
          open = -1;
          at = codeRanges[codeIndex].end - 1;
          continue;
        }
        if (isolateParagraphs)
          while (nextParagraphStart < paragraphStarts.length && at >= paragraphStarts[nextParagraphStart]) {
            paragraph++;
            nextParagraphStart++;
          }
        if (text.slice(at, at + length) !== token || escaped(at) || (accept && !accept(at))) continue;
        if (open < 0) {
          open = at;
          openParagraph = paragraph;
        } else if (!isolateParagraphs || openParagraph === paragraph) {
          addPair(open, at + length, type, token);
          open = -1;
        } else {
          open = at;
          openParagraph = paragraph;
        }
        at += length - 1;
      }
      if (closeWhenOpen) addOpen(open, type, token);
    }
    function pairAsymmetric(openToken, closeToken, type) {
      if (pairCount >= MAX_SEGMENTS) return;
      var stack = [],
        codeIndex = 0,
        openLength = openToken.length,
        closeLength = closeToken.length;
      for (var at = 0; at < text.length && pairCount < MAX_SEGMENTS; at++) {
        while (codeIndex < codeRanges.length && at >= codeRanges[codeIndex].end) codeIndex++;
        if (codeIndex < codeRanges.length && at >= codeRanges[codeIndex].start) {
          stack = [];
          at = codeRanges[codeIndex].end - 1;
          continue;
        }
        if (text.slice(at, at + openLength) === openToken && !escaped(at)) {
          stack.push(at);
          at += openLength - 1;
          continue;
        }
        if (text.slice(at, at + closeLength) === closeToken && !escaped(at) && stack.length) {
          addPair(stack.pop(), at + closeLength, type, openToken);
          at += closeLength - 1;
        }
      }
    }
    function collectCodeRanges() {
      codeRanges = [];
      Object.keys(pairs)
        .concat(Object.keys(opens))
        .sort(function (a, b) {
          return Number(a) - Number(b);
        })
        .forEach(function (start) {
          var pair = pairs[start] || opens[start],
            last = codeRanges[codeRanges.length - 1];
          if (last && Number(start) <= last.end) last.end = Math.max(last.end, pair.end);
          else codeRanges.push({ start: Number(start), end: pair.end });
        });
    }
    pairSymmetric('```', 'code', null, false, true);
    collectCodeRanges();
    pairSymmetric(
      '`',
      'code',
      function (at) {
        return text[at - 1] !== '`' && text[at + 1] !== '`';
      },
      true,
      true
    );
    // Code is opaque to every text marker. An outer marker spanning code stays literal,
    // so links and semantic markers inside code can never escape their protected range.
    collectCodeRanges();
    pairAsymmetric('【', '】', 'bracket');
    pairAsymmetric('（', '）', 'paren');
    pairAsymmetric('(', ')', 'paren');
    pairAsymmetric('[', ']', 'paren');
    pairAsymmetric('“', '”', 'quote');
    pairAsymmetric('「', '」', 'quote');
    pairAsymmetric('『', '』', 'quote');
    pairSymmetric('"', 'quote');
    pairSymmetric('**', 'bold', null, true, true);
    pairSymmetric(
      '*',
      'narration',
      function (at) {
        return text[at - 1] !== '*' && text[at + 1] !== '*';
      },
      true,
      true
    );
    function flush() {
      if (plain) {
        out.push({ type: 'plain', text: plain });
        plain = '';
      }
    }
    while (i < text.length) {
      if (out.length >= MAX_SEGMENTS) {
        plain += text.slice(i);
        break;
      }
      var pair = pairs[i] || opens[i];
      if (pair) {
        flush();
        out.push({ type: pair.type, text: text.slice(i, pair.end), open: pair.open === true, marker: pair.marker });
        i = pair.end;
        continue;
      }
      plain += text[i++];
    }
    flush();
    return out;
  }
  // Block Markdown for message text: GFM tables, ATX headings, lists, block quotes and rules, checked
  // against ST's showdown setup. Lines touched by code (a fence, or inline code spanning lines) and a
  // line shared with an HTML element stay ordinary text, and the text inside every block still goes
  // through semanticSegments. Narrower than showdown on purpose: `#` needs a space, a line followed by
  // `---` is text plus a rule (no setext heading), no indented code, no lazy continuation lines.
  var MD_RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/,
    MD_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/,
    MD_LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}\.)[ \t]+(\S.*)$/,
    MD_QUOTE = /^ {0,3}> ?(.*)$/,
    MD_TABLE_DELIMITER = /^:?-{2,}:?$/,
    MD_BLOCK_HINT = /^(?: {0,3}(?:#{1,6}[ \t]|>|[-*+][ \t]|\d{1,9}\.[ \t]|[-*_][ \t]*[-*_][ \t]*[-*_])|.*\|)/m;
  function markdownIndent(space) {
    return String(space || '').replace(/\t/g, '    ').length;
  }
  function markdownTableCells(line) {
    var source = String(line).trim(),
      cells = [],
      cell = '',
      code = false;
    if (source[0] === '|') source = source.slice(1);
    if (source[source.length - 1] === '|' && source[source.length - 2] !== '\\') source = source.slice(0, -1);
    for (var at = 0; at < source.length; at++) {
      var char = source[at];
      if (char === '\\' && source[at + 1] === '|') {
        cell += '|';
        at++;
      } else if (char === '|' && !code) {
        cells.push(cell.trim());
        cell = '';
      } else {
        if (char === '`') code = !code;
        cell += char;
      }
    }
    cells.push(cell.trim());
    return cells;
  }
  function markdownTable(lines, start) {
    var head = lines[start],
      delimiter = lines[start + 1];
    if (!delimiter || head.opaque || delimiter.opaque || head.text.indexOf('|') < 0 || delimiter.text.indexOf('|') < 0)
      return null;
    var styles = markdownTableCells(delimiter.text),
      headers = markdownTableCells(head.text);
    if (
      headers.length < styles.length ||
      !styles.every(function (cell) {
        return MD_TABLE_DELIMITER.test(cell);
      })
    )
      return null;
    var align = headers.map(function (_, index) {
        var style = styles[index] || '';
        if (/^:.*:$/.test(style)) return 'center';
        if (/:$/.test(style)) return 'right';
        return /^:/.test(style) ? 'left' : '';
      }),
      rows = [],
      at = start + 2;
    while (at < lines.length && !lines[at].opaque && lines[at].text.trim() && lines[at].text.indexOf('|') >= 0) {
      // A row keeps only the cells it wrote (at most the header width); the renderer fills the rest, and a
      // streaming row's last written cell is the one still being typed.
      rows.push(markdownTableCells(lines[at].text).slice(0, headers.length));
      at++;
    }
    return { block: { type: 'table', align: align, head: headers, rows: rows }, end: at };
  }
  function markdownListMarker(line) {
    var match = !line.opaque && !MD_RULE.test(line.text) && line.text.match(MD_LIST_ITEM);
    if (!match) return null;
    var number = /\d/.test(match[2]) ? parseInt(match[2], 10) : null;
    return { indent: markdownIndent(match[1]), ordered: number !== null, number: number, text: match[3] };
  }
  // An ordered list keeps its first number as `start` (null for bullets); showdown writes it out when it is not 1.
  function markdownList(lines, start) {
    var first = markdownListMarker(lines[start]),
      list = { type: 'list', ordered: first.ordered, start: first.number, items: [] },
      item = null,
      at = start;
    while (at < lines.length && !lines[at].opaque) {
      var line = lines[at],
        marker = markdownListMarker(line);
      if (marker) {
        if (marker.indent < first.indent) break;
        if (item && marker.indent >= first.indent + 2) {
          var nested = markdownList(lines, at);
          item.lists.push(nested.list);
          at = nested.end;
          continue;
        }
        if (marker.ordered !== first.ordered) break;
        item = { text: marker.text, lists: [] };
        list.items.push(item);
        at++;
      } else if (!line.text.trim()) {
        // Blank lines between items keep one list; anything else after a blank line ends it.
        var ahead = at + 1;
        while (ahead < lines.length && !lines[ahead].opaque && !lines[ahead].text.trim()) ahead++;
        var following = ahead < lines.length ? markdownListMarker(lines[ahead]) : null;
        if (
          !following ||
          following.indent < first.indent ||
          (following.indent < first.indent + 2 && following.ordered !== first.ordered)
        )
          break;
        at = ahead;
      } else if (item && markdownIndent(line.text.match(/^[ \t]*/)[0]) >= first.indent + 2) {
        item.text += '\n' + line.text.trim();
        at++;
      } else break;
    }
    return { list: list, end: at };
  }
  function markdownBlockList(lines) {
    var blocks = [],
      paragraph = [];
    function flush() {
      if (paragraph.length) blocks.push({ type: 'text', text: paragraph.join('\n') });
      paragraph = [];
    }
    for (var at = 0; at < lines.length; ) {
      var line = lines[at],
        match;
      if (!line.opaque) {
        if (MD_RULE.test(line.text)) {
          flush();
          blocks.push({ type: 'rule' });
          at++;
          continue;
        }
        if ((match = line.text.match(MD_HEADING)) && match[2].trim()) {
          flush();
          blocks.push({ type: 'heading', level: match[1].length, text: match[2] });
          at++;
          continue;
        }
        var table = markdownTable(lines, at);
        if (table) {
          flush();
          blocks.push(table.block);
          at = table.end;
          continue;
        }
        if (MD_QUOTE.test(line.text)) {
          var quoted = [];
          while (at < lines.length && !lines[at].opaque && (match = lines[at].text.match(MD_QUOTE))) {
            quoted.push({ text: match[1], opaque: false });
            at++;
          }
          flush();
          blocks.push({ type: 'quote', blocks: markdownBlockList(quoted) });
          continue;
        }
        var marker = markdownListMarker(line);
        if (marker && marker.indent <= 3) {
          var list = markdownList(lines, at);
          flush();
          blocks.push(list.list);
          at = list.end;
          continue;
        }
      }
      paragraph.push(line.text);
      at++;
    }
    flush();
    // A block element already breaks the line, so blank lines beside it would only add gaps.
    return blocks
      .map(function (block, index) {
        if (block.type !== 'text') return block;
        var text = block.text;
        if (index > 0) text = text.replace(/^(?:[ \t]*\r?\n)+/, '');
        if (index < blocks.length - 1) text = text.replace(/(?:\r?\n[ \t]*)+$/, '');
        return { type: 'text', text: text };
      })
      .filter(function (block) {
        return block.type !== 'text' || block.text !== '';
      });
  }
  function semanticCodeRanges(text, includeOpen, multilineOnly) {
    var ranges = [],
      offset = 0;
    semanticSegments(text, includeOpen).forEach(function (segment) {
      if (segment.type === 'code' && (!multilineOnly || /\n/.test(segment.text)))
        ranges.push([offset, offset + segment.text.length]);
      offset += segment.text.length;
    });
    return ranges;
  }
  function overlapsRange(ranges, start, end) {
    return ranges.some(function (range) {
      return range[0] < end && range[1] > start;
    });
  }
  // options.includeOpen follows semanticSegments; options.leadInline / trailInline mark a first or last
  // line that shares its source line with an inline HTML element, which never starts a block.
  function markdownBlocks(text, options) {
    text = String(text || '');
    options = options || {};
    if (!MD_BLOCK_HINT.test(text)) return [{ type: 'text', text: text }];
    var codeRanges = semanticCodeRanges(text, options.includeOpen === true, true),
      starts = [0],
      breaks = /\r?\n/g,
      found;
    while ((found = breaks.exec(text))) starts.push(found.index + found[0].length);
    var lines = starts.map(function (start, index) {
      var end = index + 1 < starts.length ? starts[index + 1] : text.length;
      return {
        text: text.slice(start, end).replace(/\r?\n$/, ''),
        opaque:
          (index === 0 && options.leadInline === true) ||
          (index === starts.length - 1 && options.trailInline === true) ||
          overlapsRange(codeRanges, start, end),
      };
    });
    return markdownBlockList(lines);
  }
  // Links outside code become slots before semantic scanning, so URL punctuation is opaque.
  // `![alt](src)` is left to the image path.
  function markdownLinks(text, includeOpen) {
    text = String(text || '');
    if (text.indexOf('](') < 0 && !/https?:\/\//i.test(text)) return { text: text, links: [] };
    var links = [],
      codeRanges = semanticCodeRanges(text, includeOpen === true, false),
      output = text.replace(
        /(!?)\[([^[\]\n]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)(?:[ \t]+"[^"\n]*")?\)/g,
        function (raw, image, label, url, at) {
          if (image || overlapsRange(codeRanges, at, at + raw.length)) return raw;
          links.push({ raw: raw, label: label, url: url });
          return '' + (links.length - 1) + '';
        }
      );
    // Recompute ranges after Markdown slots changed offsets. Private-use characters delimit
    // protected links, images and reasoning fragments rather than belonging to a naked URL.
    codeRanges = semanticCodeRanges(output, includeOpen === true, false);
    var emphasisEnds = [];
    function collectEmphasisEnds(source, base, depth) {
      if (depth > 16) return;
      var offset = base;
      semanticSegments(source, false).forEach(function (segment) {
        var markerLength = String(segment.marker || '').length;
        if (segment.type === 'bold' || segment.type === 'narration')
          emphasisEnds.push({ start: offset, end: offset + segment.text.length - markerLength });
        if (segment.type === 'quote' || segment.type === 'paren' || segment.type === 'bracket')
          collectEmphasisEnds(segment.text.slice(markerLength, -markerLength), offset + markerLength, depth + 1);
        offset += segment.text.length;
      });
    }
    collectEmphasisEnds(output, 0, 0);
    output = output.replace(/\bhttps?:\/\/[^\s<>"'`-]+/gi, function (raw, at) {
      if (overlapsRange(codeRanges, at, at + raw.length)) return raw;
      var url = raw,
        suffix = '',
        closing = { ')': '(', ']': '[', '}': '{' };
      var emphasis = emphasisEnds.find(function (range) {
        return at >= range.start && at < range.end && at + raw.length > range.end;
      });
      if (emphasis) {
        suffix = url.slice(emphasis.end - at);
        url = url.slice(0, emphasis.end - at);
      }
      if (/~~$/.test(url) && (output.slice(0, at).match(/~~/g) || []).length % 2 === 1) {
        suffix = '~~' + suffix;
        url = url.slice(0, -2);
      }
      while (url && /[.,!?;:，。！？；：、)\]}>）】》」』”]$/.test(url)) {
        var last = url.slice(-1),
          open = closing[last];
        if (open && url.split(open).length >= url.split(last).length) break;
        suffix = last + suffix;
        url = url.slice(0, -1);
      }
      if (!url) return raw;
      links.push({ raw: url, label: url, url: url });
      return '' + (links.length - 1) + '' + suffix;
    });
    return { text: output, links: links };
  }
  // `options.slots` lets several calls share one token counter, so fragments protected in different
  // parts of the same request never collide. `options.patterns` protects host-supplied control
  // strings that the reader never sees; the array is shared the same way and a pattern without `g` is
  // removed from it once it has matched, so one message spends it once.
  function protectTranslationMarkup(source, options) {
    options = options || {};
    var slots = Array.isArray(options.slots) ? options.slots : [],
      text = String(source || ''),
      nextIndex =
        options.nextIndex && typeof options.nextIndex === 'object' ? options.nextIndex : { value: slots.length };
    function keep(value, kind) {
      var token = '__YEYU_KEEP_' + nextIndex.value++ + '__';
      slots.push({ token: token, value: String(value || ''), kind: kind || '' });
      return token;
    }
    text.replace(/__YEYU_(?:KEEP|PART)_(\d+)__/gi, function (_, index) {
      nextIndex.value = Math.max(nextIndex.value, Number(index) + 1);
      return _;
    });
    // Placeholder-looking source text is user data. Hide it behind a non-colliding slot before any
    // generated separator is introduced, otherwise a literal PART token can split the provider reply
    // and a literal KEEP token nested in a macro can be mistaken for one of our inner slots.
    text = text.replace(/__YEYU_(?:KEEP|PART)_\d+__/gi, function (value) {
      return keep(value, 'source-placeholder');
    });
    function naturalLanguageCodeBlock(body) {
      var value = String(body || ''),
        dialogue = /\[\s*\d{1,2}:\d{2}(?:\s*[AP]M)?\s*\]|\]\s*(?:to|给|对|->)\s*\[/im.test(value),
        label = /^\s*[^\r\n:：]{1,40}\s*[:：]\s+\S/m.test(value),
        program =
          /^\s*(?:#include|import\s|export\s|function\s|const\s|let\s|var\s|class\s|SELECT\s|<\/?[a-z])/im.test(
            value
          ) || /[{};]\s*(?:$|\r?$)/m.test(value);
      return dialogue || label || !program;
    }
    var patterns = Array.isArray(options.patterns) ? options.patterns : [];
    for (var patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
      var pattern = patterns[patternIndex];
      try {
        // The same pattern object serves every span of one message, so its lastIndex must not carry
        // over from the previous span.
        pattern.lastIndex = 0;
        var beforePattern = text;
        text = text.replace(pattern, function (value) {
          return keep(value, 'hidden-trigger');
        });
        // A display script without `g` rewrites one hit in the whole message. Once it has been spent
        // here, the spans that follow must leave their own hits to the translator.
        if (!pattern.global && text !== beforePattern) {
          patterns.splice(patternIndex, 1);
          patternIndex--;
        }
      } catch (_) {}
    }
    text = text.replace(/```([^\r\n]*)\r?\n([\s\S]*?)\r?\n```/g, function (value, language, body) {
      if (!naturalLanguageCodeBlock(body)) return keep(value);
      return keep('```' + String(language || '') + '\n', 'natural-fence') + body + keep('\n```', 'natural-fence');
    });
    text = text.replace(/```[\s\S]*?```/g, function (value) {
      return keep(value);
    });
    text = text.replace(/<\s*(?:audio|video|a)\b[^>]*>[\s\S]*?<\s*\/\s*(?:audio|video|a)\s*>/gi, function (value) {
      return keep(value);
    });
    text = text.replace(/<\s*(?:img|audio|video)\b[^>]*\/?>/gi, function (value) {
      return keep(value);
    });
    text = text.replace(/!?\[[^\]\r\n]*\]\(\s*[\s\S]*?\)/g, function (value) {
      return keep(value);
    });
    text = text.replace(/<[^>\r\n]+>/g, function (value) {
      return keep(value);
    });
    // `}` ends a URL here: macros carry their address inline (`{{audio::https://…}}`), and swallowing
    // the closing pair would leave the macro scan below without a delimiter to find.
    text = text.replace(/https?:\/\/[^\s<>'"）)】}]+/gi, function (value) {
      return keep(value);
    });
    // Macro delimiters nest, so the closing pair is matched by scanning depth rather than by a regex.
    var cursor = 0,
      scanned = '';
    while (cursor < text.length) {
      var open = text.indexOf('{{', cursor);
      if (open < 0) break;
      var depth = 1,
        at = open + 2,
        close = -1;
      while (at < text.length - 1) {
        if (text.slice(at, at + 2) === '{{') {
          depth++;
          at += 2;
          continue;
        }
        if (text.slice(at, at + 2) === '}}') {
          depth--;
          at += 2;
          if (!depth) close = at;
          if (!depth) break;
          continue;
        }
        at++;
      }
      if (close < 0) {
        // An unpaired `{{` loses only its own protection. Giving up on the rest of the text here left
        // every macro after it exposed to the model.
        scanned += text.slice(cursor, open + 2);
        cursor = open + 2;
        continue;
      }
      scanned += text.slice(cursor, open) + keep(text.slice(open, close));
      cursor = close;
    }
    text = scanned + text.slice(cursor);
    return { source: text, slots: slots };
  }
  g.YeyuPure = {
    protectTranslationMarkup: protectTranslationMarkup,
    deepMerge: deepMerge,
    estTokens: estTokens,
    trimToTokenBudget: trimToTokenBudget,
    sanitizeText: sanitizeText,
    parseSSEBuffer: parseSSEBuffer,
    worldBookSelectiveMatch: worldBookSelectiveMatch,
    stablePercent: stablePercent,
    visibleCharacterCount: visibleCharacterCount,
    readableMessageText: readableMessageText,
    matchSnippetHtml: matchSnippetHtml,
    decodeAttrText: decodeAttrText,
    escapeHtmlAttr: escapeHtmlAttr,
    inlineJsArg: inlineJsArg,
    safeImageSource: safeImageSource,
    remoteImageUrl: remoteImageUrl,
    safeImagePresentation: safeImagePresentation,
    extractImageRefs: extractImageRefs,
    cleanCreatorNotes: cleanCreatorNotes,
    safeColor: safeColor,
    analyzeImagePixels: analyzeImagePixels,
    analyzePerceptualPalette: analyzePerceptualPalette,
    buildSemanticPalette: buildSemanticPalette,
    spreadHues: spreadHues,
    identityColor: identityColor,
    identityHue: identityHue,
    colorHue: colorHue,
    splitReasoningContent: splitReasoningContent,
    rgbToOklch: rgbToOklch,
    oklchToHex: oklchToHex,
    contrastRatio: contrastRatio,
    resolveThemeMode: resolveThemeMode,
    filterSessions: filterSessions,
    redactExportCredentials: redactExportCredentials,
    uniqueTextList: uniqueTextList,
    hasCjk: hasCjk,
    extractParticipantRegistry: extractParticipantRegistry,
    semanticSegments: semanticSegments,
    markdownBlocks: markdownBlocks,
    markdownLinks: markdownLinks,
  };
})(typeof window !== 'undefined' ? window : globalThis);
