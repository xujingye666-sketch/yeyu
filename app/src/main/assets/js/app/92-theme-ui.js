// ===== Chat UI =====
var _themeState = 'dark',
  _currentBackgroundMetrics = null,
  // Palette taken from the current background (null: no picture). A named theme only covers it, so
  // leaving the named theme shows this palette again.
  _backgroundPalette = null,
  _backgroundFront = 'a',
  _backgroundAnalysisToken = 0,
  _themeProgressTimer = null,
  _systemBarTimer = null,
  _currentPaletteSeeds = ['#5b5b5b', '#5b5b5b', '#5b5b5b'],
  _currentSemanticSourceColors = [],
  _currentPaletteNeutral = true;
const PALETTE_ALGORITHM_VERSION = 1400;
var _paletteCache = new Map();
function applyTheme(theme) {
  theme = theme === 'light' ? 'light' : 'dark';
  var changed = _themeState !== theme;
  _themeState = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  syncThemeColorMeta();
  applyReadingTones(theme);
  if (typeof risuRefreshFrameAppearance === 'function') risuRefreshFrameAppearance();
  clearTimeout(_systemBarTimer);
  _systemBarTimer = setTimeout(
    function () {
      if (window.AndroidBridge && typeof AndroidBridge.setSystemBars === 'function') {
        try {
          AndroidBridge.setSystemBars(theme === 'light');
        } catch (_) {}
      }
    },
    changed ? 180 : 0
  );
}

function applyConfiguredTheme() {
  var mode = (D && D.settings && D.settings.themeMode) || 'auto';
  applyTheme(window.YeyuPure.resolveThemeMode(mode, _currentBackgroundMetrics, _themeState));
  var named = ((D && D.settings && D.settings.backgroundThemes) || []).find(function (row) {
    return row.name === D.settings.activeBackgroundTheme;
  });
  if (named) applyAccentPalette(named.colors);
  else if (_backgroundPalette) applyAccentPalette(_backgroundPalette.colors, _backgroundPalette);
  else resetAccentColor();
  if (typeof risuRefreshFrameAppearance === 'function') risuRefreshFrameAppearance();
}
// 背景模糊档位 0–100 线性映射到 0–10px；默认档 50 等于沉浸模式原本的 blur(5px)。
const IMMERSIVE_BACKGROUND_BLUR_DEFAULT = 50;
function normalizeImmersiveBackgroundBlur(level) {
  var value = Math.round(Number(level));
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : IMMERSIVE_BACKGROUND_BLUR_DEFAULT;
}
function immersiveBackgroundBlurCss(settings) {
  return normalizeImmersiveBackgroundBlur(settings && settings.immersiveBackgroundBlur) / 10 + 'px';
}
function applyMessageStyle() {
  var immersive = !!(D && D.settings && D.settings.messageStyle === 'immersive');
  document.body.classList.toggle('message-style-immersive', immersive);
  document.documentElement.style.setProperty('--immersive-bg-blur', immersiveBackgroundBlurCss(D && D.settings));
  document.body.classList.toggle(
    'immersive-bg-clear',
    immersive && normalizeImmersiveBackgroundBlur(D.settings.immersiveBackgroundBlur) === 0
  );
  applyReadingTones(_themeState);
  if (typeof risuRefreshFrameAppearance === 'function') risuRefreshFrameAppearance();
  if (typeof cardFrontendResizeFullscreen === 'function') requestAnimationFrame(cardFrontendResizeFullscreen);
}
function characterImageFieldExists(char, field) {
  return !!(
    char &&
    (char[field] || (char._media && char._media[field]) || (char._mediaBlobs && char._mediaBlobs[field]))
  );
}
function characterBackgroundField(char) {
  if (!char) return '';
  if (characterImageFieldExists(char, 'background_image')) return 'background_image';
  var meta = char.importMeta || {},
    avatarDerived = meta.embeddedCardImage || meta.backgroundPresentation === 'avatar-derived';
  return avatarDerived &&
    meta.backgroundExplicit === false &&
    !meta.derivedBackgroundDisabled &&
    characterImageFieldExists(char, 'avatar_image')
    ? 'avatar_image'
    : '';
}
function derivedCharacterBackground(char) {
  var field = characterBackgroundField(char);
  return field
    ? typeof displayImageSrc === 'function'
      ? displayImageSrc(char, field)
      : String(char[field] || '')
    : '';
}
function setThemeProgress(show, text) {
  var el = $('theme-transition');
  if (el) {
    var label = el.querySelector('span');
    if (label && text) label.textContent = text;
    el.classList.toggle('show', !!show);
  }
}
function scheduleThemeProgress(token) {
  clearTimeout(_themeProgressTimer);
  _themeProgressTimer = setTimeout(function () {
    if (token === _backgroundAnalysisToken) setThemeProgress(true);
  }, 180);
}
function invalidateBackgroundThemeRequest() {
  _backgroundAnalysisToken++;
  clearTimeout(_themeProgressTimer);
}
function isBackgroundThemeRequestCurrent(token, charId) {
  var current = typeof getChar === 'function' ? getChar() : null;
  return token === _backgroundAnalysisToken && String((current && current.id) || '') === String(charId || '');
}
function commitBackgroundTheme(imgSrc, result, token, charId, done) {
  if (!isBackgroundThemeRequestCurrent(token, charId)) {
    if (done) done();
    return;
  }
  clearTimeout(_themeProgressTimer);
  var next = _backgroundFront === 'a' ? 'b' : 'a',
    front = $('bg-layer-' + _backgroundFront),
    back = $('bg-layer-' + next);
  if (!front || !back) {
    setThemeProgress(false);
    if (done) done();
    return;
  }
  back.style.backgroundImage = imgSrc ? 'url("' + imgSrc + '")' : '';
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (!isBackgroundThemeRequestCurrent(token, charId)) {
        if (done) done();
        return;
      }
      markBackgroundPresence(!!imgSrc);
      _currentBackgroundMetrics = result ? result.metrics : null;
      _backgroundPalette = result
        ? {
            colors: result.colors,
            semanticColors: result.semanticColors,
            field: result.field,
            neutral: !!result.neutral,
          }
        : null;
      applyConfiguredTheme();
      back.classList.add('active');
      front.classList.remove('active');
      _backgroundFront = next;
      setTimeout(function () {
        if (isBackgroundThemeRequestCurrent(token, charId)) {
          if (!front.classList.contains('active')) front.style.backgroundImage = '';
          setThemeProgress(false);
        }
        if (done) done();
      }, 480);
    });
  });
}
// Immersive text keys on whether a picture is on screen (tokens.css / chat.css `[data-background="image"]`);
// a grey picture still counts, which is why data-palette cannot serve.
function markBackgroundPresence(present) {
  if (present) document.documentElement.setAttribute('data-background', 'image');
  else document.documentElement.removeAttribute('data-background');
}
function clearBackgroundThemeImmediately(token, charId) {
  if (!isBackgroundThemeRequestCurrent(token, charId)) return false;
  clearTimeout(_themeProgressTimer);
  setThemeProgress(false);
  _currentBackgroundMetrics = null;
  _backgroundPalette = null;
  markBackgroundPresence(false);
  applyConfiguredTheme();
  ['a', 'b'].forEach(function (name) {
    var layer = $('bg-layer-' + name);
    if (layer) layer.style.backgroundImage = '';
  });
  return true;
}
async function applyCharBackground(char, showLoading) {
  var charId = (char && char.id) || '',
    token = ++_backgroundAnalysisToken;
  clearTimeout(_themeProgressTimer);
  if (showLoading) setThemeProgress(true, '正在适配角色主题');
  else setThemeProgress(false);
  await cleanScriptBackgroundReferences();
  if (char) {
    await Promise.all([
      hydrateStoredMediaField(char, 'background_image'),
      hydrateStoredMediaField(char, 'avatar_image'),
    ]);
  }
  if (!isBackgroundThemeRequestCurrent(token, charId)) return;
  var selectedSource = await resolveScriptBackground(currentScriptBackgroundReference(char));
  return new Promise(function (resolve) {
    var imgSrc = safeImage(selectedSource, true),
      aspect =
        Math.round(
          ((document.documentElement.clientWidth || window.innerWidth || 1) /
            (document.documentElement.clientHeight || window.innerHeight || 1)) *
            20
        ) / 20,
      cacheKey = (charId || 'none') + '|' + PALETTE_ALGORITHM_VERSION + '|' + aspect;
    if (!imgSrc) {
      commitBackgroundTheme('', null, token, charId, resolve);
      return;
    }
    var cached = _paletteCache.get(cacheKey);
    if (cached && cached.src === imgSrc && cached.algorithmVersion === PALETTE_ALGORITHM_VERSION) {
      commitBackgroundTheme(
        imgSrc,
        {
          colors: cached.colors,
          semanticColors: cached.semanticColors,
          field: cached.field,
          metrics: cached.metrics,
          neutral: cached.neutral,
          algorithmVersion: cached.algorithmVersion,
        },
        token,
        charId,
        resolve
      );
      return;
    }
    if (!showLoading) scheduleThemeProgress(token);
    var settled = false,
      analysisTimer = setTimeout(function () {
        if (settled) return;
        settled = true;
        console.warn('角色背景分析超时，使用中性配色');
        commitBackgroundTheme(imgSrc, null, token, charId, resolve);
      }, 4000);
    analyzeImagePalette(imgSrc, function (result) {
      if (settled) return;
      settled = true;
      clearTimeout(analysisTimer);
      if (!isBackgroundThemeRequestCurrent(token, charId)) {
        resolve();
        return;
      }
      if (!result) {
        commitBackgroundTheme(imgSrc, null, token, charId, resolve);
        return;
      }
      _paletteCache.set(cacheKey, {
        src: imgSrc,
        colors: result.colors,
        semanticColors: result.semanticColors,
        field: result.field,
        metrics: result.metrics,
        neutral: !!result.neutral,
        algorithmVersion: result.algorithmVersion || PALETTE_ALGORITHM_VERSION,
      });
      if (_paletteCache.size > 40) _paletteCache.delete(_paletteCache.keys().next().value);
      commitBackgroundTheme(imgSrc, result, token, charId, resolve);
    });
  });
}

const NEUTRAL_PALETTE_SEED = '#5b5b5b';
function paletteHexList(list) {
  return Array.isArray(list)
    ? list.filter(function (hex) {
        return /^#[0-9a-f]{6}$/i.test(String(hex || ''));
      })
    : [];
}
function hexChannels(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function hexOklch(hex) {
  var rgb = hexChannels(hex);
  return pureApi().rgbToOklch(rgb[0], rgb[1], rgb[2]);
}
// Below this chroma a colour's hue is sampling noise, so it cannot seed a tint.
const ACHROMATIC_CHROMA = 0.03;
function isChromaticHex(hex) {
  return hexOklch(hex).C >= ACHROMATIC_CHROMA;
}
// A seed keeps the background colour's hue and lifts its chroma; tokens.css pins the lightness of
// every role, so the seed's own lightness never reaches the screen.
function paletteSeedHex(hex) {
  var lch = hexOklch(hex);
  return pureApi().oklchToHex(0.62, Math.max(0.14, Math.min(0.27, lch.C * 1.2)), lch.H);
}
function hexRgb(hex) {
  return hexChannels(hex).join(',');
}
function applyPaletteVariables(style, seeds, fieldSeeds) {
  style.setProperty('--accent', seeds[0]);
  style.setProperty('--accent-2', seeds[1]);
  style.setProperty('--accent-3', seeds[2]);
  style.setProperty('--accent-rgb', hexRgb(seeds[0]));
  fieldSeeds.forEach(function (hex, index) {
    style.setProperty('--field-' + (index + 1), hex);
  });
}
function applyAccentPalette(colors, options) {
  options = options || {};
  colors = paletteHexList(colors).filter(isChromaticHex);
  var neutral = options.neutral === true || !colors.length,
    semantic = paletteHexList(options.semanticColors),
    field = paletteHexList(options.field).map(function (hex) {
      return isChromaticHex(hex) ? hex : colors[0];
    }),
    root = document.documentElement;
  if (!semantic.length && !neutral) {
    let p = pureApi();
    semantic =
      p && p.buildSemanticPalette
        ? p.buildSemanticPalette(
            colors.map(function (hex) {
              return { hex: hex };
            })
          )
        : colors.slice();
  }
  var seeds = neutral
      ? [NEUTRAL_PALETTE_SEED, NEUTRAL_PALETTE_SEED, NEUTRAL_PALETTE_SEED]
      : [colors[0], colors[1] || colors[0], colors[2] || semantic.filter(isChromaticHex)[2] || colors[1] || colors[0]].map(function (hex) {
          return paletteSeedHex(hex);
        }),
    // Saved background themes only keep the source colours; they spread over the quadrants in order.
    fieldSeeds = neutral
      ? [NEUTRAL_PALETTE_SEED, NEUTRAL_PALETTE_SEED, NEUTRAL_PALETTE_SEED, NEUTRAL_PALETTE_SEED]
      : (field.length === 4 ? field : [colors[0], colors[1] || colors[0], colors[2] || colors[0], colors[0]]).map(
          function (hex) {
            return paletteSeedHex(hex);
          }
        );
  applyPaletteVariables(root.style, seeds, fieldSeeds);
  applyAmbientLayout(neutral ? null : ambientGlowLayout(seeds.concat(fieldSeeds).join('')));
  root.dataset.palette = neutral ? 'neutral' : 'character';
  _currentPaletteSeeds = seeds;
  _currentPaletteNeutral = neutral;
  _currentSemanticSourceColors = semantic.slice(0, 4);
  applyReadingTones(_themeState);
  syncThemeColorMeta();
}
// A .palette-scope element carries its own seeds instead of the character background's. New wheel
// schemes supply three or four colours, which use the same seed and field derivation as the background.
// A single colour keeps the previous wheel identity theme unchanged for existing schemes.
const PALETTE_SCOPE_HUE_SHIFT = 24;
function applyPaletteScopeSeeds(element, source) {
  var colors = paletteHexList(Array.isArray(source) ? source : [source]);
  if (!element || !colors.length) return;
  element.classList.toggle('wheel-multicolor', colors.length >= 3);
  var seeds;
  if (colors.length >= 3) {
    seeds = colors.slice(0, 3).map(paletteSeedHex);
  } else {
    var seed = paletteSeedHex(colors[0]),
      lch = hexOklch(seed);
    seeds = [seed].concat(
      [PALETTE_SCOPE_HUE_SHIFT, -PALETTE_SCOPE_HUE_SHIFT].map(function (shift) {
        return pureApi().oklchToHex(lch.L, lch.C, (lch.H + shift + 360) % 360);
      })
    );
  }
  var fieldSeeds = colors.length >= 3
    ? [seeds[0], seeds[1], seeds[2], colors[3] ? paletteSeedHex(colors[3]) : seeds[0]]
    : [seeds[0], seeds[1], seeds[2], seeds[0]];
  applyPaletteVariables(element.style, seeds, fieldSeeds);
  applyAmbientLayout(colors.length >= 3 ? ambientGlowLayout(seeds.concat(fieldSeeds).join('')) : null, element.style);
}
function resetAccentColor() {
  applyAccentPalette([], { neutral: true });
}
// Each ambient glow stays in its own corner, because it carries the colour found there; where in that
// corner it sits, its size and how far it reaches follow the palette, so the same background always
// gets the same light and another background gets another. The ranges keep every glow near its
// corner and both glows on a side meeting, so no layout piles the light up or leaves a blank band.
const AMBIENT_GLOW_CORNERS = [
  { left: true, top: true },
  { left: false, top: true },
  { left: true, top: false },
  { left: false, top: false },
];
function ambientGlowLayout(seed) {
  var pick = function (key, min, max) {
      return min + ((max - min) * pureApi().stablePercent(seed + '|' + key)) / 100;
    },
    dominant = Math.floor(pick('dominant', 0, 4)),
    glows = AMBIENT_GLOW_CORNERS.map(function (corner, index) {
      var inset = pick(index + 'x', -15, 40),
        rise = pick(index + 'y', -12, 28),
        boost = index === dominant ? 1.3 : 1;
      return {
        x: corner.left ? inset : 100 - inset,
        y: corner.top ? rise : 100 - rise,
        width: Math.min(160, pick(index + 'w', 70, 130) * boost),
        height: Math.min(84, pick(index + 'h', 34, 62) * boost),
        reach: pick(index + 'r', 70, 100),
      };
    });
  var spread = function (first, second, axis, least) {
    var short = least - (second[axis] - first[axis]);
    if (short <= 0) return;
    first[axis] -= short / 2;
    second[axis] += short / 2;
  };
  // Glows sharing a row or a column keep apart, and the two on a side still meet in the middle.
  spread(glows[0], glows[1], 'x', 45);
  spread(glows[2], glows[3], 'x', 45);
  [
    [0, 2],
    [1, 3],
  ].forEach(function (side) {
    var top = glows[side[0]],
      bottom = glows[side[1]];
    spread(top, bottom, 'y', 55);
    var gap = bottom.y - (bottom.height * bottom.reach) / 100 - (top.y + (top.height * top.reach) / 100) + 10;
    if (gap <= 0) return;
    top.height += (gap / 2) * (100 / top.reach);
    bottom.height += (gap / 2) * (100 / bottom.reach);
  });
  return glows;
}
function applyAmbientLayout(glows, targetStyle) {
  var style = targetStyle || document.documentElement.style,
    percent = function (value) {
      return Math.round(value * 10) / 10 + '%';
    };
  AMBIENT_GLOW_CORNERS.forEach(function (_, index) {
    var name = '--ambient-' + (index + 1),
      glow = glows && glows[index];
    if (!glow) {
      style.removeProperty(name + '-geometry');
      style.removeProperty(name + '-reach');
      return;
    }
    style.setProperty(
      name + '-geometry',
      percent(glow.width) + ' ' + percent(glow.height) + ' at ' + percent(glow.x) + ' ' + percent(glow.y)
    );
    style.setProperty(name + '-reach', percent(glow.reach));
  });
}
// Custom properties keep relative colours unresolved; a hidden styled probe yields the real --bg-base.
function syncThemeColorMeta() {
  var meta = $('theme-color-meta');
  if (!meta) return;
  var probe = $('theme-color-probe');
  if (!probe) {
    probe = document.createElement('i');
    probe.id = 'theme-color-probe';
    probe.hidden = true;
    probe.style.color = 'var(--bg-base)';
    document.head.appendChild(probe);
  }
  meta.setAttribute('content', getComputedStyle(probe).color);
}
function blendHex(fg, bg, alpha) {
  var a = hexChannels(fg),
    b = hexChannels(bg);
  return (
    '#' +
    a
      .map(function (v, i) {
        return Math.round(v * alpha + b[i] * (1 - alpha))
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}
function ensureToneContrast(hex, backgrounds, darkInk, minRatio) {
  var p = pureApi(),
    h = rgbToHsl.apply(null, hexChannels(hex)),
    target = darkInk ? 0.1 : 0.96;
  for (var i = 0; i < 28; i++) {
    var candidate = hslToHex(h),
      ok = backgrounds.every(function (bg) {
        return (p && p.contrastRatio ? p.contrastRatio(candidate, bg) : 7) >= (minRatio || 4.5);
      });
    if (ok) return candidate;
    h[2] += (target - h[2]) * 0.18;
  }
  return hslToHex(h);
}
// Reading tones take their hue from the background clusters; lightness is fixed per theme and the
// chroma stays vivid enough that dialogue, asides and notes read as the character's colours.
// Roles are listed in priority order: narration and bold keep their cluster hue first (it is the body
// colour of character messages), then dialogue, asides and bracket notes. A role closer than
// READING_HUE_GAP to an earlier one moves at most READING_HUE_REACH from its own cluster, so a
// single-hue background yields four neighbouring tones of that hue family rather than colours the
// picture does not have. The closer a role sits to its nearest neighbour, the further its lightness
// moves from `light`/`dark` toward `crowdedLight`/`crowdedDark`; hues READING_HUE_CLEAR apart keep
// the plain levels. The light theme has no room above its levels (4.5:1 on the grey bubble), so
// its tiers step darker. `light` levels are the dark ink of the light theme's own surfaces; `dark`
// levels are pale ink, used by the dark theme and by text on a picture in either theme.
// Without a background every mark is grey; weight and the bracket tint tell them apart.
const READING_TONES = [
  { role: 'bold', source: 1, light: 0.44, dark: 0.9, crowdedLight: 0.44, crowdedDark: 0.9 },
  { role: 'quote', source: 0, light: 0.46, dark: 0.88, crowdedLight: 0.27, crowdedDark: 0.78 },
  { role: 'paren', source: 2, light: 0.48, dark: 0.86, crowdedLight: 0.36, crowdedDark: 0.7 },
  { role: 'bracket', source: 3, light: 0.4, dark: 0.92, crowdedLight: 0.4, crowdedDark: 0.92 },
];
const READING_TONE_ROLES = ['narration', 'bold', 'quote', 'paren', 'bracket'];
const READING_HUE_GAP = 20;
const READING_HUE_REACH = 40;
const READING_HUE_CLEAR = 40;
const READING_CHROMA_MIN = 0.1;
// Pale tones cannot hold much chroma in blue and violet, and dark tones cannot in yellow; the level
// steps toward mid lightness (within a bounded range) until the minimum chroma fits. `reach` (0–1)
// shrinks that range for a tier that must keep its lightness apart from its neighbours.
function readingToneHex(level, chroma, hue, darkInk, reach) {
  var p = pureApi(),
    floor = Math.min(chroma, READING_CHROMA_MIN) * 0.95,
    limit = level + (darkInk ? 0.08 : -0.14) * reach,
    hex = p.oklchToHex(level, chroma, hue);
  while (hexOklch(hex).C < floor && (darkInk ? level < limit : level > limit)) {
    level += darkInk ? 0.02 : -0.02;
    hex = p.oklchToHex(level, chroma, hue);
  }
  return hex;
}
// 0 when every other role is at least READING_HUE_CLEAR away, 1 at READING_HUE_GAP or closer.
function readingHueCrowding(hues, index) {
  var nearest = hues.reduce(function (min, hue, other) {
    var d = Math.abs(hue - hues[index]) % 360;
    return other === index ? min : Math.min(min, d, 360 - d);
  }, 180);
  return Math.max(0, Math.min(1, (READING_HUE_CLEAR - nearest) / (READING_HUE_CLEAR - READING_HUE_GAP)));
}
function readingToneSet(sourceLch, hues, darkInk, contrastSurfaces) {
  var p = pureApi(),
    tones = {};
  READING_TONES.forEach(function (tone, index) {
    var lch = sourceLch[index],
      crowding = lch ? readingHueCrowding(hues, index) : 0,
      plainLevel = darkInk ? tone.light : tone.dark,
      tierShift = (darkInk ? tone.crowdedLight : tone.crowdedDark) - plainLevel,
      level = plainLevel + tierShift * crowding,
      candidate = lch
        ? readingToneHex(
            level,
            Math.max(READING_CHROMA_MIN, Math.min(0.22, lch.C)),
            hues[index],
            darkInk,
            tierShift ? 1 - crowding : 1
          )
        : p.oklchToHex(level, 0, 0);
    tones[tone.role] = ensureToneContrast(candidate, contrastSurfaces, darkInk, 4.5);
  });
  tones.narration = tones.bold;
  return tones;
}
// What the picture shows: its sampled clusters and quadrant colours plus its mean luminance as a grey.
// Null when no picture is on screen.
function pictureSamples() {
  var palette = _backgroundPalette,
    metrics = _currentBackgroundMetrics;
  if (document.documentElement.getAttribute('data-background') !== 'image' || (!palette && !metrics)) return null;
  var samples = palette ? paletteHexList(palette.colors).concat(paletteHexList(palette.field)) : [];
  if (metrics && Number.isFinite(metrics.luminance)) {
    var y = Math.max(0, Math.min(1, metrics.luminance)),
      channel = Math.round(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055));
    samples.push('#' + channel.toString(16).padStart(2, '0').repeat(3));
  }
  return samples.length ? samples : null;
}
// The veils laid over the picture (base.css .bg-layer::after), modelled with the lightness, share of the
// primary seed's chroma and top/bottom alpha of tokens.css --overlay-image-reading (`dark`, also the
// immersive veil in both themes) and the light theme's --overlay-image (`light`); keep the two in sync.
const IMAGE_VEILS = {
  dark: { lightness: 0.14, chromaShare: 0.12, alphas: [0.12, 0.3] },
  light: { lightness: 0.98, chromaShare: 0.035, alphas: [0.2, 0.34] },
};
function veiledPicture(samples, veil, alphas) {
  var accent = hexOklch(_currentPaletteSeeds[0]),
    tint = pureApi().oklchToHex(veil.lightness, accent.C * veil.chromaShare, accent.H);
  return samples.flatMap(function (hex) {
    return alphas.map(function (alpha) {
      return blendHex(tint, hex, alpha);
    });
  });
}
// Immersive text on a picture sits on the background itself, so reading tones are checked against the
// picture samples seen through the lightest part of the reading veil, which clear mode removes, and then
// under the text's black drop shadow (tokens.css --immersive-text-shadow-alpha). Text on a picture is pale
// ink under that shadow in either theme, so this model does not depend on the theme: the same picture
// reads the same in both. Checking against the shadowed backdrop rather than the bare picture lets the
// tones keep their hue on busy pictures. Null when the text sits on a bubble or the plain base.
function immersiveReadingUnderlays() {
  var body = document.body,
    samples = pictureSamples();
  if (!body || !body.classList.contains('message-style-immersive') || !samples) return null;
  var shadowAlpha = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--immersive-text-shadow-alpha')
    ),
    underlays = body.classList.contains('immersive-bg-clear')
      ? samples
      : veiledPicture(samples, IMAGE_VEILS.dark, IMAGE_VEILS.dark.alphas.slice(0, 1));
  if (shadowAlpha > 0) {
    underlays = underlays.map(function (hex) {
      return blendHex('#000000', hex, shadowAlpha);
    });
  }
  return Array.from(new Set(underlays));
}
// A token's resolved colour as sRGB hex plus alpha, read from a hidden styled probe (custom properties
// keep relative colours unresolved).
function tokenColor(name) {
  var probe = $('token-color-probe');
  if (!probe) {
    probe = document.createElement('i');
    probe.id = 'token-color-probe';
    probe.hidden = true;
    document.head.appendChild(probe);
  }
  probe.style.color = 'var(' + name + ')';
  var match = /^(\w+)\((.*)\)$/.exec(getComputedStyle(probe).color.trim()),
    space = match ? match[1] : '',
    parts = match ? match[2].split(/[\s,/]+/).filter(Boolean) : [];
  if (space === 'color') space = parts.shift();
  var n = parts.map(function (part) {
      return part === 'none' ? 0 : part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part);
    }),
    alpha = n.length > 3 ? n[3] : 1,
    channel = function (v) {
      return Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0');
    };
  if (space === 'oklch') return { hex: pureApi().oklchToHex(n[0], n[1], n[2]), alpha: alpha };
  if (space === 'srgb') return { hex: '#' + n.slice(0, 3).map((v) => channel(v * 255)).join(''), alpha: alpha };
  return { hex: '#' + n.slice(0, 3).map(channel).join(''), alpha: alpha };
}
// Bubble text is checked against both ends of the character bubble's wash (tokens.css --message-tint-1/2)
// over its translucent surface (--surface-message), laid over what is behind the bubble: the picture
// seen through both ends of the theme's veil, or the plain base with each corner glow.
function bubbleReadingUnderlays(theme) {
  var samples = pictureSamples(),
    backdrops;
  if (samples) {
    var veil = theme === 'light' ? IMAGE_VEILS.light : IMAGE_VEILS.dark;
    backdrops = veiledPicture(samples, veil, veil.alphas);
  } else {
    var base = tokenColor('--bg-base').hex;
    backdrops = [base].concat(
      [1, 2, 3, 4].map(function (index) {
        var glow = tokenColor('--ambient-' + index);
        return blendHex(glow.hex, base, glow.alpha);
      })
    );
  }
  var surface = tokenColor('--surface-message'),
    tints = [tokenColor('--message-tint-1'), tokenColor('--message-tint-2')];
  return Array.from(
    new Set(
      backdrops.flatMap(function (backdrop) {
        var under = blendHex(surface.hex, backdrop, surface.alpha);
        return tints.map(function (tint) {
          return blendHex(tint.hex, under, tint.alpha);
        });
      })
    )
  );
}
function applyReadingTones(theme) {
  var root = document.documentElement.style,
    p = pureApi(),
    immersiveUnderlays = immersiveReadingUnderlays(),
    // Dark ink only where the theme is light and the text sits on its own surface; text on a picture
    // is always pale ink, whatever the theme.
    darkInk = theme === 'light' && !immersiveUnderlays,
    surface = darkInk ? '#ffffff' : '#26262a',
    contrastSurfaces =
      immersiveUnderlays || (darkInk ? [surface, '#b5b5bd'] : [surface]).concat(bubbleReadingUnderlays(theme)),
    sources = _currentSemanticSourceColors.slice(0, 4),
    primary = hexOklch(_currentPaletteSeeds[0]),
    sourceLch = READING_TONES.map(function (tone) {
      var source = sources[tone.source] || sources[tone.source % Math.max(1, sources.length)];
      return _currentPaletteNeutral || !source ? null : hexOklch(source);
    }),
    hues = p.spreadHues(
      sourceLch.map(function (lch) {
        return lch && lch.H;
      }),
      READING_HUE_GAP,
      READING_HUE_REACH
    ),
    tones = readingToneSet(sourceLch, hues, darkInk, contrastSurfaces),
    plain = p.oklchToHex(
      darkInk ? 0.27 : 0.95,
      _currentPaletteNeutral ? 0 : Math.min(0.016, primary.C * 0.07),
      primary.H
    );
  root.setProperty('--tone-plain', immersiveUnderlays ? ensureToneContrast(plain, contrastSurfaces, false, 4.5) : plain);
  // Accent icons on a picture (the reasoning card) keep the accent hue as pale ink at 3:1 graphic contrast.
  if (immersiveUnderlays)
    root.setProperty(
      '--tone-accent',
      ensureToneContrast(p.oklchToHex(0.82, Math.min(0.16, primary.C), primary.H), contrastSurfaces, false, 3)
    );
  else root.removeProperty('--tone-accent');
  root.setProperty('--tone-invalid', darkInk ? '#9f2035' : '#ff9aa8');
  root.setProperty('--tone-invalid-bg', darkInk ? 'rgba(159,32,53,.10)' : 'rgba(255,120,140,.14)');
  READING_TONE_ROLES.forEach(function (role) {
    root.setProperty('--tone-' + role, tones[role]);
  });
  root.setProperty('--tone-bracket-bg', blendHex(tones.bracket, surface, darkInk ? 0.12 : 0.2));
  root.setProperty('--tone-bracket-border', hexToRgba(tones.bracket, darkInk ? 0.48 : 0.42));
}
function hexToRgba(hex, alpha) {
  return 'rgba(' + hexRgb(hex) + ',' + alpha + ')';
}
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  var max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    h,
    s,
    l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [h, s, l];
}
function hslToHex(hsl) {
  var h = hsl[0],
    s = hsl[1],
    l = hsl[2],
    r,
    g,
    b;
  if (s === 0) {
    r = g = b = l;
  } else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s,
      p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return (
    '#' +
    [r, g, b]
      .map(function (v) {
        return Math.round(v * 255)
          .toString(16)
          .padStart(2, '0');
      })
      .join('')
  );
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function analyzeImagePalette(imgSrc, callback) {
  var img = new Image();
  img.onload = function () {
    try {
      var viewW = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1),
        viewH = Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1),
        targetAspect = viewW / viewH,
        sourceAspect = img.naturalWidth / img.naturalHeight,
        sx = 0,
        sy = 0,
        sw = img.naturalWidth,
        sh = img.naturalHeight;
      if (sourceAspect > targetAspect) {
        sw = img.naturalHeight * targetAspect;
        sx = (img.naturalWidth - sw) / 2;
      } else if (sourceAspect < targetAspect) {
        sh = img.naturalWidth / targetAspect;
        sy = (img.naturalHeight - sh) / 2;
      }
      var canvas = document.createElement('canvas'),
        maxSide = 144;
      if (targetAspect >= 1) {
        canvas.width = maxSide;
        canvas.height = Math.max(48, Math.round(maxSide / targetAspect));
      } else {
        canvas.height = maxSide;
        canvas.width = Math.max(48, Math.round(maxSide * targetAspect));
      }
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        result = window.YeyuPure.analyzePerceptualPalette(data, canvas.width);
      callback(result);
    } catch (e) {
      console.warn('Background analysis failed:', e);
      callback(null);
    }
  };
  img.onerror = function () {
    callback(null);
  };
  img.src = imgSrc;
}

function updateChatUI() {
  if (typeof syncExpressions === 'function') syncExpressions();
  if (typeof hostVariableSchemaSync === 'function') hostVariableSchemaSync();
  const char = getChar();
  document.body.classList.toggle('no-character', !char);
  syncEmptyHomeCopy();
  if (typeof syncTavernUserAvatarImage === 'function') syncTavernUserAvatarImage(char && char.id);
  if (char) {
    const ch = $('chat-header');
    const cw = $('chat-input-wrap');
    const ce = $('chat-empty');
    if (ch) {
      ch.style.display = 'flex';
      ch.style.visibility = '';
    }
    if (cw) {
      cw.style.display = 'flex';
      cw.style.visibility = '';
      requestAnimationFrame(syncComposerMetrics);
    }
    if (ce) ce.style.display = '';
    var visibleBar2 = $('tokens-bar');
    if (visibleBar2) visibleBar2.style.display = 'flex';
    // Ensure mobile has bottom-nav spacing
    if (window.innerWidth <= 768) document.body.classList.add('has-bottom-nav');
    const cn = $('ch-name');
    if (cn) cn.textContent = canonicalCharacterName(char);
    const chAv = $('ch-avatar');
    if (chAv) {
      var headerAvatar =
        typeof displayImageSrc === 'function'
          ? displayImageSrc(char, 'avatar_image')
          : safeImage(char.avatar_image, true);
      chAv.innerHTML = headerAvatar
        ? '<img src=\"' + escAttr(headerAvatar) + '\" alt=\"\" style=\"width:100%;height:100%;object-fit:cover\">'
        : '';
    }
    scheduleTokensBar(char);
    if (typeof syncRisuOptionsUI === 'function') syncRisuOptionsUI();
    var settingsBtn = $('card-settings-btn');
    if (settingsBtn) {
      var showSettings = typeof characterCanOpenCardSettings === 'function' && characterCanOpenCardSettings(char);
      settingsBtn.hidden = !showSettings;
      settingsBtn.style.display = showSettings ? '' : 'none';
    }
    updateWorldBookHeader(char);
    var personaBadge = $('persona-active-badge'),
      effectivePersona = typeof getActivePersona === 'function' ? getActivePersona(char.id) : null,
      isBound = !!(effectivePersona && personaBoundCharIds(effectivePersona).includes(String(char.id || '')));
    if (personaBadge) {
      personaBadge.style.display = effectivePersona ? 'inline-flex' : 'none';
      personaBadge.textContent = effectivePersona
        ? isBound
          ? '扮演：' + effectivePersona.name
          : '人格：' + effectivePersona.name
        : '';
      personaBadge.title = isBound ? '这个角色会自动使用已绑定的人格' : '这个角色正在使用全局默认人格';
      personaBadge.classList.toggle('persona-bound', isBound);
    }
    renderSessions();
    if (typeof renderQuickReplyBar === 'function') renderQuickReplyBar();
    if (typeof renderStscriptRunStatus === 'function') renderStscriptRunStatus();
  } else {
    var token = ++_backgroundAnalysisToken;
    clearBackgroundThemeImmediately(token, '');
    var ch2 = $('chat-header'),
      cw2 = $('chat-input-wrap'),
      tb2 = $('tokens-bar');
    if (ch2) ch2.style.visibility = '';
    if (cw2) cw2.style.visibility = '';
    if (tb2) tb2.style.display = 'none';
    renderSessions();
    closeChatTools();
    var cn2 = $('ch-name'),
      avatar2 = $('ch-avatar');
    if (cn2) cn2.textContent = '';
    if (avatar2) avatar2.innerHTML = '';
    ['wb-active-badge', 'wb-hit-badge', 'mem-badge', 'persona-active-badge'].forEach(function (id) {
      var badge = $(id);
      if (!badge) return;
      badge.textContent = '';
      badge.style.display = 'none';
      badge.removeAttribute('title');
      badge.classList.remove('persona-bound');
    });
    var quick = $('quick-reply-bar');
    if (quick) {
      quick.hidden = true;
      quick.innerHTML = '';
    }
    var scriptStatus = $('stscript-run-status');
    if (scriptStatus) {
      scriptStatus.hidden = true;
      scriptStatus.classList.remove('show');
    }
    var scriptLabel = $('stscript-run-label');
    if (scriptLabel) scriptLabel.textContent = '';
    var nav = $('chat-nav-tools');
    if (nav) {
      nav.style.display = 'none';
      nav.classList.add('is-auto-hidden');
    }
    var anchor = $('chat-anchor-panel');
    if (anchor) {
      anchor.innerHTML = '';
      anchor.classList.remove('open');
      anchor.dataset.ready = '0';
    }
    var bgmPanel = $('card-bgm-panel');
    if (bgmPanel) {
      bgmPanel.hidden = true;
      bgmPanel.classList.remove('open');
    }
    var details = tb2 && tb2.querySelector('details');
    if (details) details.removeAttribute('open');
    if (typeof closeSessionManager === 'function') closeSessionManager();
    var settingsBtn2 = $('card-settings-btn');
    if (typeof syncRisuOptionsUI === 'function') syncRisuOptionsUI();
    if (settingsBtn2) {
      settingsBtn2.hidden = true;
      settingsBtn2.style.display = 'none';
    }
  }
}

function scriptBackgroundReferenceExists(ref) {
  var owner =
    ref &&
    D.characters.find(function (row) {
      return row.id === ref.charId;
    });
  return !!(
    owner &&
    (ref.assetId
      ? (owner.media_assets || []).some(function (asset) {
          return String(asset.id || asset.name) === ref.assetId;
        })
      : ref.field === 'background_image'
        ? characterBackgroundField(owner)
        : ref.field === 'avatar_image' && characterImageFieldExists(owner, 'avatar_image'))
  );
}
async function cleanScriptBackgroundReferences() {
  var sections = [];
  D.characters.forEach(function (char) {
    if (char.selectedBackground && !scriptBackgroundReferenceExists(char.selectedBackground)) {
      delete char.selectedBackground;
      if (!sections.includes('characters')) sections.push('characters');
    }
  });
  Object.values(D.chats || {}).forEach(function (box) {
    (box.sessions || []).forEach(function (sess) {
      if (sess.lockedBackground && !scriptBackgroundReferenceExists(sess.lockedBackground)) {
        delete sess.lockedBackground;
        if (!sections.includes('sessions')) sections.push('sessions');
      }
    });
  });
  if (sections.length) await saveData(sections);
}
function currentScriptBackgroundReference(char) {
  var sess = char && getActiveSession(char.id);
  return (
    (sess && scriptBackgroundReferenceExists(sess.lockedBackground) && sess.lockedBackground) ||
    (char && scriptBackgroundReferenceExists(char.selectedBackground) && char.selectedBackground) || {
      charId: (char && char.id) || '',
      field: 'background_image',
    }
  );
}
function scriptBackgroundAsset(char) {
  var ref = currentScriptBackgroundReference(char),
    owner =
      ref &&
      D.characters.find(function (row) {
        return row.id === ref.charId;
      });
  return owner && ref.assetId
    ? (owner.media_assets || []).find(function (row) {
        return String(row.id || row.name) === ref.assetId;
      })
    : null;
}
// Object URLs the background still needs, which the chat's lifecycle scan cannot see. The chosen picture is in
// use from the moment it is picked, because palette analysis loads it before it reaches a layer, and any
// picture stays in use while either layer still shows it, the outgoing one included.
function backgroundObjectUrlsInUse(char) {
  var selected = scriptBackgroundAsset(char),
    urls = selected && selected.objectUrl ? [selected.objectUrl] : [];
  ['a', 'b'].forEach(function (name) {
    var layer = $('bg-layer-' + name),
      shown = layer && String(layer.style.backgroundImage || '').match(/blob:[^"')\s]+/);
    if (shown) urls.push(shown[0]);
  });
  return urls;
}
async function setScriptBackgroundLock(char, locked) {
  var sess = char && getActiveSession(char.id);
  if (!sess) throw new Error('当前没有可用对话');
  await saveSessionBackgroundLock(char, sess, locked ? currentScriptBackgroundReference(char) : undefined);
  return '';
}
// 把会话锁定到 reference 指向的背景（undefined 为解锁）；保存失败还原。
async function saveSessionBackgroundLock(char, sess, reference) {
  var old = sess.lockedBackground;
  if (JSON.stringify(old) === JSON.stringify(reference)) return;
  if (reference) sess.lockedBackground = reference;
  else delete sess.lockedBackground;
  try {
    await saveData('sessions');
  } catch (error) {
    if (old === undefined) delete sess.lockedBackground;
    else sess.lockedBackground = old;
    throw error;
  }
  if (getChar() && getChar().id === char.id && getActiveSession(char.id) === sess) await applyCharBackground(char);
}
// 图库「添加图片」与生成背景共用同一种角色媒体资产。
function createCharacterGalleryImage(image) {
  return { id: stscriptUid(), name: image.name, kind: 'image', mime: image.mime, data_url: image.data };
}
async function addCharacterGalleryImage(char, image) {
  var asset = createCharacterGalleryImage(image);
  char.media_assets = char.media_assets || [];
  char.media_assets.push(asset);
  try {
    await saveData('characters');
  } catch (error) {
    char.media_assets.splice(char.media_assets.indexOf(asset), 1);
    throw error;
  }
  return asset;
}
// ST /imagine background：只预备图库资产与背景引用，由图片消息一并提交，避免取消留下部分结果。
function prepareGeneratedChatBackground(char, blob, dataUrl) {
  var asset = createCharacterGalleryImage({
    name: '生成背景 ' + new Date().toLocaleString(),
    mime: blob.type,
    data: dataUrl,
  });
  return { asset: asset, reference: { charId: char.id, assetId: String(asset.id) } };
}
async function resolveScriptBackground(ref) {
  if (!ref) return '';
  var char = D.characters.find(function (row) {
    return row.id === ref.charId;
  });
  if (!char) return '';
  if (ref.assetId) {
    var asset = (char.media_assets || []).find(function (row) {
      return String(row.id || row.name) === ref.assetId;
    });
    if (!asset) return '';
    await hydrateReferencedCardAssets(char, [
      { text: '<img src="' + escAttr(asset.name || asset.sourceUrl || '') + '">', displayTextReady: true },
    ]);
    return cardAssetDisplaySrc(asset, char);
  }
  await hydrateStoredMediaField(char, 'background_image');
  await hydrateStoredMediaField(char, 'avatar_image');
  return ref.field === 'avatar_image' ? displayImageSrc(char, 'avatar_image') : derivedCharacterBackground(char);
}
async function characterGalleryItems(char) {
  if (!char) return [];
  var assets = (char.media_assets || []).filter(function (asset) {
    return asset.kind === 'image' || String(asset.mime || '').startsWith('image/');
  });
  await hydrateReferencedCardAssets(
    char,
    assets.map(function (asset) {
      return { text: '<img src="' + escAttr(asset.name || asset.sourceUrl || '') + '">', displayTextReady: true };
    })
  );
  return assets
    .map(function (asset) {
      return {
        name: asset.name || String(asset.id),
        src: cardAssetDisplaySrc(asset, char),
        ref: { charId: char.id, assetId: String(asset.id || asset.name) },
      };
    })
    .filter(function (row) {
      return row.src;
    });
}
async function openCurrentCharacterGallery() {
  try {
    await openCharacterGallery(getChar());
  } catch (error) {
    toast(error.message);
  }
}
async function selectScriptBackground(name) {
  var char = stscriptChar(),
    current = currentScriptBackgroundReference(char);
  if (!name) {
    if (!current) return '';
    let owner = D.characters.find(function (row) {
      return row.id === current.charId;
    });
    var asset =
      owner &&
      (owner.media_assets || []).find(function (row) {
        return String(row.id || row.name) === current.assetId;
      });
    return asset ? asset.name : owner ? owner.name : '';
  }
  var choices = [];
  for (let owner of D.characters) {
    if (characterBackgroundField(owner))
      choices.push({ name: owner.name, ref: { charId: owner.id, field: 'background_image' } });
    choices = choices.concat(
      (owner.media_assets || [])
        .filter(function (asset) {
          return asset.kind === 'image' || String(asset.mime || '').startsWith('image/');
        })
        .map(function (asset) {
          return {
            name: asset.name || String(asset.id),
            ref: { charId: owner.id, assetId: String(asset.id || asset.name) },
          };
        })
    );
  }
  var exact =
    choices.find(function (row) {
      return row.name === name;
    }) ||
    choices.find(function (row) {
      return row.name.toLowerCase().includes(name.toLowerCase());
    });
  if (!exact) throw new Error('没有找到背景：' + name);
  await saveScriptBackgroundSelection(exact.ref);
  return '';
}
async function saveScriptBackgroundSelection(reference, follow) {
  var char = stscriptChar();
  if (!char) throw new Error('当前没有可用角色');
  if (reference && !scriptBackgroundReferenceExists(reference)) throw new Error('所选背景已不存在，请重新选择');
  var old = char.selectedBackground,
    oldTheme = D.settings.activeBackgroundTheme;
  if (reference) char.selectedBackground = reference;
  else delete char.selectedBackground;
  if (follow) delete D.settings.activeBackgroundTheme;
  try {
    await saveData(follow ? ['characters', 'meta'] : 'characters');
  } catch (error) {
    if (old === undefined) delete char.selectedBackground;
    else char.selectedBackground = old;
    D.settings.activeBackgroundTheme = oldTheme;
    throw error;
  }
  applyConfiguredTheme();
  await applyCharBackground(getChar());
}
async function selectScriptTheme(name) {
  if (!name) return D.settings.activeBackgroundTheme || D.settings.themeMode || 'auto';
  var builtin = ['auto', 'light', 'dark'].includes(name),
    named = (D.settings.backgroundThemes || []).find(function (row) {
      return row.name.toLowerCase() === name.toLowerCase();
    });
  if (!builtin && !named) throw new Error('没有找到主题：' + name);
  var oldMode = D.settings.themeMode,
    oldName = D.settings.activeBackgroundTheme;
  if (builtin) {
    D.settings.themeMode = name;
    delete D.settings.activeBackgroundTheme;
  } else D.settings.activeBackgroundTheme = named.name;
  try {
    await saveData('meta');
  } catch (error) {
    D.settings.themeMode = oldMode;
    D.settings.activeBackgroundTheme = oldName;
    throw error;
  }
  applyConfiguredTheme();
  return '';
}
async function createScriptBackgroundTheme(args) {
  if (args.bg) await selectScriptBackground(String(args.bg));
  await applyCharBackground(stscriptChar());
  var source = await resolveScriptBackground(currentScriptBackgroundReference(stscriptChar())),
    palette = Array.from(_paletteCache.values()).find(function (cached) {
      return cached.src === source && cached.algorithmVersion === PALETTE_ALGORITHM_VERSION;
    }),
    name = String(args.name || 'bgcol - ' + (await selectScriptBackground(''))),
    themes = D.settings.backgroundThemes || [],
    existing = themes.findIndex(function (row) {
      return row.name === name;
    });
  if (existing >= 0 && !stscriptIsTrue(args.force)) return '';
  var row = {
    name: name,
    colors: palette ? palette.colors.slice() : _currentPaletteNeutral ? [] : _currentPaletteSeeds.slice(),
  };
  var next = themes.slice();
  if (existing < 0) next.push(row);
  else next[existing] = row;
  D.settings.backgroundThemes = next;
  try {
    await saveData('meta');
  } catch (error) {
    D.settings.backgroundThemes = themes;
    throw error;
  }
  return '';
}
async function openCharacterGallery(char, options) {
  if (!char) throw new Error('请先选择角色');
  var container = document.createElement('div');
  container.className = 'character-gallery';
  var actions = document.createElement('div');
  actions.className = 'script-gallery-actions';
  var upload = document.createElement('button');
  upload.className = 'btn';
  upload.textContent = '添加图片';
  actions.appendChild(upload);
  var follow = document.createElement('button');
  follow.className = 'btn';
  follow.textContent = '跟随角色背景';
  actions.appendChild(follow);
  var lock = document.createElement('button');
  lock.className = 'btn';
  actions.appendChild(lock);
  var grid = document.createElement('div');
  grid.className = 'script-gallery-grid';
  container.append(actions, grid);
  async function refresh() {
    grid.replaceChildren();
    var rows = await characterGalleryItems(char);
    var sess = getActiveSession(char.id);
    lock.textContent = sess && sess.lockedBackground ? '解除背景锁定' : '锁定当前背景';
    if (!rows.length) {
      var empty = document.createElement('p');
      empty.textContent = '还没有图片，添加后可查看或设为背景。';
      grid.appendChild(empty);
    }
    rows.forEach(function (row) {
      var button = document.createElement('button');
      button.className = 'script-gallery-item';
      button.title = '设为背景：' + row.name;
      var img = document.createElement('img');
      img.src = row.src;
      img.alt = row.name;
      button.appendChild(img);
      var label = document.createElement('span');
      label.textContent = row.name;
      button.appendChild(label);
      button.onclick = async function () {
        try {
          await saveScriptBackgroundSelection(row.ref);
        } catch (error) {
          toast(error.message);
        }
      };
      grid.appendChild(button);
    });
  }
  upload.onclick = async function () {
    try {
      var image = await scriptPickImage();
      if (!image) return;
      await addCharacterGalleryImage(char, image);
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  };
  follow.onclick = async function () {
    try {
      await saveScriptBackgroundSelection(null, true);
    } catch (error) {
      toast(error.message);
    }
  };
  lock.onclick = async function () {
    try {
      var sess = getActiveSession(char.id);
      if (!sess) return;
      await setScriptBackgroundLock(char, !sess.lockedBackground);
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  };
  await refresh();
  var dialog = scriptDialog(char.name + ' · 图库', container, [{ label: '完成', value: true }], { wide: true });
  if (!options || options.wait !== false) return dialog;
}
