/* Front door: the two door marks (the app's own dot engine) and the pause toggle.
   The hero field is its own thing now — see field.js. */
(() => {
  const D = window.LucaDots;
  if (D) {
    document.querySelectorAll('.door-mark canvas').forEach((c) => {
      D.registerPanel(c, { seed: c.dataset.seed || 'luca', cell: 2, breath: true });
    });
  }

  const toggle = document.getElementById('motion-toggle');
  if (toggle) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let paused = false;
    const apply = () => {
      const off = paused || reduced.matches;
      toggle.setAttribute('aria-pressed', String(off));
      toggle.setAttribute('aria-label', off ? 'Resume page animation' : 'Pause page animation');
      toggle.querySelector('path').setAttribute('d', off ? 'M9 5l10 7-10 7z' : 'M8 6v12M16 6v12');
      toggle.disabled = reduced.matches;
      if (D && D.setMotionPaused) D.setMotionPaused(off);
      if (window.__calmField) window.__calmField.setPaused(off);
    };
    toggle.addEventListener('click', () => { paused = !paused; apply(); });
    reduced.addEventListener('change', apply);
    apply();
  }
})();
