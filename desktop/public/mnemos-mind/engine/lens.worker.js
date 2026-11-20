/* One of the atlas's helpers: blurs letters through the lens off the main thread, so the page opens sooner.
 * The arithmetic is engine/lens.js, the same code the page would run itself. */
import { lens } from './lens.js';

self.onmessage = ({ data: { id, ink, N, R } }) => {
  const out = lens(ink, N, R);
  self.postMessage({ id, out }, [out.buffer]);
};
