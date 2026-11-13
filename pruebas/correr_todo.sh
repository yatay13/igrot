#!/bin/sh
# Corre todo el banco de pruebas. Lo mismo que hace `npm test`.
set -e
cd "$(dirname "$0")/.."
exec node --test pruebas/guardias.test.mjs pruebas/enlaces.test.mjs pruebas/rutas.test.mjs pruebas/seguridad.test.mjs
