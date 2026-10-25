// Motion owns only temporary presentation; callers commit visibility and business state synchronously.
var _uiMotions = new Map();
function uiMotionDuration(token) {
  if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  var value = getComputedStyle(document.documentElement)
    .getPropertyValue(token || '--motion-normal')
    .trim();
  return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000) || 0;
}
function finishUiMotion(node) {
  var motion = _uiMotions.get(node);
  if (!motion) return;
  _uiMotions.delete(node);
  motion.animations.forEach(function (animation) {
    animation.cancel();
  });
  if (motion.cleanup) motion.cleanup();
}
function finishUiMotions(root) {
  Array.from(_uiMotions.keys()).forEach(function (node) {
    if (!root || root === node || root.contains(node)) finishUiMotion(node);
  });
}
function runUiMotion(node, tracks, token, cleanup, easingToken) {
  finishUiMotion(node);
  var duration = uiMotionDuration(token);
  if (!duration || !node.isConnected) {
    if (cleanup) cleanup();
    return null;
  }
  var easing = getComputedStyle(document.documentElement)
    .getPropertyValue(easingToken || '--motion-ease')
    .trim();
  var motion = { animations: [], cleanup: cleanup };
  _uiMotions.set(node, motion);
  tracks.forEach(function (track) {
    motion.animations.push(track.node.animate(track.frames, { duration: duration, easing: easing, fill: 'both' }));
  });
  Promise.all(
    motion.animations.map(function (animation) {
      return animation.finished;
    })
  ).then(
    function () {
      if (_uiMotions.get(node) === motion) finishUiMotion(node);
    },
    function () {
      if (_uiMotions.get(node) === motion) finishUiMotion(node);
    }
  );
  return motion;
}
function transitionUiVisibility(node, show, change, kind) {
  if (!node) return;
  var ongoing = _uiMotions.get(node);
  if (ongoing && ongoing.visible === show) return;
  var surface = kind === 'dialog' ? node.querySelector('.modal, .wheel-scheme-dialog') || node : node;
  var before = getComputedStyle(node),
    surfaceBefore = getComputedStyle(surface);
  var display = before.display,
    visible = display !== 'none' && before.visibility !== 'hidden';
  var opacity = before.opacity,
    transform = surfaceBefore.transform;
  finishUiMotion(node);
  change();
  node.setAttribute('aria-hidden', String(!show));
  if ((!show && !visible) || (show && visible && !ongoing) || !uiMotionDuration()) return;

  var savedDisplay = node.style.getPropertyValue('display'),
    savedPriority = node.style.getPropertyPriority('display');
  var wasInert = node.inert;
  if (!show) {
    node.style.setProperty('display', display, 'important');
    node.inert = true;
    node.classList.add('ui-leaving');
  }
  var surfaceStyle = getComputedStyle(surface),
    base = surfaceStyle.transform;
  // Phone sheets (declared by CSS) slide up opaque while only the scrim fades; prompts scale and fade.
  var sheet = kind === 'dialog' && surfaceStyle.getPropertyValue('--panel-motion').trim() === 'sheet';
  var offset =
    (base === 'none' ? '' : base + ' ') +
    (sheet ? 'translateY(100%)' : kind === 'dialog' ? 'translateY(6px) scale(.99)' : 'translateY(-6px) scale(.985)');
  var startTransform = visible ? transform : offset;
  var endTransform = show ? base : offset;
  var tracks;
  if (sheet) {
    var scrim = getComputedStyle(node).backgroundColor;
    tracks = [
      {
        node: node,
        frames: [
          { backgroundColor: visible ? before.backgroundColor : 'transparent' },
          { backgroundColor: show ? scrim : 'transparent' },
        ],
      },
    ];
  } else tracks = [{ node: node, frames: [{ opacity: visible ? opacity : 0 }, { opacity: show ? 1 : 0 }] }];
  if (surface === node) {
    tracks[0].frames[0].transform = startTransform;
    tracks[0].frames[1].transform = endTransform;
  } else tracks.push({ node: surface, frames: [{ transform: startTransform }, { transform: endTransform }] });
  var motion = runUiMotion(
    node,
    tracks,
    show && kind === 'dialog' ? '--motion-panel' : '--motion-normal',
    function () {
      if (!show) {
        if (savedDisplay) node.style.setProperty('display', savedDisplay, savedPriority);
        else node.style.removeProperty('display');
        node.inert = wasInert;
        node.classList.remove('ui-leaving');
      }
    },
    show ? '--motion-ease' : '--motion-exit'
  );
  if (motion) motion.visible = show;
}
function revealUiContent(node, direction) {
  if (!node || !node.getClientRects().length) return;
  var ongoing = _uiMotions.has(node),
    css = getComputedStyle(node);
  var opacity = ongoing ? css.opacity : 0.72,
    transform = ongoing ? css.transform : direction === 0 ? 'none' : 'translateX(' + (direction || 1) * 6 + 'px)';
  runUiMotion(
    node,
    [
      {
        node: node,
        frames: [
          { opacity: opacity, transform: transform },
          { opacity: 1, transform: 'none' },
        ],
      },
    ],
    '--motion-fast'
  );
}
function composerInputMaxHeight() {
  var declared = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chat-input-max-h'));
  return Number.isFinite(declared) && declared > 0 ? declared : 118;
}
function resizeComposerInput(input) {
  var before = input.getBoundingClientRect().height;
  finishUiMotion(input);
  input.style.height = 'auto';
  var height = Math.min(input.scrollHeight, composerInputMaxHeight());
  input.style.height = height + 'px';
  if (before && Math.abs(before - height) > 1 && !document.body.classList.contains('keyboard-open'))
    runUiMotion(
      input,
      [{ node: input, frames: [{ height: before + 'px' }, { height: height + 'px' }] }],
      '--motion-fast'
    );
  requestAnimationFrame(syncComposerMetrics);
}
function setupUiMotion() {
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function () {
    finishUiMotions();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) finishUiMotions();
  });
  window.addEventListener('resize', function () {
    finishUiMotions();
  });
  document.addEventListener(
    'pointerdown',
    function (event) {
      // Input focus must measure settled geometry before the IME changes the viewport.
      if (event.target.closest('input,textarea,[contenteditable=true]')) finishUiMotions();
    },
    true
  );
}
