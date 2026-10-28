(async () => {
  try {
    const response = await fetch('downloads/current.json', { cache: 'no-store' });
    if (!response.ok) return;
    const release = await response.json();
    if (release.version !== '1.0.0' || !/^Svoi-Setup-Windows-1\.0\.0-x64\.exe$/.test(release.file) || !/^[a-f0-9]{64}$/.test(release.sha256) || !Number.isSafeInteger(release.size)) return;
    document.querySelectorAll('.download-button').forEach(link => { link.href = `downloads/${release.file}`; });
    const megabytes = `${(release.size / 1024 / 1024).toFixed(1)} МБ`;
    document.getElementById('download-size').textContent = `Windows 10/11 · x64 · ${megabytes} · версия ${release.version}`;
    document.getElementById('file-size').textContent = `Версия ${release.version} · ${megabytes}`;
    const button = document.getElementById('copy-hash');
    button.hidden = false;
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(release.sha256);
      document.getElementById('copied').hidden = false;
      setTimeout(() => { document.getElementById('copied').hidden = true; }, 2000);
    });
  } catch { /* Direct download remains available without release metadata. */ }
})();
