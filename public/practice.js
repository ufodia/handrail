const $ = (id) => document.getElementById(id);
$('open-preferences')?.addEventListener('click', () => {
  $('preferences').hidden = false;
});
for (const selected of ['profile', 'notifications']) {
  $(`${selected}-tab`)?.addEventListener('click', () => {
    for (const name of ['profile', 'notifications']) {
      $(`${name}-tab`).setAttribute('aria-pressed', String(name === selected));
      $(`${name}-panel`).hidden = name !== selected;
    }
  });
}
$('save-preferences')?.addEventListener('click', () => {
  $('practice-status').textContent =
    'Practice preferences saved for this page view. Nothing was sent.';
  $('continue-summary').hidden = false;
});
$('finish-practice')?.addEventListener('click', () => {
  $('practice-status').textContent = 'Practice complete. You made every click yourself.';
});
