# Plan — Paisaje de Marte cinematográfico (Vite + Three.js)

## Objetivo
Un paisaje marciano "de película" que se vea en vivo en el navegador de Cursor:
- Rocas y terreno rojizo con relieve.
- Cielo color caramelo con polvo en suspensión.
- Sol de tarde bajo, luz cálida y sombras suaves y largas.
- Las dos lunas de Marte: Fobos (más grande, irregular) y Deimos (pequeña).

## Stack
- **Vite** (servidor de desarrollo en `http://localhost:5173`, recarga en vivo).
- **Three.js** (render, sombras PCF suaves, tone mapping ACES, bloom).
- **playwright-core** con `channel: 'chrome'` para revisión headless usando el Chrome
  ya instalado (no descarga navegadores).

## Pasos
1. Instalar Node.js LTS (no estaba instalado) y crear el proyecto en `marte3d/`.
2. Primera versión rápida: terreno procedural, rocas, cielo con shader degradado
   caramelo + halo del sol, luz direccional cálida con sombras, niebla de polvo,
   lunas, partículas de polvo. Encender `npm run dev` de inmediato.
3. `npm run check`: abre la página en Chrome headless, guarda
   `check/captura.png` y `check/errores.txt` (errores/avisos de consola).
   Sale con código ≠ 0 si hay errores.
4. Rondas de mejora (máximo 3): correr `npm run check`, mirar la captura,
   corregir composición, color, sombras, lunas y polvo.
5. Terminar cuando no haya errores y la captura muestre todo lo pedido.

## Controles
- Ratón: arrastrar para orbitar, rueda para zoom (OrbitControls).
