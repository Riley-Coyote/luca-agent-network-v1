/* pages/hand2.js — page 4. The hand again, reworking page 3.
 *
 * Page 3 imports as a builder: this page changes only what the note on page 3
 * said was wrong. The palm is no longer one egg — a flat plate for the back of
 * the hand, a rounder heel, the mound under the thumb — and the skin is no
 * longer one tone.
 */

import { buildHand } from './hand.js';

export default {
  title: 'the hand, again',
  date: '2026-09-02',
  note: 'reworks page 3. the palm as three forms instead of one egg, and a slow '
      + 'unevenness over the skin. same fingers, same light. wider and flatter, which is '
      + 'right, but the heel sits on the plate like a second cushion. the seam between '
      + 'forms is the next thing to solve, not the forms.',
  build: () => buildHand({ palm: 'plates', skin: true, title: 'the hand, again', sub: 'the palm as three forms' }),
};
