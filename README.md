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

## Características Principales

- **Aislamiento concurrente mediante Git Worktrees:** Las tareas en modo escritura nunca mutan el checkout principal de trabajo. Cada agente (`claude` o `agy`) opera sobre un `git worktree` efímero e independiente con su propia rama semántica (`<engine>/<tarea>-<id>`), garantizando paralelismo real sin colisiones de archivos ni bloqueos de Git. La recolección de worktrees terminados es administrable manualmente desde Configuración.
- **Terminal PTY observable y telemetría profunda de motores:** Integración nativa con pseudo-terminales (`node-pty`) saneadas de variables residuales (`CLAUDE_*`). Monitoreo en tiempo real sin escaneo frágil de buffers: captura eventos de ciclo de vida e invocación de herramientas mediante hooks específicos de cada CLI. Automatiza la aprobación de diálogos de confianza exclusivamente para directorios registrados formalmente por la cuenta activa.
- **Gobernanza multicuenta de GitHub y descubrimiento local:** Detección y mapeo estricto de repositorios locales vinculados a identidades de GitHub (`accounts.json`). Previene fugas de contexto o autoría cruzada entre perfiles personales y profesionales, restringiendo el alcance de ejecución de los agentes exclusivamente a sus carpetas asignadas.
- **Buzón desacoplado basado en archivos y coordinación autónoma:** Arquitectura de comunicación asíncrona sin puertos TCP ni sockets expuestos en red. El agente coordinador delega subtareas generando `spawn-requests` en colas JSON vigiladas en disco. Los workers reportan su estado (nacimiento, bloqueo, finalización y mensajes libres) inyectando entradas directamente en la terminal interactiva del coordinador.
- **Diferenciación de roles y configuración de Coordinador:** El coordinador opera por defecto en el buzón de la conversación (`conversations/<id>/`) orquestando sin modificar código, o sobre un directorio de trabajo (`cwd`) personalizado y editable mediante selector de carpetas nativo. Al crear una nueva conversación o abrir una petición, es posible seleccionar o ingresar la carpeta de trabajo, motor (`claude` o `agy`), modelo, esfuerzo de razonamiento y modo de ejecución. Los agentes (workers) ejecutan las tareas técnicas concretas dentro de sus propios worktrees aislados con contexto limpio al 100%, siguiendo una topología radial (*hub-and-spoke*) donde la delegación no escala privilegios (*Delegation Never Escalates Privilege*). Incluye ciclo de vida seguro de archivado segregado en el panel lateral y eliminación física permanente de disco con protección anti-procesos vivos.
- **Pipeline automatizado de entrega y Pull Requests:** Ciclo de cierre seguro y auditable. Al finalizar una tarea en worktree, el sistema realiza commit con el autor y correo correspondientes a la cuenta asociada, realiza push seguro de la rama a `origin` sin tocar `main`, y crea automáticamente un Pull Request en borrador (`gh pr create --draft`) enlazando el informe de ejecución y persistiendo el registro en `deliveries.json`.
- **Gobernanza de recursos, cuotas de tokens y paralelismo:** Programador de tareas (`scheduler.js`) con límites estrictos de concurrencia a nivel global y por conversación. Telemetría de cuotas oficiales de suscripción consultadas directamente en los CLIs (`claude -p /usage` y `agy -p /usage`) con reporte en tiempo real de porcentaje semanal, ventanas de 5h y fechas de reinicio, complementado con topes diarios locales de seguridad y políticas defensivas de sólo lectura (listas negras en Claude vs. listas blancas estrictas en Antigravity).
- **Visualización radial de flujos y enlaces de dependencias:** Pestaña "Flujos de trabajo" con grafo SVG radial (`ui/boss-graph.js`) que muestra al coordinador en el hub central con telemetría interactiva en vivo, trabajadores orbitando en el anillo, y arcos dinámicos animados representando dependencias (`dependsOn`) y transferencias de contexto entre agentes. Soporta archivado atómico no destructivo y gestión de sesiones en reposo. Cada nodo lleva, cuando aplica, un candado de modo lectura y el resultado (✓/✗) del último test o verify que el agente corrió; el contador "bloqueados" cuenta llamadas realmente denegadas por el hook de modo lectura (no un estimado), y las tareas que el `Scheduler` tiene en cola por una dependencia o abortó en cascada aparecen como entradas fantasma en la fila de aparcados, en vez de estar invisibles hasta que arrancan.

### Los dos motores, en la práctica

`claude` y `agy` no comparten mecanismo de hooks — cada uno tiene el suyo, medido por separado
(fechas y versiones exactas en los comentarios de `electron/agent.js`, `electron/hook.js` y
`electron/events.js`, no repetidas aquí porque quedarían desactualizadas):

| | `claude` | `agy` |
|---|---|---|
| Config de hooks | `--settings <archivo>`, cualquier ruta | fija en `<cwd>/.agents/hooks.json`, sin flag |
| cwd del proceso | el repo (o su worktree, en modo escritura) | el directorio propio del agente en el harness — el repo entra por `--add-dir` |
| Payload del hook | snake_case (`tool_name`, `tool_input`) | camelCase (`toolCall.name`, `stepIdx`) |
| Aislamiento por worktree | sí | sí — `--add-dir <worktree>` con hooks en el harness |
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
puede (aislamiento de hooks, modo lectura, el motor `agy` completo), y pruebas unitarias
puras de `node:assert` para lógica de máquina de estados (tope de tokens, scheduler,
conversaciones, el drenado del buzón).

```bash
npm test        # corre de un tiro los 33 que son rápidos y no necesitan un CLI real ni ventana
npm run smoke   # la ventana entera, sin agentes: 6 pestañas, 0 errores
```

`npm test` (`tools/verify-all.js`) corre los 33 `verify-*.js` que MEDIDO tardan segundos bajo
`node` puro. Los que quedan afuera necesitan un turno real de CLI, una ventana de Electron o validación
del binario empaquetado (`verify-dist-binary.js` tras `npm run dist`). Esos se corren aparte, uno a la vez:

```bash
node tools/verify-dist-binary.js                                     # valida el ejecutable empaquetado en dist/
npm run verify:claude                                                # agente claude real, de punta a punta (tools/verify-claude-live.js)
npm run verify:agy                                                   # lo mismo, con agy (tools/verify-agy-live.js)
npx electron tools/verify-read-mode.js
npx electron tools/verify-hook-isolation.js
npx electron tools/verify-coordinator-e2e.js
```

Para la filosofía de pruebas, diseño del arnés virtual y directrices paso a paso para crear y registrar nuevos tests, consulta [docs/testing-guidelines.md](docs/testing-guidelines.md).

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
| `worktree.js` | Aislamiento por `git worktree` para tareas de escritura (`claude` y `agy`) con nombres de rama semánticos |
| `delivery.js` | Pipeline de entrega: autoría de cuenta, commits, push seguro a `origin` y PR en borrador (`gh pr create --draft`) |
| `scheduler.js` | El tope de paralelismo y orquestación acíclica de tareas (DAG con detección DFS de ciclos y cascada fail-fast) |
| `conversations.js` | Una conversación es una carpeta: `conversation.json`, `status.json`, `agents/` |
| `coordinator.js` | El prompt del coordinador y el drenado de sus `spawn-requests` |
| `config.js` | Almacén endurecido de configuración (`config.json`): defaults canónicos, deep merge, guardas contra Prototype Pollution, acotamiento numérico y reemplazo atómico |
| `scheduled-tasks.js` | Descubre, solo lectura, las tareas programadas de Claude Desktop y de Antigravity en esta máquina, e inspecciona sus logs de ejecución |
| `skills.js` | Descubre las skills instaladas en los directorios de Claude y AGY, lee su contenido (`SKILL.md`) y estima su impacto en tokens |
| `quotas.js` | Módulo de consulta no interactiva con timeout estricto, terminación forzada en Windows (`taskkill`) y caché TTL (60s) para `/usage` de Claude y AGY |
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
| `repo-tree.js`, `agent-card.js`, `terminal.js` | Pestaña «Control de agentes»: árbol de directorios jerárquico colapsable con burbujeo de estado en tiempo real, filtros y cola de tareas |
| `boss-graph.js` | Pestaña «Flujos de trabajo» |
| `visualizer.js`, `highlight.js` | Pestaña «Visualizador»: árbol de cambios sin integrar, diff de aprobación con resaltado ligero de sintaxis y apertura en editor externo |
| `tokens-view.js` | Pestaña «Uso»: métricas en vivo, desglose por motor/cuenta, ritmo medido y panel de cuotas oficiales de CLI |
| `scheduled-tasks-view.js` | Pestaña «Tareas programadas»: lo que Claude Desktop y Antigravity tienen agendado, con inspección interactiva de logs |
| `config.js`, `dialogs.js`, `chat.js` | Pestaña «Configuración» e inspectores modales (`SKILL.md`, logs de cron, apertura en Explorer) y panel Ficha/Hilo/Diff |

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
6. **Persistencia atómica y blindaje contra Prototype Pollution en configuración de escritorio:** Guardar preferencias mutables (`config.json`) mediante buffers temporales con nonce aleatorio (`nonce = ${pid}.${Date.now()}.${random}`) y reemplazo atómico (`renameSync` con fallback a copia) previene el truncado a 0 bytes en caídas abruptas. Asimismo, filtrar rigurosamente propiedades mágicas (`__proto__`, `constructor`, `prototype`) y acotar rangos numéricos (`maxParallel: [1..20]`) neutraliza vectores de DoS o *fork bombs* antes de que alcancen el planificador de procesos.
7. **Virtualización jerárquica y desambiguación canónica de repositorios:** En entornos con múltiples cuentas y repositorios anidados, aplanar la estructura bajo las raíces declaradas genera listas inmanejables de 50+ elementos y errores silenciosos de validación de directorio de trabajo (`cwd`). Construir un árbol jerárquico N-ario colapsable con acumulación de métricas y banderas en una única pasada lineal ($O(N)$), junto con el rastreo canónico de rutas absolutas, previene el secuestro de tareas entre repositorios con nombres idénticos (ej. `simplit/infra/infra-k8s` vs `simplit/paul/infra-k8s`) y mantiene el repintado de la interfaz instantáneo.
8. **Consumo seguro de I/O y estimación acotada de contexto en herramientas del sistema:** Al exponer la inspección interactiva de artefactos locales (`SKILL.md`, logs de sidecars en ejecución), cargar archivos arbitrarios en memoria expone a la aplicación a bloqueos del hilo principal de Node ante archivos gigabíticos o malformados. Implementar lecturas mediante descriptores de archivo con búferes fijos (64 KB para `SKILL.md` y lectura acotada del tail para archivos `.log`), neutralización de extensiones ejecutables antes de invocar `shell.openPath`, y algoritmos de proyección temporal finita (horizonte de 14 días para expresiones cron) garantiza que la inspección sea instantánea, hermética y libre de fugas de memoria o DoS.

