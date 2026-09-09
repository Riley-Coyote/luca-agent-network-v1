# polyphonic.chat front door — local mock

A clickable mock of the proposed flow for signed-out visitors: one root landing with
two doors (the web app, the Mac beta), the desktop beta page unchanged behind the
second door. Built on the desktop landing's tokens, fonts, and dot engine, all served
from `../current-site`.

    cd polyphonic-landing/current-site && npm run build   # /beta needs dist/
    cd ../home && node serve.mjs                          # http://127.0.0.1:8746/

Routes: `/` root landing · `/web/` web-door mock · `/beta/` the desktop beta page.

The hero field (`field.js`) is its own thing, in the register of the signed-out
polyphonic.chat page: a greyscale cloud of about one point per 400 px² of viewport, each
1–1.6 px across with a wider, fainter halo, drifting on a slow divergence-free curl flow and
held loosely to a home so nothing wraps or thins. The cloud is not even — it has a heart,
placed where the dendrite grows: inside that disc it runs about 1.6× the ambient density and
1.3× the resting alpha, thinning back out across the disc's outer third. Nothing moves faster
than about 40 px a second, the cursor parts them within 150 px and they take seconds to come
back, and every change in brightness eases over at least a second and a half — measured
frame-to-frame, the field still moves only about a fifth as much as the page it is modelled
on. The dendrite from the first mock survives as structure only: a diffusion-limited-
aggregation skeleton grows invisibly on a 4 px lattice over about ninety seconds and never
resets, particles that drift close to a grown cell ease onto it over two or three seconds and
settle brighter, and a few a second are drawn in from the growth front so the figure accretes
while you watch — about a thousand points have joined it by ninety-five seconds. Nothing is
ever drawn per lattice cell, so the cloud organises into a soft branching constellation
without a lit square anywhere. Once the skeleton settles the whole field breathes ±10 % over
seven seconds. Reduced motion places the points once and draws a single frame; the pause
button stops the loop, as it does the door marks.
