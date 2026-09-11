<p align="center">
  <img src="assets/icon.png" alt="cute-agents-desk" width="120">
</p>

# cute-agents-desk

<p align="center">
  <img src="https://img.shields.io/badge/platform-windows-0078D6?logo=windows11&logoColor=white" alt="platform: windows">
  <img src="https://img.shields.io/badge/electron-44-47848F?logo=electron&logoColor=white" alt="electron 44">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="license: MIT"></a>
</p>

**Español** | [English](README.en.md)

Panel local para despachar agentes de línea de comandos sobre los repos de la máquina y ver
gráficamente en qué va cada uno.

Cada petición nueva levanta un **coordinador**: es un agente CLI de verdad, no código del
servidor — decide en cuántas sesiones paralelas se divide el trabajo, abre una por agente
(delegando por archivo, nunca por red), recibe sus reportes y mantiene el control global del tema.
Dos motores soportados: **`claude`** (Claude Code) y **`agy`** (Antigravity CLI), con hooks propios
para cada uno — la tarjeta nunca adivina el estado leyendo la terminal.

## Estado

Fases 0 a 4 del plan están hechas y verificadas en vivo (no sólo con mocks):

- **Fase 0** — la interfaz completa, portada del diseño aprobado (`Despacho Local B`), sin colores
  sueltos y sin pedir nada por red.
- **Fase 1** — un agente real por PTY (`node-pty`), con el entorno saneado, hooks reportando cada
  evento, y el diálogo de confianza del workspace respondido automáticamente sólo para carpetas que
  la cuenta registró — nunca una que le haya pasado un coordinador.
- **Fase 2** — descubrimiento real de repos por cuenta de GitHub, tope de paralelismo global y por
  conversación, conversaciones como carpeta con su propio coordinador.
- **Fase 3** — el buzón completo: el coordinador delega escribiendo un `spawn-request`, y el worker
  le reporta de vuelta en tres momentos automáticos (nace, bloqueado, termina) más un cuarto canal
  para mensajes libres — todo tipeado en la propia terminal del coordinador, que es el único canal
  de vuelta que tiene una sesión interactiva.
- **Fase 4** — una tarea en modo escritura corre en su propio `git worktree`, fuera del repo, en vez
  de mutar el checkout compartido. Sin borrado automático: el reap es manual, con su propia tarjeta
  en Configuración.

**No construido todavía**: la fase 5 (rama + PR en borrador + cuenta correcta al entregar) — así que
la frase "sale como rama y PR" describe la intención del diseño, no algo que hoy pase solo.

### Los dos motores, en la práctica

`claude` y `agy` no comparten mecanismo de hooks — cada uno tiene el suyo, medido por separado
(fechas y versiones exactas en los comentarios de `electron/agent.js`, `electron/hook.js` y
`electron/events.js`, no repetidas aquí porque quedarían desactualizadas):

| | `claude` | `agy` |
|---|---|---|
| Config de hooks | `--settings <archivo>`, cualquier ruta | fija en `<cwd>/.agents/hooks.json`, sin flag |
| cwd del proceso | el repo (o su worktree, en modo escritura) | el directorio propio del agente en el harness — el repo entra por `--add-dir` |
| Payload del hook | snake_case (`tool_name`, `tool_input`) | camelCase (`toolCall.name`, `stepIdx`) |
| Aislamiento por worktree | sí | **no todavía** — hueco declarado, no oversight |
| Tokens / costo | statusLine en vivo | sin equivalente conocido — no hay tope de tokens para agy |
| Modo lectura | niega `Edit\|Write\|NotebookEdit` (lista negra) | permite sólo tools confirmadas de sólo lectura (lista blanca) — más estricto a propósito, porque la superficie completa de tools de agy nunca se enumeró |

## Correr

```
npm install
node node_modules/electron/install.js
npm start
```

La segunda línea hace falta porque npm bloquea los scripts de postinstalación, así que `npm install`
deja el paquete de Electron sin su binario. `npm run dev` abre además las DevTools.

## Verificar

No hay suite de test única: cada pieza de plomería tiene su propio `tools/verify-*.js`, con la
misma convención en todos — corridas en vivo contra un `claude`/`agy` real sólo donde hace falta
probar algo que un mock no puede (fase 1, aislamiento de hooks, modo lectura, el motor `agy`
completo), y pruebas unitarias puras de `node:assert` para lógica de máquina de estados (tope de
tokens, scheduler, conversaciones, el drenado del buzón).

```
npm run smoke                          # la ventana entera, sin agentes: 5 pestañas, 0 errores
node tools/verify-phase1.js            # requiere `electron`: un agente claude real de punta a punta
node tools/verify-agy-phase1.js        # lo mismo, con agy
node tools/verify-worktree-isolation.js
node tools/verify-worker-outbox.js
node tools/verify-forced-kill.js       # taskkill externo + aislamiento entre conversaciones
node tools/verify-trust-dialog.js
node tools/verify-scheduler.js
node tools/verify-conversations.js
node tools/verify-token-cap.js
node tools/verify-coordinator-status.js
node tools/verify-discovery.js         # lee los repos reales de la máquina
```

`npm run verify` corre sólo `verify-phase1.js`, el más antiguo del grupo — no es la suite completa.

## Cómo está armado

Sin paso de compilación. La ventana carga `ui/` por un protocolo `app://` en vez de `file://`: el
renderer son módulos ES, y `file://` les da origen nulo, con lo que el navegador rechaza cada
`import`. `app://` es un origen real y no lo alcanza nada fuera del proceso, así que tampoco hay
puerto ni token que cuidar. Las tipografías están en `ui/fonts/`: no se pide nada por red.

### Backend (`electron/`)

| Archivo | Qué hace |
|---|---|
| `main.js` | La ventana, el protocolo `app://`, el registro de agentes vivos y todos los `ipcMain.handle` |
| `preload.js` | La superficie completa que el renderer puede pedirle a la máquina — legible de un vistazo |
| `agent.js` | `spawn()`: un PTY real por agente, saneo de env, el diálogo de confianza, el schema de hooks de cada motor |
| `hook.js` | Lo que la CLI invoca en cada evento; distingue el payload de cada motor y decide si negar una tool en modo lectura |
| `pty-env.js` | El entorno saneado — la razón por la que lanzar el harness desde dentro de una sesión de Claude no rompe `--resume` |
| `paths.js` | Dónde vive cada archivo del harness — un editor de texto es la primera herramienta de debug |
| `events.js` | `Registry`: hook → estado, el buzón worker↔coordinador, `status.json`, el tope de tokens |
| `worktree.js` | Aislamiento por `git worktree` para tareas de escritura (sólo `claude` por ahora) |
| `scheduler.js` | El tope de paralelismo, global y por conversación, impuesto antes de cualquier spawn |
| `conversations.js` | Una conversación es una carpeta: `conversation.json`, `status.json`, `agents/` |
| `coordinator.js` | El prompt del coordinador y el drenado de sus `spawn-requests` |
| `discovery.js`, `accounts.js` | Escaneo real de repos por cuenta de GitHub, con detección de desajuste |
| `toy-repo.js` | El repo de juguete que usan los `tools/verify-*.js` en vivo |

### Frontend (`ui/`)

| Archivo | Qué es |
|---|---|
| `app.js` | Estado, las cinco pestañas y un único manejador de eventos por delegación |
| `data.js` | La costura de datos: por campo, mocks hasta que existe una fuente real — nunca los dos a la vez |
| `sidebar.js` | La barra de conversaciones reales |
| `tokens/` | Tokens del design system Pastel-Tech, más `app.css` con los que sólo usa esta aplicación |
| `app.css` | Reset, animaciones y los controles compartidos |
| `robot.js` | El robot, definido una sola vez y parametrizado por estado |
| `ring.js` | El anillo de tokens y los formateadores |
| `repo-tree.js`, `agent-card.js`, `terminal.js` | Pestaña «Control de agentes» |
| `boss-graph.js`, `timeline.js` | Pestaña «Flujos de trabajo» |
| `editor.js` | Pestaña «Editor»: el árbol de cambios y el diff |
| `tokens-view.js` | Pestaña «Uso» |
| `config.js`, `dialogs.js`, `chat.js` | Pestaña «Configuración» y los diálogos, incluido el panel Ficha/Hilo/Diff de un agente |

Dos convenciones que conviene respetar al editar:

- **Ningún color literal en JavaScript.** Todo color sale de una propiedad personalizada de CSS. Si
  hace falta un valor nuevo, se le pone nombre en `ui/tokens/app.css`.
- **Los componentes son funciones puras** que devuelven una cadena de HTML. La interacción se declara
  con atributos `data-act` y `data-arg`; las acciones viven en `ui/app.js`.

Un detalle que muerde: dentro de un SVG en línea, `stroke="var(--x)"` se ignora en silencio. Hay que
escribirlo como `style="stroke:var(--x)"`.

## El movimiento significa algo

El estado de un agente se lee por color **y** por movimiento, que son dos canales redundantes a
propósito: lo que se mueve está avanzando y lo que está quieto está detenido. Un agente bloqueado
tiene borde rojo punteado y no anima; una arista del grafo con las líneas corriendo es una sesión
trabajando. Con `prefers-reduced-motion` el panel queda entero quieto y el color y las etiquetas
siguen contando lo mismo.
