/* Keeps a finished drawing in this browser, off the page's thread: the drawing is handed over (moved, not copied),
 * written to IndexedDB as one Blob (so reading it back is a single quick read), and the worker lets itself go. On the
 * page, copying a few hundred megabytes cost a frame or more; here it costs the page nothing. */
onmessage = ({ data: { key, record } }) => {
  const open = indexedDB.open('mnemos-mind', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('drawings');
  open.onerror = () => postMessage({ ok: false });
  open.onsuccess = () => {
    const tx = open.result.transaction('drawings', 'readwrite');
    tx.objectStore('drawings').put({ ...record, out: { ...record.out, data: new Blob([record.out.data]) } }, key);
    tx.oncomplete = () => postMessage({ ok: true });
    tx.onerror = tx.onabort = () => postMessage({ ok: false });
  };
};
