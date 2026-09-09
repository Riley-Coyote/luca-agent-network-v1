# polyphonic.chat front door — local mock

A clickable mock of the proposed flow for signed-out visitors: one root landing with
two doors (the web app, the Mac beta), the desktop beta page unchanged behind the
second door. Built on the desktop landing's tokens, fonts, and dot engine, all served
from `../current-site`.

    cd polyphonic-landing/current-site && npm run build   # /beta needs dist/
    cd ../home && node serve.mjs                          # http://127.0.0.1:8746/

Routes: `/` root landing · `/web/` web-door mock · `/beta/` the desktop beta page.
