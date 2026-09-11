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

## Prerrequisitos

- **Windows 10 u 11 (64-bit)**
- **Node.js 20+** y **npm**
- **Git** configurado en el `PATH`
- **GitHub CLI (`gh`)** autenticado (`gh auth status`)
- Motores CLI (al menos uno instalado y disponible en el `PATH`):
  - **Claude Code (`claude`)**
  - **Antigravity CLI (`agy`)**

## Correr y Empaquetar

```bash
npm install
node node_modules/electron/install.js
npm start
```

La segunda línea hace falta porque npm bloquea los scripts de postinstalación, así que `npm install`
deja el paquete de Electron sin su binario.

Otros comandos disponibles:
- `npm run dev`: Inicia la aplicación con las herramientas de desarrollo (DevTools) abiertas.
- `npm run smoke`: Prueba de humo headless sobre la ventana (valida renderizado de 6 pestañas y 0 errores).
- `npm run dist`: Compila el ejecutable portable de Windows (`CuteAgentsDesk-0.1.0-portable.exe`) y el instalador NSIS en `dist/`.
- `npm run icon`: Compila el archivo de ícono para Windows (`assets/icon.ico`) a partir de `assets/icon.png`.
- `npm run rebuild`: Reconstruye dependencias nativas (`node-pty`) contra los headers internos de Electron.

## Verificar

Cada pieza de plomería tiene su propio `tools/verify-*.js`, con la misma convención en todos —
corridas en vivo contra un `claude`/`agy` real sólo donde hace falta probar algo que un mock no
puede (fase 1, aislamiento de hooks, modo lectura, el motor `agy` completo), y pruebas unitarias
puras de `node:assert` para lógica de máquina de estados (tope de tokens, scheduler,
conversaciones, el drenado del buzón).

```bash
npm test        # corre de un tiro los 12 que son rápidos y no necesitan un CLI real ni ventana
npm run smoke   # la ventana entera, sin agentes: 6 pestañas, 0 errores
```

`npm test` (`tools/verify-all.js`) corre los 12 `verify-*.js` que MEDIDO tardan segundos bajo
`node` puro. Los que quedan afuera necesitan un turno real de CLI y/o una ventana de Electron —
son lentos, tienen costo real de API, y los que abren ventana no terminan nunca en una shell sin
GUI (`app.whenReady()` no resuelve ahí). Esos se corren aparte, uno a la vez:

```bash
node tools/verify-phase1.js                                          # agente claude real, de punta a punta
node tools/verify-agy-phase1.js                                      # lo mismo, con agy
npx electron tools/verify-read-mode.js
npx electron tools/verify-hook-isolation.js
npx electron tools/verify-coordinator-e2e.js
```

`npm run verify` sigue siendo sólo `verify-phase1.js`, el más antiguo del grupo — no es la suite
completa, `npm test` sí lo es en su mitad rápida.

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
| `git.js` | Envoltorio con llamadas Git síncronas y asíncronas (`gitAsync`), evitando bloquear el hilo de Node durante escaneos |
| `json-queue.js` | Mecánica central de colas basadas en archivos JSON (`drainJsonQueue`, `watchJsonQueue`) para inboxes y peticiones |
| `tool-name.js` | Normalizador de nombres de herramientas entre Claude Code (`snake_case`) y Antigravity (`camelCase`) |
| `events.js` | `Registry`: hook → estado, el buzón worker↔coordinador, `status.json`, el tope de tokens |
| `worktree.js` | Aislamiento por `git worktree` para tareas de escritura (sólo `claude` por ahora) |
| `scheduler.js` | El tope de paralelismo, global y por conversación, impuesto antes de cualquier spawn |
| `conversations.js` | Una conversación es una carpeta: `conversation.json`, `status.json`, `agents/` |
| `coordinator.js` | El prompt del coordinador y el drenado de sus `spawn-requests` |
| `discovery.js`, `accounts.js` | Escaneo real de repos por cuenta de GitHub, con detección de desajuste |
| `scheduled-tasks.js` | Descubre, solo lectura, las tareas programadas de Claude Desktop y de Antigravity en esta máquina |
| `toy-repo.js` | El repo de juguete que usan los `tools/verify-*.js` en vivo |

### Frontend (`ui/`)

| Archivo | Qué es |
|---|---|
| `app.js` | Estado, las seis pestañas y un único manejador de eventos por delegación |
| `data.js` | La costura de datos: por campo, mocks hasta que existe una fuente real — nunca los dos a la vez |
| `sidebar.js` | La barra de conversaciones reales |
| `tokens/` | Tokens del design system Pastel-Tech, más `app.css` con los que sólo usa esta aplicación |
| `app.css` | Reset, animaciones y los controles compartidos |
| `esc.js` | Utilidad pura para escape seguro de cadenas contra inyecciones HTML en plantillas |
| `robot.js` | El robot, definido una sola vez y parametrizado por estado |
| `ring.js` | El anillo de tokens y los formateadores |
| `repo-tree.js`, `agent-card.js`, `terminal.js` | Pestaña «Control de agentes» |
| `boss-graph.js`, `timeline.js` | Pestaña «Flujos de trabajo» |
| `editor.js` | Pestaña «Editor»: el árbol de cambios y el diff |
| `tokens-view.js` | Pestaña «Uso» |
| `scheduled-tasks-view.js` | Pestaña «Tareas programadas»: lo que Claude Desktop y Antigravity tienen agendado, fuera de este harness |
| `config.js`, `dialogs.js`, `chat.js` | Pestaña «Configuración» y los diálogos, incluido el panel Ficha/Hilo/Diff de un agente |

### Vitrina Web (`website/`)

El proyecto incluye una landing page independiente en `website/index.html` con estética Pastel-Tech y una demostración interactiva de los autómatas y estados de los agentes en SVG puro.

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

## Aprendizajes Clave de Arquitectura

1. **Saneamiento ConPTY en Windows:** En entornos Windows, invocar el harness dentro de una sesión de terminal hereda variables de entorno residuales (`CLAUDE_*`). Limpiar estas variables antes de `pty.spawn()` es imprescindible para evitar corrupciones de estado y fallos silenciosos en banderas como `--resume`.
2. **Operaciones Git asíncronas no bloqueantes:** Delegar comandos de introspección de repositorios a funciones asíncronas (`gitAsync`) preserva la tasa de refresco a 60 FPS en Electron, evitando que repositorios extensos congelen el hilo principal de Node.
3. **Buzón IPC desacoplado por archivos:** La arquitectura de mensajería entre agentes obreros y el coordinador opera mediante colas JSON en disco (`events/` y `outbox/`). Esto prescinde de sockets de red y puertos locales expuestos, eliminando vectores de ataque y garantizando persistencia ante reinicios.
4. **Listas blancas vs. listas negras en agentes de IA:** Para el modo de sólo lectura, una lista negra (`Edit|Write`) es suficiente en motores con herramientas cerradas (Claude Code), pero resulta insuficiente en motores con ejecución de comandos arbitrarios (`agy`). Para estos últimos, la única aproximación segura es invertir la validación a una lista blanca estricta (`view_file`, `list_dir`, `grep_search`, `find_by_name`).
5. **Aislamiento por Git Worktree:** En tareas con permisos de escritura, la mutación directa del checkout de trabajo del usuario es inaceptable. Cada tarea crea un worktree temporal y rama propia (`agent/<id>`) en una ruta de trabajo dedicada, manteniendo el checkout base intacto hasta que los cambios sean revisados formalmente.
