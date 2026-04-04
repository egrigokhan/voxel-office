import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// ==================== Scene ====================

const scene = new THREE.Scene();
scene.background = new THREE.Color('#D3BCAE');

const frustumSize = 15;
let currentFrustum = frustumSize;
const aspect = window.innerWidth / window.innerHeight;

const orthoCamera = new THREE.OrthographicCamera(
    -frustumSize * aspect, frustumSize * aspect,
    frustumSize, -frustumSize,
    0.1, 2000
);
orthoCamera.position.set(100, 100, 100);
orthoCamera.lookAt(scene.position);

const perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 2000);
perspCamera.position.set(30, 30, 30);
perspCamera.lookAt(scene.position);

let camera = orthoCamera;
let isPerspective = false;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(15, 25, 10);
dirLight.castShadow = true;
dirLight.shadow.camera.left = -20;
dirLight.shadow.camera.right = 20;
dirLight.shadow.camera.top = 20;
dirLight.shadow.camera.bottom = -20;
dirLight.shadow.mapSize.set(2048, 2048);
scene.add(dirLight);
scene.add(dirLight.target);

// ==================== Editor State ====================

const selectables = [];
const allMeshes = [];
const offices = [];       // { wrapper, targetY, currentY }
let hoveredOfficeIdx = -1;
let selected = null;
let mode = 'select';
let officeCount = 0;
const ROOM_SPACING = 17;
const HOVER_HEIGHT = 12;
let timelapse = false;
let sunAngle = 0;

// ==================== Controls ====================

let orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.05;

let xform = new TransformControls(camera, renderer.domElement);
xform.setMode('translate');
xform.setTranslationSnap(0.5);
xform.visible = false;
scene.add(xform);

let xformUsed = false;
function bindXformEvents() {
    xform.addEventListener('dragging-changed', (e) => {
        orbit.enabled = !e.value;
        if (e.value) xformUsed = true;
    });
    xform.addEventListener('objectChange', () => {
        if (selected) {
            selBox.setFromObject(selected);
            syncPropsFromObject();
        }
    });
}
bindXformEvents();

function switchCamera() {
    const oldTarget = orbit.target.clone();
    isPerspective = !isPerspective;
    camera = isPerspective ? perspCamera : orthoCamera;

    if (isPerspective) {
        const dir = orthoCamera.position.clone().normalize();
        perspCamera.position.copy(oldTarget).add(dir.multiplyScalar(currentFrustum * 2.5));
    } else {
        orthoCamera.position.copy(perspCamera.position.clone().normalize().multiplyScalar(100).add(oldTarget));
    }

    camera.lookAt(oldTarget);

    orbit.dispose();
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.05;
    orbit.target.copy(oldTarget);

    scene.remove(xform);
    xform.dispose();
    xform = new TransformControls(camera, renderer.domElement);
    xform.setMode('translate');
    xform.setTranslationSnap(0.5);
    xform.visible = false;
    scene.add(xform);
    bindXformEvents();

    $('btn-perspective').classList.toggle('active', isPerspective);
}

// ==================== Selection Helper ====================

const selBox = new THREE.BoxHelper(
    new THREE.Mesh(new THREE.BoxGeometry()), 0xffff00
);
selBox.visible = false;
scene.add(selBox);

// ==================== Raycaster ====================

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// ==================== Object Creation ====================

function createBlock(w, h, d, x, y, z, color, parent) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color })
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (parent || scene).add(mesh);
    selectables.push(mesh);
    allMeshes.push(mesh);
    return mesh;
}

function createGroupIn(x, y, z, parent) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    (parent || scene).add(group);
    selectables.push(group);
    return group;
}

function addToGroup(group, w, h, d, x, y, z, color) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color })
    );
    mesh.position.set(x - group.position.x, y - group.position.y, z - group.position.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    allMeshes.push(mesh);
    return mesh;
}

function getSelectable(mesh) {
    let obj = mesh;
    while (obj.parent && obj.parent !== scene && !obj.parent.userData.isOfficeWrapper) {
        obj = obj.parent;
    }
    return selectables.includes(obj) ? obj : null;
}

function deleteSelectable(obj) {
    if (!obj) return;
    if (selected === obj) deselect();
    if (obj.parent) obj.parent.remove(obj);

    const si = selectables.indexOf(obj);
    if (si !== -1) selectables.splice(si, 1);

    if (obj.isGroup) {
        obj.traverse(child => {
            if (child.isMesh) {
                const mi = allMeshes.indexOf(child);
                if (mi !== -1) allMeshes.splice(mi, 1);
                child.geometry.dispose();
                child.material.dispose();
            }
        });
    } else if (obj.isMesh) {
        const mi = allMeshes.indexOf(obj);
        if (mi !== -1) allMeshes.splice(mi, 1);
        obj.geometry.dispose();
        obj.material.dispose();
    }
}

// ==================== Build One Office ====================

function generateChatBubbleTexture() {
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const p = 3;
    const bubble = [
        '   XXXXXXXXXXXX   ',
        '  X..............X ',
        ' X................X',
        ' X................X',
        ' X................X',
        ' X................X',
        ' X................X',
        '  X..............X ',
        '   XXXXX.XXXXXXX  ',
        '        X.X       ',
        '         X        ',
    ];

    const phrases = ['Hello!', 'Hi :)', 'Busy!', 'Lunch?', 'TGIF', 'Zzz..', 'Sup?', 'BRB'];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];

    const bw = 19, bh = 11;
    const ox = (size - bw * p) / 2, oy = (size - bh * p) / 2 - 4;

    for (let row = 0; row < bh; row++) {
        for (let col = 0; col < bubble[row].length; col++) {
            const ch = bubble[row][col];
            if (ch === 'X') {
                ctx.fillStyle = '#222222';
                ctx.fillRect(ox + col * p, oy + row * p, p, p);
            } else if (ch === '.') {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(ox + col * p, oy + row * p, p, p);
            }
        }
    }

    ctx.fillStyle = '#222222';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(phrase, size / 2, oy + 5 * p);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
}

function generateGlowTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.2, 'rgba(255,255,255,0.6)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.15)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

function buildOffice(ox, oz) {
    const wrapper = new THREE.Group();
    wrapper.userData.isOfficeWrapper = true;
    scene.add(wrapper);

    const bl = (w, h, d, x, y, z, c) => createBlock(w, h, d, x + ox, y, z + oz, c, wrapper);
    const gr = (x, y, z) => createGroupIn(x + ox, y, z + oz, wrapper);
    const ag = (g, w, h, d, x, y, z, c) => addToGroup(g, w, h, d, x + ox, y, z + oz, c);

    function chair(x, z, facingFront) {
        const g = gr(x, 1.5, z);
        ag(g, 1.5, 0.2, 1.5, x, 1.5, z, '#222222');
        ag(g, 0.2, 1.5, 0.2, x - 0.65, 0.75, z - 0.65, '#222222');
        ag(g, 0.2, 1.5, 0.2, x + 0.65, 0.75, z - 0.65, '#222222');
        ag(g, 0.2, 1.5, 0.2, x - 0.65, 0.75, z + 0.65, '#222222');
        ag(g, 0.2, 1.5, 0.2, x + 0.65, 0.75, z + 0.65, '#222222');
        ag(g, 1.5, 1.5, 0.2, x, 2.3, facingFront ? z - 0.65 : z + 0.65, '#222222');
        return g;
    }

    const wallPalette = ['#8B9EB5', '#8BA595', '#B5A08B', '#A58BA5', '#B58B8B', '#8BAAB5'];
    const wallColor = wallPalette[Math.floor(Math.random() * wallPalette.length)];

    // Floor & Walls
    bl(16, 0.5, 16, 0, -0.25, 0, '#666666');
    bl(0.5, 12, 16, -8.25, 6, 0, wallColor);
    bl(16, 12, 0.5, 0, 6, -8.25, wallColor);
    for (let i = 1; i < 4; i++) {
        bl(0.6, 12, 0.1, -7.8, 6, -8 + i * 4, '#222222');
        bl(0.1, 12, 0.6, -8 + i * 4, 6, -7.8, '#222222');
    }

    // Main Desk
    const desk = gr(1.5, 2, 1.5);
    ag(desk, 6, 0.4, 3, 1.5, 3.2, 1.5, '#A55D38');
    ag(desk, 0.4, 3, 2.6, -1.3, 1.5, 1.5, '#A55D38');
    ag(desk, 0.4, 3, 2.6, 4.3, 1.5, 1.5, '#A55D38');
    ag(desk, 5.2, 2.5, 0.2, 1.5, 1.5, 0.3, '#A55D38');
    ag(desk, 1.5, 1, 0.2, 1, 3.9, 1, '#444444');
    ag(desk, 0.4, 0.5, 0.4, 1, 3.65, 0.9, '#222222');
    ag(desk, 1.2, 0.1, 0.5, 1, 3.45, 2, '#222222');
    ag(desk, 0.8, 0.3, 0.6, 3, 3.55, 1.5, '#222222');
    ag(desk, 0.6, 0.5, 0.6, 2.3, 3.65, 1, '#FFFFFF');

    // Tall Cabinet
    const tallCab = gr(-4.5, 4, -4.5);
    ag(tallCab, 3.5, 8, 3, -4.5, 4, -4.5, '#A55D38');
    ag(tallCab, 1.7, 3.8, 0.1, -3.6, 6, -3, '#7E4225');
    ag(tallCab, 1.7, 3.8, 0.1, -5.4, 6, -3, '#7E4225');
    ag(tallCab, 3.4, 1.8, 0.1, -4.5, 3, -3, '#7E4225');
    ag(tallCab, 3.4, 1.8, 0.1, -4.5, 1, -3, '#7E4225');

    // Low Cabinet + Books
    const lowCab = gr(4.5, 2, -4.5);
    ag(lowCab, 3, 4, 4, 4.5, 2, -4.5, '#A55D38');
    ag(lowCab, 0.3, 0.8, 0.8, 3.5, 4.4, -4.5, '#CC0000');
    ag(lowCab, 0.3, 0.9, 0.8, 3.9, 4.45, -4.5, '#CCCC00');
    ag(lowCab, 0.3, 0.8, 0.8, 4.3, 4.4, -4.5, '#0000CC');

    // Small Side Cabinet
    bl(2.5, 3, 2, -6, 1.5, 4, '#A55D38');

    // Window & Blinds
    const win = gr(-7.8, 5, 2);
    ag(win, 0.2, 6, 5, -7.8, 6, 2, '#FFFFFF');
    for (let i = 0; i < 15; i++) {
        ag(win, 0.3, 0.1, 4.8, -7.75, 3.5 + i * 0.35, 2, '#E0E0E0');
    }

    // Desk Chair
    const dc = gr(-1.5, 1.5, 2);
    ag(dc, 1.5, 0.2, 1.5, -1.5, 1.5, 2, '#222222');
    ag(dc, 0.2, 1.5, 0.2, -2.15, 0.75, 1.35, '#222222');
    ag(dc, 0.2, 1.5, 0.2, -0.85, 0.75, 1.35, '#222222');
    ag(dc, 0.2, 1.5, 0.2, -2.15, 0.75, 2.65, '#222222');
    ag(dc, 0.2, 1.5, 0.2, -0.85, 0.75, 2.65, '#222222');
    ag(dc, 1.5, 1.5, 0.2, -1.5, 2.3, 2.65, '#222222');
    ag(dc, 1.5, 2, 0.2, -1.5, 3.5, 1.35, '#222222');

    // Wall Art 1
    const a1 = gr(4, 7, -7.8);
    ag(a1, 4, 2, 0.2, 4, 7, -7.8, '#A55D38');
    ag(a1, 3.6, 1.6, 0.25, 4, 7, -7.7, '#296A82');

    // Wall Art 2
    const a2 = gr(0, 8, -7.8);
    ag(a2, 1, 1.5, 0.2, 0, 8, -7.8, '#A55D38');
    ag(a2, 0.6, 1.1, 0.25, 0, 8, -7.7, '#222222');

    // Wall Certificate
    const cert = gr(-7.8, 6.5, 6);
    ag(cert, 0.2, 1.5, 2, -7.8, 6.5, 6, '#222222');
    ag(cert, 0.25, 1.1, 1.6, -7.7, 6.5, 6, '#FFFFFF');

    // Floor Lamp
    const lamp = gr(-1, 4, -6);
    ag(lamp, 0.2, 8, 0.2, -1, 4, -6, '#222222');
    ag(lamp, 1, 0.2, 1, -1, 0.1, -6, '#222222');
    ag(lamp, 1.2, 1.5, 1.2, -1, 8, -6, '#222222');

    // Glowing orb
    const orbGeo = new THREE.SphereGeometry(1.2, 24, 24);
    const orbColors = ['#ffcc66', '#66ccff', '#ff99cc', '#99ffaa', '#cc99ff', '#ffaa77'];
    const orbColor = orbColors[Math.floor(Math.random() * orbColors.length)];
    const orbModes = ['solid', 'dim', 'pulse'];
    const orbMode = orbModes[Math.floor(Math.random() * orbModes.length)];
    const baseEmissive = orbMode === 'dim' ? 2 : 5;
    const baseLightIntensity = orbMode === 'dim' ? 0 : 6;
    const orbMat = new THREE.MeshStandardMaterial({
        color: orbColor, emissive: orbColor, emissiveIntensity: baseEmissive,
        transparent: true, opacity: 0.95
    });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.set(0 + ox, 10, 0 + oz);
    wrapper.add(orb);
    allMeshes.push(orb);
    selectables.push(orb);

    const orbLight = new THREE.PointLight(orbColor, baseLightIntensity, 25, 1);
    orbLight.position.set(0 + ox, 10, 0 + oz);
    wrapper.add(orbLight);

    const glowSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
            map: generateGlowTexture(),
            color: orbColor,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        })
    );
    glowSprite.scale.set(10, 10, 1);
    glowSprite.position.set(0 + ox, 10, 0 + oz);
    wrapper.add(glowSprite);

    const chatSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
            map: generateChatBubbleTexture(),
            transparent: true,
            depthTest: false,
        })
    );
    chatSprite.scale.set(7, 7, 1);
    chatSprite.position.set(0 + ox, 14, 0 + oz);
    chatSprite.visible = false;
    wrapper.add(chatSprite);

    // Tag every mesh in this office for hover detection
    const idx = offices.length;
    wrapper.traverse(c => { if (c.isMesh) c.userData.officeIndex = idx; });

    offices.push({
        wrapper, targetY: 0, chatBubble: chatSprite,
        orbMode, orbMat, orbLight, glowSprite,
        baseEmissive, baseLightIntensity,
        pulseOffset: Math.random() * Math.PI * 2
    });
}

// ==================== Hover Detection ====================

renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons !== 0) return;

    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(allMeshes);

    let newIdx = -1;
    if (hits.length) {
        const oi = hits[0].object.userData.officeIndex;
        if (oi !== undefined) newIdx = oi;
    }

    if (newIdx !== hoveredOfficeIdx) {
        if (hoveredOfficeIdx >= 0 && offices[hoveredOfficeIdx]) {
            offices[hoveredOfficeIdx].targetY = 0;
            offices[hoveredOfficeIdx].chatBubble.visible = false;
        }
        hoveredOfficeIdx = newIdx;
        if (hoveredOfficeIdx >= 0 && offices[hoveredOfficeIdx]) {
            offices[hoveredOfficeIdx].targetY = HOVER_HEIGHT;
            offices[hoveredOfficeIdx].chatBubble.visible = true;
        }
    }
});

renderer.domElement.addEventListener('pointerleave', () => {
    if (hoveredOfficeIdx >= 0 && offices[hoveredOfficeIdx]) {
        offices[hoveredOfficeIdx].targetY = 0;
        offices[hoveredOfficeIdx].chatBubble.visible = false;
    }
    hoveredOfficeIdx = -1;
});

// ==================== Hire / Diagonal Layout ====================

function getSquarePos(n) {
    if (n === 0) return { x: 0, z: 0 };
    const ring = Math.ceil(Math.sqrt(n + 1)) - 1;
    const ringStart = ring * ring;
    const idx = n - ringStart;
    const side = ring + 1;
    if (idx < side) {
        return { x: ring * ROOM_SPACING, z: idx * ROOM_SPACING };
    } else {
        return { x: (idx - side) * ROOM_SPACING, z: ring * ROOM_SPACING };
    }
}

function hire() {
    const pos = getSquarePos(officeCount);
    buildOffice(pos.x, pos.z);
    officeCount++;
    $('employee-count').textContent = officeCount;
    fitCamera();
}

let targetFrustum = frustumSize;
const targetCenter = new THREE.Vector3();

function fitCamera() {
    const box = new THREE.Box3();
    selectables.forEach(s => box.expandByObject(s));
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z);

    targetFrustum = Math.max(frustumSize, maxDim * 0.6 + 4);
    targetCenter.copy(center);

    const shadowSize = maxDim * 0.7 + 10;
    dirLight.target.position.copy(center);
    dirLight.shadow.camera.left = -shadowSize;
    dirLight.shadow.camera.right = shadowSize;
    dirLight.shadow.camera.top = shadowSize;
    dirLight.shadow.camera.bottom = -shadowSize;
    dirLight.shadow.camera.updateProjectionMatrix();
}

// ==================== Scene Lifecycle ====================

function clearScene() {
    deselect();
    allMeshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    selectables.forEach(s => { if (s.parent) s.parent.remove(s); });
    offices.forEach(o => { if (o.wrapper.parent) scene.remove(o.wrapper); });
    selectables.length = 0;
    allMeshes.length = 0;
    offices.length = 0;
    hoveredOfficeIdx = -1;
}

function resetScene() {
    clearScene();
    officeCount = 0;
    hire();
}

// ==================== Selection ====================

function select(obj) {
    if (!obj) { deselect(); return; }
    if (selected === obj) return;

    selected = obj;
    selBox.setFromObject(obj);
    selBox.visible = true;

    if (mode === 'move') {
        xform.attach(obj);
        xform.visible = true;
    }

    syncPropsFromObject();
    $('properties').classList.remove('hidden');
}

function deselect() {
    selected = null;
    selBox.visible = false;
    xform.detach();
    xform.visible = false;
    $('properties').classList.add('hidden');
}

function syncPropsFromObject() {
    if (!selected) return;
    const p = selected.position;
    $('pos-x').value = r(p.x);
    $('pos-y').value = r(p.y);
    $('pos-z').value = r(p.z);

    const isGrp = !!selected.isGroup;
    $('size-section').classList.toggle('hidden', isGrp);
    $('color-section').classList.toggle('hidden', isGrp);
    $('group-info').classList.toggle('hidden', !isGrp);
    $('btn-ungroup').classList.toggle('hidden', !isGrp);

    if (isGrp) {
        $('group-count').textContent = selected.children.filter(c => c.isMesh).length;
    } else {
        const g = selected.geometry.parameters;
        $('size-w').value = r(g.width);
        $('size-h').value = r(g.height);
        $('size-d').value = r(g.depth);
        $('obj-color').value = '#' + selected.material.color.getHexString();
    }
}

// ==================== Mode Management ====================

const MODE_HINTS = {
    select: 'Click to select objects or groups',
    move:   'Select, then drag to move',
    add:    'Click a surface to place a new block',
    delete: 'Click to remove an object or group',
};

function setMode(m) {
    mode = m;
    document.querySelectorAll('.tool-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === mode)
    );

    if (mode === 'move' && selected) {
        xform.attach(selected);
        xform.visible = true;
    } else {
        xform.detach();
        xform.visible = false;
    }

    const cursors = { select: 'default', move: 'default', add: 'crosshair', delete: 'pointer' };
    renderer.domElement.style.cursor = cursors[mode] || 'default';
    $('mode-hint').textContent = MODE_HINTS[mode] || '';
}

// ==================== Click Handling ====================

let ptrDown = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
    ptrDown = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
    if (!ptrDown) return;
    const dx = e.clientX - ptrDown.x;
    const dy = e.clientY - ptrDown.y;
    ptrDown = null;

    const wasXform = xformUsed;
    xformUsed = false;
    if (dx * dx + dy * dy > 25 || wasXform) return;

    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(allMeshes);

    if (mode === 'select') {
        select(hits.length ? getSelectable(hits[0].object) : null);

    } else if (mode === 'move') {
        if (hits.length) {
            const target = getSelectable(hits[0].object);
            select(target);
            xform.attach(target);
            xform.visible = true;
        } else {
            deselect();
        }

    } else if (mode === 'add' && hits.length) {
        const { face, point, object } = hits[0];
        const normal = face.normal.clone().transformDirection(object.matrixWorld);
        const pos = point.clone().add(normal.multiplyScalar(0.5));
        pos.x = Math.round(pos.x * 2) / 2;
        pos.y = Math.round(pos.y * 2) / 2;
        pos.z = Math.round(pos.z * 2) / 2;
        select(createBlock(1, 1, 1, pos.x, pos.y, pos.z, $('color-picker').value));

    } else if (mode === 'delete' && hits.length) {
        deleteSelectable(getSelectable(hits[0].object));
    }
});

// ==================== Properties Panel ====================

function onPropChange(id, fn) {
    $(id).addEventListener('change', (e) => {
        if (!selected) return;
        fn(parseFloat(e.target.value));
        selBox.setFromObject(selected);
    });
}

onPropChange('pos-x', v => { selected.position.x = v; });
onPropChange('pos-y', v => { selected.position.y = v; });
onPropChange('pos-z', v => { selected.position.z = v; });
onPropChange('size-w', v => resizeSelected('width', v));
onPropChange('size-h', v => resizeSelected('height', v));
onPropChange('size-d', v => resizeSelected('depth', v));

function resizeSelected(dim, val) {
    if (!selected || selected.isGroup || val <= 0) return;
    const p = selected.geometry.parameters;
    selected.geometry.dispose();
    selected.geometry = new THREE.BoxGeometry(
        dim === 'width'  ? val : p.width,
        dim === 'height' ? val : p.height,
        dim === 'depth'  ? val : p.depth
    );
}

$('obj-color').addEventListener('input', (e) => {
    if (selected && selected.isMesh) selected.material.color.set(e.target.value);
});

$('btn-duplicate').addEventListener('click', duplicateSelected);
$('btn-delete-obj').addEventListener('click', () => { if (selected) deleteSelectable(selected); });
$('btn-ungroup').addEventListener('click', ungroupSelected);

function duplicateSelected() {
    if (!selected) return;

    if (selected.isGroup) {
        const gp = selected.position;
        const ng = createGroupIn(gp.x + 2, gp.y, gp.z + 2);
        selected.children.filter(c => c.isMesh).forEach(child => {
            const p = child.geometry.parameters;
            addToGroup(ng, p.width, p.height, p.depth,
                child.position.x + ng.position.x,
                child.position.y + ng.position.y,
                child.position.z + ng.position.z,
                '#' + child.material.color.getHexString()
            );
        });
        select(ng);
    } else {
        const g = selected.geometry.parameters;
        const p = selected.position;
        select(createBlock(g.width, g.height, g.depth, p.x + 2, p.y, p.z + 2,
            '#' + selected.material.color.getHexString()));
    }
}

function ungroupSelected() {
    if (!selected || !selected.isGroup) return;
    const group = selected;
    const parent = group.parent;
    deselect();

    const children = group.children.filter(c => c.isMesh);
    children.forEach(child => {
        const worldPos = new THREE.Vector3();
        child.getWorldPosition(worldPos);
        group.remove(child);
        if (parent && parent !== scene && parent.userData.isOfficeWrapper) {
            child.position.set(worldPos.x, worldPos.y - parent.position.y, worldPos.z);
        } else {
            child.position.copy(worldPos);
        }
        (parent || scene).add(child);
        selectables.push(child);
    });

    if (parent) parent.remove(group);
    const si = selectables.indexOf(group);
    if (si !== -1) selectables.splice(si, 1);
}

// ==================== Arcs ====================

const arcs = [];

function fireArc() {
    if (offices.length < 2) return;

    let a = Math.floor(Math.random() * offices.length);
    let b;
    do { b = Math.floor(Math.random() * offices.length); } while (b === a);

    const boxA = new THREE.Box3().expandByObject(offices[a].wrapper);
    const boxB = new THREE.Box3().expandByObject(offices[b].wrapper);
    const start = boxA.getCenter(new THREE.Vector3());
    const end = boxB.getCenter(new THREE.Vector3());

    start.y = 13;
    end.y = 13;

    const mid = start.clone().lerp(end, 0.5);
    mid.y = 13 + start.distanceTo(end) * 0.35;

    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const totalPts = 80;
    const pts = curve.getPoints(totalPts);

    const shape = new THREE.CatmullRomCurve3(pts);
    const radialSegs = 8;
    const R = 0.25;
    const capLen = 3;
    const tubularSegs = totalPts;
    const radiusFn = (t) => {
        const edge = capLen / tubularSegs;
        if (t < edge) return R * Math.sin((t / edge) * Math.PI * 0.5);
        if (t > 1 - edge) return R * Math.sin(((1 - t) / edge) * Math.PI * 0.5);
        return R;
    };

    const frames = shape.computeFrenetFrames(tubularSegs, false);
    const tubeGeo = new THREE.TubeGeometry(shape, tubularSegs, radiusFn, radialSegs, false);

    // Rebuild positions with custom per-ring radius
    const pos = tubeGeo.attributes.position;
    for (let ring = 0; ring <= tubularSegs; ring++) {
        const t = ring / tubularSegs;
        const rad = radiusFn(t);
        const P = shape.getPointAt(t);
        const N = frames.normals[ring];
        const B = frames.binormals[ring];
        for (let s = 0; s <= radialSegs; s++) {
            const angle = (s / radialSegs) * Math.PI * 2;
            const sin = Math.sin(angle), cos = Math.cos(angle);
            const idx = ring * (radialSegs + 1) + s;
            pos.setXYZ(idx,
                P.x + rad * (cos * N.x + sin * B.x),
                P.y + rad * (cos * N.y + sin * B.y),
                P.z + rad * (cos * N.z + sin * B.z)
            );
        }
    }
    pos.needsUpdate = true;
    tubeGeo.computeVertexNormals();
    const tubeMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, vertexColors: true
    });

    const posCount = tubeGeo.attributes.position.count;
    const colors = new Float32Array(posCount * 4);
    for (let j = 0; j < posCount; j++) {
        colors[j * 4] = 1; colors[j * 4 + 1] = 0.7; colors[j * 4 + 2] = 0.15; colors[j * 4 + 3] = 0;
    }
    tubeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 4));

    const trail = new THREE.Mesh(tubeGeo, tubeMat);
    trail.geometry.setDrawRange(0, 0);
    scene.add(trail);

    const totalTris = tubeGeo.index ? tubeGeo.index.count : posCount;
    const ringSize = radialSegs + 1;
    tubeGeo.computeBoundingSphere();
    arcs.push({ trail, pts, totalPts, totalTris, ringSize, progress: 0, phase: 'fly', fadeOut: 1 });
}

function updateArcs() {
    for (let i = arcs.length - 1; i >= 0; i--) {
        const arc = arcs[i];

        const frac = Math.min(arc.progress / arc.totalPts, 1);
        const headRing = Math.floor(frac * arc.totalPts);
        const tailLen = 50;
        const colors = arc.trail.geometry.attributes.color;

        if (arc.phase === 'fly') {
            arc.progress += 1;
            arc.trail.geometry.setDrawRange(0, Math.floor(frac * arc.totalTris));

            for (let ring = 0; ring <= arc.totalPts; ring++) {
                const dist = headRing - ring;
                const a = (dist >= 0 && dist < tailLen) ? (1 - dist / tailLen) : 0;
                for (let s = 0; s < arc.ringSize; s++) {
                    colors.array[(ring * arc.ringSize + s) * 4 + 3] = a;
                }
            }
            colors.needsUpdate = true;

            if (frac >= 1) arc.phase = 'fade';
        } else {
            arc.fadeOut -= 0.03;
            for (let ring = 0; ring <= arc.totalPts; ring++) {
                for (let s = 0; s < arc.ringSize; s++) {
                    const idx = (ring * arc.ringSize + s) * 4 + 3;
                    colors.array[idx] = Math.max(0, colors.array[idx] - 0.03);
                }
            }
            colors.needsUpdate = true;

            if (arc.fadeOut <= 0) {
                scene.remove(arc.trail);
                arc.trail.geometry.dispose();
                arc.trail.material.dispose();
                arcs.splice(i, 1);
            }
        }
    }
}

// ==================== Toolbar ====================

document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

let arcInterval = null;
$('btn-arc').addEventListener('click', () => {
    if (arcInterval) {
        clearInterval(arcInterval);
        arcInterval = null;
        $('btn-arc').classList.remove('active');
    } else {
        fireArc();
        arcInterval = setInterval(fireArc, 800 + Math.random() * 700);
        $('btn-arc').classList.add('active');
    }
});
$('btn-timelapse').addEventListener('click', () => {
    timelapse = !timelapse;
    $('btn-timelapse').classList.toggle('active', timelapse);
});
$('btn-perspective').addEventListener('click', switchCamera);
$('btn-hire').addEventListener('click', hire);
$('btn-save').addEventListener('click', save);
$('btn-load').addEventListener('click', load);
$('btn-reset').addEventListener('click', () => {
    if (confirm('Reset to default scene? Unsaved changes will be lost.')) resetScene();
});

// ==================== Save / Load ====================

const STORAGE_KEY = 'voxel-office';

function serialize() {
    return selectables.map(obj => {
        if (obj.isGroup) {
            return {
                type: 'group',
                x: r(obj.position.x), y: r(obj.position.y), z: r(obj.position.z),
                children: obj.children.filter(c => c.isMesh).map(c => ({
                    w: c.geometry.parameters.width,
                    h: c.geometry.parameters.height,
                    d: c.geometry.parameters.depth,
                    x: r(c.position.x), y: r(c.position.y), z: r(c.position.z),
                    color: '#' + c.material.color.getHexString(),
                })),
            };
        }
        return {
            type: 'block',
            w: obj.geometry.parameters.width,
            h: obj.geometry.parameters.height,
            d: obj.geometry.parameters.depth,
            x: r(obj.position.x), y: r(obj.position.y), z: r(obj.position.z),
            color: '#' + obj.material.color.getHexString(),
        };
    });
}

function save() {
    const data = { officeCount, scene: serialize() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    flash('btn-save', 'Saved!', 'Save');
}

function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { alert('No saved scene found.'); return; }
    clearScene();
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : data.scene;
    officeCount = data.officeCount || 1;
    $('employee-count').textContent = officeCount;
    items.forEach(item => {
        if (item.type === 'group') {
            const g = createGroupIn(item.x, item.y, item.z);
            item.children.forEach(c => {
                const mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(c.w, c.h, c.d),
                    new THREE.MeshStandardMaterial({ color: c.color })
                );
                mesh.position.set(c.x, c.y, c.z);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                g.add(mesh);
                allMeshes.push(mesh);
            });
        } else {
            createBlock(item.w, item.h, item.d, item.x, item.y, item.z, item.color);
        }
    });
    fitCamera();
}

// ==================== Keyboard Shortcuts ====================

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

    switch (e.key) {
        case '1': setMode('select'); break;
        case '2': setMode('move'); break;
        case '3': setMode('add'); break;
        case '4': setMode('delete'); break;
        case 'Escape': deselect(); break;
        case 'Delete':
        case 'Backspace':
            if (selected) { e.preventDefault(); deleteSelectable(selected); }
            break;
        case 'd': duplicateSelected(); break;
        case 's':
            if (e.metaKey || e.ctrlKey) { e.preventDefault(); save(); }
            break;
    }
});

// ==================== Window Resize ====================

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==================== Utilities ====================

function $(id) { return document.getElementById(id); }
function r(v) { return Math.round(v * 100) / 100; }
function flash(id, text, original) {
    const el = $(id);
    el.textContent = text;
    setTimeout(() => { el.textContent = original; }, 1200);
}

// ==================== Init ====================

resetScene();
setMode('select');

(function animate() {
    requestAnimationFrame(animate);

    // Smooth camera zoom & pan
    const lerpSpeed = 0.06;
    currentFrustum += (targetFrustum - currentFrustum) * lerpSpeed;
    orbit.target.lerp(targetCenter, lerpSpeed);

    if (!isPerspective) {
        const camOffset = new THREE.Vector3(100, 100, 100);
        const desiredCamPos = orbit.target.clone().add(camOffset);
        camera.position.lerp(desiredCamPos, lerpSpeed);
    } else {
        const dir = new THREE.Vector3(1, 1, 1).normalize();
        const dist = currentFrustum * 2.5;
        const desiredCamPos = orbit.target.clone().add(dir.multiplyScalar(dist));
        camera.position.lerp(desiredCamPos, lerpSpeed);
    }
    // Timelapse day/night cycle
    if (timelapse) sunAngle += 0.002;
    const sunT = (Math.sin(sunAngle) + 1) / 2; // 0 = midnight, 1 = noon

    const sunRadius = 40;
    const sunX = orbit.target.x + Math.cos(sunAngle) * sunRadius;
    const sunY = Math.sin(sunAngle) * sunRadius;
    const sunZ = orbit.target.z + Math.sin(sunAngle) * sunRadius * 0.3;

    if (timelapse || sunAngle > 0) {
        dirLight.position.set(sunX, Math.max(sunY, 2), sunZ);

        const dayIntensity = Math.max(0, sunT);
        dirLight.intensity = 0.5 + dayIntensity * 0.9;
        ambLight.intensity = 0.35 + dayIntensity * 0.25;

        const dawnDusk = Math.max(0, 1 - Math.abs(sunT - 0.3) * 4);
        const nightness = Math.max(0, 1 - sunT * 2.5);

        const bgR = 0.827 - nightness * 0.45 + dawnDusk * 0.1;
        const bgG = 0.737 - nightness * 0.4 - dawnDusk * 0.05;
        const bgB = 0.682 - nightness * 0.2 + dawnDusk * 0.05;
        scene.background.setRGB(
            Math.max(0.2, Math.min(1, bgR)),
            Math.max(0.18, Math.min(1, bgG)),
            Math.max(0.25, Math.min(1, bgB))
        );

        const sunR = 1 - nightness * 0.5 + dawnDusk * 0.15;
        const sunG = 1 - nightness * 0.6 - dawnDusk * 0.2;
        const sunB = 1 - nightness * 0.3 - dawnDusk * 0.4;
        dirLight.color.setRGB(
            Math.max(0.15, Math.min(1, sunR)),
            Math.max(0.1, Math.min(1, sunG)),
            Math.max(0.2, Math.min(1, sunB))
        );
    } else {
        dirLight.position.set(orbit.target.x + 15, 25, orbit.target.z + 10);
    }

    const a = window.innerWidth / window.innerHeight;
    if (!isPerspective) {
        camera.left = -currentFrustum * a;
        camera.right = currentFrustum * a;
        camera.top = currentFrustum;
        camera.bottom = -currentFrustum;
        camera.updateProjectionMatrix();
    } else {
        camera.aspect = a;
        camera.updateProjectionMatrix();
    }

    // Arcs
    updateArcs();

    // Hover animation + orb pulse
    const time = performance.now() * 0.001;
    let hoverAnimating = false;
    offices.forEach(office => {
        const cur = office.wrapper.position.y;
        const tgt = office.targetY;
        if (Math.abs(cur - tgt) > 0.005) {
            office.wrapper.position.y += (tgt - cur) * 0.12;
            hoverAnimating = true;
        } else if (cur !== tgt) {
            office.wrapper.position.y = tgt;
        }

        if (office.orbMode === 'pulse') {
            const pulse = (Math.sin(time * 2.5 + office.pulseOffset) + 1) / 2;
            office.orbMat.emissiveIntensity = 1.5 + pulse * 5;
            office.orbLight.intensity = 1.5 + pulse * 6;
            office.glowSprite.material.opacity = 0.3 + pulse * 0.7;
        }
    });

    if (hoverAnimating && selected && selBox.visible) selBox.setFromObject(selected);

    orbit.update();
    renderer.render(scene, camera);
})();
