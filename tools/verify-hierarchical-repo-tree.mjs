// @ts-check
/**
 * Verifies the hierarchical repository tree builder and rendering in ui/repo-tree.js.
 * Tests nested subfolder grouping, search filtering on relPath, and collapsible toggles.
 *
 * Run with: node tools/verify-hierarchical-repo-tree.mjs
 */

import assert from 'node:assert';
import * as data from '../ui/data.js';
import { renderRepoTree } from '../ui/repo-tree.js';

const accounts = [
  {
    id: 'work-account',
    name: 'Work Account',
    email: 'work@example.com',
    color: 'var(--color-mint)',
    folders: [{ path: 'C:/Users/mock/Work/Repositories', depth: 3 }],
  },
  {
    id: 'personal-account',
    name: 'Personal Account',
    email: 'pers@example.com',
    color: 'var(--color-lilac)',
    folders: [{ path: 'C:/Users/mock/Repos', depth: 2 }],
  },
];

const repos = [
  {
    path: 'C:/Users/mock/Work/Repositories/external/nvidia-tools',
    name: 'nvidia-tools',
    accountGh: 'work-account',
    folder: 'C:/Users/mock/Work/Repositories',
    relPath: 'external/nvidia-tools',
    subfolder: 'external',
    branch: 'main',
    dirty: false,
    remote: 'git@github.com:x/nvidia-tools.git',
    mismatch: false,
  },
  {
    path: 'C:/Users/mock/Work/Repositories/simplit/ada/ada-chat-frontend',
    name: 'ada-chat-frontend',
    accountGh: 'work-account',
    folder: 'C:/Users/mock/Work/Repositories',
    relPath: 'simplit/ada/ada-chat-frontend',
    subfolder: 'simplit/ada',
    branch: 'main',
    dirty: true,
    remote: 'git@github.com:x/ada-chat-frontend.git',
    mismatch: false,
  },
  {
    path: 'C:/Users/mock/Work/Repositories/simplit/data-domain/datamart',
    name: 'datamart',
    accountGh: 'work-account',
    folder: 'C:/Users/mock/Work/Repositories',
    relPath: 'simplit/data-domain/datamart',
    subfolder: 'simplit/data-domain',
    branch: 'main',
    dirty: false,
    remote: 'git@github.com:x/datamart.git',
    mismatch: false,
  },
  {
    path: 'C:/Users/mock/Work/Repositories/root-utility',
    name: 'root-utility',
    accountGh: 'work-account',
    folder: 'C:/Users/mock/Work/Repositories',
    relPath: 'root-utility',
    subfolder: '',
    branch: 'main',
    dirty: false,
    remote: 'git@github.com:x/root-utility.git',
    mismatch: false,
  },
  {
    path: 'C:/Users/mock/Repos/cute-agents-desk',
    name: 'cute-agents-desk',
    accountGh: 'personal-account',
    folder: 'C:/Users/mock/Repos',
    relPath: 'cute-agents-desk',
    subfolder: '',
    branch: 'main',
    dirty: false,
    remote: null,
    mismatch: false,
  },
];

data.setLiveRepoData({ accounts, repos });

// 1. Initial render with account and root folder open
const state = {
  open: {
    'work-account': true,
    'C:/Users/mock/Work/Repositories': true,
  },
  filtersOpen: false,
  accFilter: 'all',
  stFilter: 'any',
  search: '',
};

let html = renderRepoTree(state, data);

// Check that root-utility (direct repo) is rendered
assert.ok(html.includes('root-utility'), 'root-utility deberia estar presente en el HTML');

// Check that top-level subfolders "external/" and "simplit/" are rendered as nodes
assert.ok(html.includes('external/'), 'subcarpeta external/ deberia renderizarse como nodo');
assert.ok(html.includes('simplit/'), 'subcarpeta simplit/ deberia renderizarse como nodo');
assert.ok(html.includes('data-act="toggleNode" data-arg="C:/Users/mock/Work/Repositories::external"'),
  'nodo external debe tener su toggleNode action');

// 2. Open "simplit"
state.open['C:/Users/mock/Work/Repositories::simplit'] = true;
html = renderRepoTree(state, data);

// Nested subfolders "ada/" and "data-domain/" should now be visible
assert.ok(html.includes('ada/'), 'subcarpeta anidada ada/ deberia verse tras abrir simplit');
assert.ok(html.includes('data-domain/'), 'subcarpeta anidada data-domain/ deberia verse tras abrir simplit');

// 3. Open "simplit/ada"
state.open['C:/Users/mock/Work/Repositories::simplit/ada'] = true;
html = renderRepoTree(state, data);
assert.ok(html.includes('ada-chat-frontend'), 'repo anidado ada-chat-frontend deberia verse al abrir su subcarpeta');

// 4. Test search across relative paths (e.g. search "data-domain")
state.search = 'data-domain';
html = renderRepoTree(state, data);
assert.ok(html.includes('datamart'), 'busqueda por relPath deberia encontrar datamart');
assert.ok(!html.includes('ada-chat-frontend'), 'ada-chat-frontend no coincide con data-domain y debe filtrarse');
state.search = '';

// 5. Test explicit collapse even when an agent is active in that folder
data.setLiveAgents([{ id: 'agent-1', repo: 'ada-chat-frontend' }]);
state.open['C:/Users/mock/Work/Repositories::simplit/ada'] = false;
html = renderRepoTree(state, data);
// With explicit false, the subfolder must collapse despite active agent
assert.ok(!html.includes('data-arg="C:/Users/mock/Work/Repositories/simplit/ada/ada-chat-frontend"'),
  'un clic explicito de cierre debe colapsar la carpeta aunque tenga un agente activo');

// 6. Test unambiguous repo selection: leaf node data-arg uses repo.path
state.open['C:/Users/mock/Work/Repositories::simplit/ada'] = true;
html = renderRepoTree(state, data);
assert.ok(html.includes('data-act="openQueue" data-arg="C:/Users/mock/Work/Repositories/simplit/ada/ada-chat-frontend"'),
  'openQueue debe usar la ruta absoluta del repo para evitar colisiones de nombre');

console.log('Test de arbol jerarquico de repositorios OK: subcarpetas, anidacion, colapsado, desambiguacion y busqueda funcionan correctamente.');
