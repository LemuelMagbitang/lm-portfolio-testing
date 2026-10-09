import assert from 'node:assert/strict';
import {
  loadProjects,
  getProjects,
  getCardForProject,
  destroyProjects
} from '../js/features/projects/project-loader.js?v=20261009-11';

function createHarness(initialChildren = []) {
  const grid = {
    children: initialChildren.slice(),
    replaceChildren(...children) {
      this.children = children.flatMap(child =>
        Array.isArray(child?.children) ? child.children : [child]
      );
    }
  };

  const createFragment = () => ({
    children: [],
    appendChild(node) {
      this.children.push(node);
    }
  });

  const buildCard = project => ({ id: String(project.id) });

  return {
    grid,
    createFragment,
    buildCard
  };
}

async function loadFixture(harness, payload, loadJson = async () => payload) {
  return loadProjects({
    url: 'data/projects.json',
    loadJson,
    resolveUrl: value => value,
    buildCard: harness.buildCard,
    getGrid: () => harness.grid,
    createFragment: harness.createFragment
  });
}

destroyProjects();

{
  const harness = createHarness([{ id: 'stale-card' }]);

  const mounted = await loadFixture(harness, [{
    id: 'project-a',
    title: 'Project A',
    media: [{ type: 'image', src: 'a.jpg' }]
  }]);

  assert.equal(mounted, true);
  assert.equal(harness.grid.children.length, 1);
  assert.equal(getProjects().length, 1);
  assert.equal(getCardForProject('project-a')?.id, 'project-a');

  const emptied = await loadFixture(harness, { projects: [] });

  assert.equal(emptied, true, 'an explicit empty projects collection is valid');
  assert.deepEqual(harness.grid.children, [], 'empty CMS state clears stale cards');
  assert.deepEqual(getProjects(), [], 'empty CMS state clears normalized project models');
  assert.equal(getCardForProject('project-a'), null, 'empty CMS state clears the project card index');
}

{
  const harness = createHarness();

  await loadFixture(harness, [{
    id: 'project-b',
    title: 'Project B',
    media: [{ type: 'image', src: 'b.jpg' }]
  }]);

  const before = getProjects();
  const beforeCard = harness.grid.children[0];

  const invalid = await loadFixture(harness, { unexpected: true });

  assert.equal(invalid, false, 'an invalid/non-collection payload remains a load failure');
  assert.deepEqual(getProjects(), before, 'invalid payload does not destroy valid project state');
  assert.equal(harness.grid.children[0], beforeCard, 'invalid payload preserves the published card set');
}

{
  const harness = createHarness();

  let releaseStale;
  const stalePromise = new Promise(resolve => {
    releaseStale = () => resolve([{
      id: 'stale-project',
      title: 'Stale Project',
      media: [{ type: 'image', src: 'stale.jpg' }]
    }]);
  });

  const firstLoad = loadFixture(harness, null, async () => stalePromise);
  const secondLoad = loadFixture(harness, [{
    id: 'fresh-project',
    title: 'Fresh Project',
    media: [{ type: 'image', src: 'fresh.jpg' }]
  }]);

  assert.equal(await secondLoad, true);
  releaseStale();
  assert.equal(await firstLoad, false, 'a superseded Projects load cannot publish stale state');
  assert.equal(getProjects()[0]?.id, 'fresh-project');
  assert.equal(harness.grid.children[0]?.id, 'fresh-project');
}

destroyProjects();

{
  const harness = createHarness();
  await loadFixture(harness, [{
    id: 'holo-side-config',
    title: 'Holographic side config',
    media: [{
      type: 'image',
      src: 'front.jpg',
      holographic: {
        style: 'iridescent',
        intensity: 0.8,
        texture: 'front-foil.svg',
        textureMode: 'fill',
        mask: 'front-mask.svg',
        back: 'back.jpg',
        backTexture: 'back-foil.svg',
        backTextureMode: 'tile',
        backMask: 'back-mask.svg'
      }
    }]
  }]);
  const effect = getProjects()[0]?.media[0]?.holographic;
  assert.equal(effect?.back, 'back.jpg');
  assert.equal(effect?.texture, 'front-foil.svg');
  assert.equal(effect?.mask, 'front-mask.svg');
  assert.equal(effect?.backTexture, 'back-foil.svg', 'Projects normalization must retain the reverse-side foil pattern');
  assert.equal(effect?.backTextureMode, 'tile', 'Projects normalization must retain reverse pattern mapping');
  assert.equal(effect?.backMask, 'back-mask.svg', 'Projects normalization must retain the independent reverse mask');
}

console.log('LM. project-loader contract test passed.');
