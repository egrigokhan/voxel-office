'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface VoxelSceneProps {
  officeCount: number;
  arcsOn?: boolean;
  timelapseOn?: boolean;
}

export default function VoxelScene({ officeCount, arcsOn = false, timelapseOn = false }: VoxelSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof initScene> | null>(null);
  const prevCountRef = useRef(0);

  const initScene = useCallback((container: HTMLDivElement) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#D3BCAE');

    const frustumSize = 15;
    let currentFrustum = frustumSize;
    let targetFrustum = frustumSize;
    const targetCenter = new THREE.Vector3();

    const cw = () => container.clientWidth;
    const ch = () => container.clientHeight;
    const asp = () => cw() / ch();

    const orthoCamera = new THREE.OrthographicCamera(
      -frustumSize * asp(), frustumSize * asp(),
      frustumSize, -frustumSize, 0.1, 2000
    );
    orthoCamera.position.set(100, 100, 100);
    orthoCamera.lookAt(scene.position);

    const perspCamera = new THREE.PerspectiveCamera(45, asp(), 0.1, 2000);
    perspCamera.position.set(30, 30, 30);
    perspCamera.lookAt(scene.position);

    let camera: THREE.Camera = orthoCamera;
    let isPerspective = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(cw(), ch());
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);

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

    const selectables: THREE.Object3D[] = [];
    const allMeshes: THREE.Mesh[] = [];
    const offices: {
      wrapper: THREE.Group; targetY: number; chatBubble: THREE.Sprite;
      orbMode: string; orbMat: THREE.MeshStandardMaterial;
      orbLight: THREE.PointLight; glowSprite: THREE.Sprite;
      baseEmissive: number; baseLightIntensity: number; pulseOffset: number;
    }[] = [];
    let hoveredOfficeIdx = -1;
    let localOfficeCount = 0;
    const ROOM_SPACING = 17;
    const HOVER_HEIGHT = 12;
    let timelapse = false;
    let sunAngle = 0;

    let orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.05;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function createBlock(w: number, h: number, d: number, x: number, y: number, z: number, color: string, parent?: THREE.Object3D) {
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

    function createGroupIn(x: number, y: number, z: number, parent?: THREE.Object3D) {
      const group = new THREE.Group();
      group.position.set(x, y, z);
      (parent || scene).add(group);
      selectables.push(group);
      return group;
    }

    function addToGroup(group: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, color: string) {
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

    function generateChatBubbleTexture() {
      const size = 96;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
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
          if (ch === 'X') { ctx.fillStyle = '#222222'; ctx.fillRect(ox + col * p, oy + row * p, p, p); }
          else if (ch === '.') { ctx.fillStyle = '#ffffff'; ctx.fillRect(ox + col * p, oy + row * p, p, p); }
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
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.2, 'rgba(255,255,255,0.6)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.15)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      return new THREE.CanvasTexture(canvas);
    }

    function buildOffice(ox: number, oz: number) {
      const wrapper = new THREE.Group();
      wrapper.userData.isOfficeWrapper = true;
      scene.add(wrapper);

      const bl = (w: number, h: number, d: number, x: number, y: number, z: number, c: string) => createBlock(w, h, d, x + ox, y, z + oz, c, wrapper);
      const gr = (x: number, y: number, z: number) => createGroupIn(x + ox, y, z + oz, wrapper);
      const ag = (g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, c: string) => addToGroup(g, w, h, d, x + ox, y, z + oz, c);

      const wallPalette = ['#8B9EB5', '#8BA595', '#B5A08B', '#A58BA5', '#B58B8B', '#8BAAB5'];
      const wallColor = wallPalette[Math.floor(Math.random() * wallPalette.length)];

      bl(16, 0.5, 16, 0, -0.25, 0, '#666666');
      bl(0.5, 12, 16, -8.25, 6, 0, wallColor);
      bl(16, 12, 0.5, 0, 6, -8.25, wallColor);
      for (let i = 1; i < 4; i++) {
        bl(0.6, 12, 0.1, -7.8, 6, -8 + i * 4, '#222222');
        bl(0.1, 12, 0.6, -8 + i * 4, 6, -7.8, '#222222');
      }

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

      const tallCab = gr(-4.5, 4, -4.5);
      ag(tallCab, 3.5, 8, 3, -4.5, 4, -4.5, '#A55D38');
      ag(tallCab, 1.7, 3.8, 0.1, -3.6, 6, -3, '#7E4225');
      ag(tallCab, 1.7, 3.8, 0.1, -5.4, 6, -3, '#7E4225');
      ag(tallCab, 3.4, 1.8, 0.1, -4.5, 3, -3, '#7E4225');
      ag(tallCab, 3.4, 1.8, 0.1, -4.5, 1, -3, '#7E4225');

      const lowCab = gr(4.5, 2, -4.5);
      ag(lowCab, 3, 4, 4, 4.5, 2, -4.5, '#A55D38');
      ag(lowCab, 0.3, 0.8, 0.8, 3.5, 4.4, -4.5, '#CC0000');
      ag(lowCab, 0.3, 0.9, 0.8, 3.9, 4.45, -4.5, '#CCCC00');
      ag(lowCab, 0.3, 0.8, 0.8, 4.3, 4.4, -4.5, '#0000CC');

      bl(2.5, 3, 2, -6, 1.5, 4, '#A55D38');

      const win = gr(-7.8, 5, 2);
      ag(win, 0.2, 6, 5, -7.8, 6, 2, '#FFFFFF');
      for (let i = 0; i < 15; i++) {
        ag(win, 0.3, 0.1, 4.8, -7.75, 3.5 + i * 0.35, 2, '#E0E0E0');
      }

      const dc = gr(-1.5, 1.5, 2);
      ag(dc, 1.5, 0.2, 1.5, -1.5, 1.5, 2, '#222222');
      ag(dc, 0.2, 1.5, 0.2, -2.15, 0.75, 1.35, '#222222');
      ag(dc, 0.2, 1.5, 0.2, -0.85, 0.75, 1.35, '#222222');
      ag(dc, 0.2, 1.5, 0.2, -2.15, 0.75, 2.65, '#222222');
      ag(dc, 0.2, 1.5, 0.2, -0.85, 0.75, 2.65, '#222222');
      ag(dc, 1.5, 1.5, 0.2, -1.5, 2.3, 2.65, '#222222');
      ag(dc, 1.5, 2, 0.2, -1.5, 3.5, 1.35, '#222222');

      const a1 = gr(4, 7, -7.8);
      ag(a1, 4, 2, 0.2, 4, 7, -7.8, '#A55D38');
      ag(a1, 3.6, 1.6, 0.25, 4, 7, -7.7, '#296A82');

      const a2 = gr(0, 8, -7.8);
      ag(a2, 1, 1.5, 0.2, 0, 8, -7.8, '#A55D38');
      ag(a2, 0.6, 1.1, 0.25, 0, 8, -7.7, '#222222');

      const cert = gr(-7.8, 6.5, 6);
      ag(cert, 0.2, 1.5, 2, -7.8, 6.5, 6, '#222222');
      ag(cert, 0.25, 1.1, 1.6, -7.7, 6.5, 6, '#FFFFFF');

      const lamp = gr(-1, 4, -6);
      ag(lamp, 0.2, 8, 0.2, -1, 4, -6, '#222222');
      ag(lamp, 1, 0.2, 1, -1, 0.1, -6, '#222222');
      ag(lamp, 1.2, 1.5, 1.2, -1, 8, -6, '#222222');

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
          map: generateGlowTexture(), color: orbColor,
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      glowSprite.scale.set(10, 10, 1);
      glowSprite.position.set(0 + ox, 10, 0 + oz);
      wrapper.add(glowSprite);

      const chatSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: generateChatBubbleTexture(), transparent: true, depthTest: false })
      );
      chatSprite.scale.set(7, 7, 1);
      chatSprite.position.set(0 + ox, 14, 0 + oz);
      chatSprite.visible = false;
      wrapper.add(chatSprite);

      const idx = offices.length;
      wrapper.traverse(c => { if ((c as THREE.Mesh).isMesh) c.userData.officeIndex = idx; });

      offices.push({
        wrapper, targetY: 0, chatBubble: chatSprite,
        orbMode, orbMat, orbLight, glowSprite,
        baseEmissive, baseLightIntensity,
        pulseOffset: Math.random() * Math.PI * 2
      });
    }

    // Hover
    renderer.domElement.addEventListener('pointermove', (e) => {
      if (e.buttons !== 0) return;
      const rect = container.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
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

    // Layout
    function getSquarePos(n: number) {
      if (n === 0) return { x: 0, z: 0 };
      const ring = Math.ceil(Math.sqrt(n + 1)) - 1;
      const ringStart = ring * ring;
      const idx = n - ringStart;
      const side = ring + 1;
      if (idx < side) return { x: ring * ROOM_SPACING, z: idx * ROOM_SPACING };
      return { x: (idx - side) * ROOM_SPACING, z: ring * ROOM_SPACING };
    }

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

    function hire() {
      const pos = getSquarePos(localOfficeCount);
      buildOffice(pos.x, pos.z);
      localOfficeCount++;
      fitCamera();
    }

    // Arcs
    const arcs: {
      trail: THREE.Mesh; pts: THREE.Vector3[]; totalPts: number;
      totalTris: number; ringSize: number; progress: number;
      phase: string; fadeOut: number;
    }[] = [];

    function fireArc() {
      if (offices.length < 2) return;
      let a = Math.floor(Math.random() * offices.length);
      let b: number;
      do { b = Math.floor(Math.random() * offices.length); } while (b === a);

      const boxA = new THREE.Box3().expandByObject(offices[a].wrapper);
      const boxB = new THREE.Box3().expandByObject(offices[b].wrapper);
      const start = boxA.getCenter(new THREE.Vector3());
      const end = boxB.getCenter(new THREE.Vector3());
      start.y = 13; end.y = 13;
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
      const radiusFn = (t: number) => {
        const edge = capLen / tubularSegs;
        if (t < edge) return R * Math.sin((t / edge) * Math.PI * 0.5);
        if (t > 1 - edge) return R * Math.sin(((1 - t) / edge) * Math.PI * 0.5);
        return R;
      };

      const frames = shape.computeFrenetFrames(tubularSegs, false);
      const tubeGeo = new THREE.TubeGeometry(shape, tubularSegs, radiusFn, radialSegs, false);
      const pos2 = tubeGeo.attributes.position;
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
          pos2.setXYZ(idx,
            P.x + rad * (cos * N.x + sin * B.x),
            P.y + rad * (cos * N.y + sin * B.y),
            P.z + rad * (cos * N.z + sin * B.z)
          );
        }
      }
      pos2.needsUpdate = true;
      tubeGeo.computeVertexNormals();

      const tubeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, vertexColors: true });
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
              const idx2 = (ring * arc.ringSize + s) * 4 + 3;
              colors.array[idx2] = Math.max(0, colors.array[idx2] - 0.03);
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

    // Camera switch
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
    }

    // Resize
    const onResize = () => renderer.setSize(cw(), ch());
    window.addEventListener('resize', onResize);

    // Arc interval
    let arcInterval: ReturnType<typeof setInterval> | null = null;

    // Animate
    let animId: number;
    function animate() {
      animId = requestAnimationFrame(animate);

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

      if (timelapse) sunAngle += 0.002;
      const sunT = (Math.sin(sunAngle) + 1) / 2;
      const sunRadius = 40;
      const sunX2 = orbit.target.x + Math.cos(sunAngle) * sunRadius;
      const sunY2 = Math.sin(sunAngle) * sunRadius;
      const sunZ2 = orbit.target.z + Math.sin(sunAngle) * sunRadius * 0.3;

      if (timelapse || sunAngle > 0) {
        dirLight.position.set(sunX2, Math.max(sunY2, 2), sunZ2);
        const dayIntensity = Math.max(0, sunT);
        dirLight.intensity = 0.5 + dayIntensity * 0.9;
        ambLight.intensity = 0.35 + dayIntensity * 0.25;
        const dawnDusk = Math.max(0, 1 - Math.abs(sunT - 0.3) * 4);
        const nightness = Math.max(0, 1 - sunT * 2.5);
        scene.background = new THREE.Color().setRGB(
          Math.max(0.2, Math.min(1, 0.827 - nightness * 0.45 + dawnDusk * 0.1)),
          Math.max(0.18, Math.min(1, 0.737 - nightness * 0.4 - dawnDusk * 0.05)),
          Math.max(0.25, Math.min(1, 0.682 - nightness * 0.2 + dawnDusk * 0.05))
        );
        dirLight.color.setRGB(
          Math.max(0.15, Math.min(1, 1 - nightness * 0.5 + dawnDusk * 0.15)),
          Math.max(0.1, Math.min(1, 1 - nightness * 0.6 - dawnDusk * 0.2)),
          Math.max(0.2, Math.min(1, 1 - nightness * 0.3 - dawnDusk * 0.4))
        );
      } else {
        dirLight.position.set(orbit.target.x + 15, 25, orbit.target.z + 10);
      }

      const a = asp();
      if (!isPerspective) {
        (camera as THREE.OrthographicCamera).left = -currentFrustum * a;
        (camera as THREE.OrthographicCamera).right = currentFrustum * a;
        (camera as THREE.OrthographicCamera).top = currentFrustum;
        (camera as THREE.OrthographicCamera).bottom = -currentFrustum;
        (camera as THREE.OrthographicCamera).updateProjectionMatrix();
      } else {
        (camera as THREE.PerspectiveCamera).aspect = a;
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }

      updateArcs();

      const time = performance.now() * 0.001;
      offices.forEach(office => {
        const cur = office.wrapper.position.y;
        const tgt = office.targetY;
        if (Math.abs(cur - tgt) > 0.005) {
          office.wrapper.position.y += (tgt - cur) * 0.12;
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

      orbit.update();
      renderer.render(scene, camera);
    }
    animate();

    return {
      hire,
      fireArc,
      switchCamera,
      setTimelapse: (v: boolean) => { timelapse = v; },
      startArcs: () => {
        if (!arcInterval) {
          fireArc();
          arcInterval = setInterval(fireArc, 800 + Math.random() * 700);
        }
      },
      stopArcs: () => {
        if (arcInterval) { clearInterval(arcInterval); arcInterval = null; }
      },
      getOfficeCount: () => localOfficeCount,
      dispose: () => {
        cancelAnimationFrame(animId);
        if (arcInterval) clearInterval(arcInterval);
        window.removeEventListener('resize', onResize);
        orbit.dispose();
        renderer.dispose();
        container.removeChild(renderer.domElement);
      },
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ctx = initScene(container);
    sceneRef.current = ctx;

    return () => {
      ctx.dispose();
      sceneRef.current = null;
    };
  }, [initScene]);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    const current = ctx.getOfficeCount();
    for (let i = current; i < officeCount; i++) {
      ctx.hire();
    }
    prevCountRef.current = officeCount;
  }, [officeCount]);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    if (arcsOn) ctx.startArcs();
    else ctx.stopArcs();
  }, [arcsOn]);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.setTimelapse(timelapseOn);
  }, [timelapseOn]);

  return <div ref={containerRef} className="w-full h-full" />;
}
