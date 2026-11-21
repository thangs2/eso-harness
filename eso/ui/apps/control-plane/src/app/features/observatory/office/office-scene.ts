import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type OfficeStatus = 'idle' | 'thinking' | 'working' | 'blocked' | 'done' | 'offline';

export interface OfficeWorker {
    id: string;
    label: string;
    role: string;
    color: string;
    status: OfficeStatus;
    lastEvent: string;
    lastAt: string;
    traceId: string;
}

interface WorkerVisual {
    group: THREE.Group;
    body: THREE.Mesh;
    head: THREE.Mesh;
    monitor: THREE.Mesh;
    ring: THREE.Mesh;
    label: THREE.Sprite;
    baseY: number;
    phase: number;
}

const STATUS_COLOR: Record<OfficeStatus, number> = {
    idle: 0x64748b,
    thinking: 0xa855f7,
    working: 0x22d3ee,
    blocked: 0xf59e0b,
    done: 0x22c55e,
    offline: 0x475569,
};

const SLOTS: Record<string, { x: number; z: number; rotation: number }> = {
    'worker-scout': { x: -7.2, z: -4.2, rotation: Math.PI },
    'worker-plan': { x: -2.4, z: -5.2, rotation: Math.PI },
    'worker-build': { x: 2.4, z: -5.2, rotation: Math.PI },
    'worker-verify': { x: 7.2, z: -4.2, rotation: Math.PI },
    'worker-audit': { x: -7.2, z: 3.4, rotation: 0 },
    'worker-fixbug': { x: -2.4, z: 4.4, rotation: 0 },
    'worker-qc': { x: 2.4, z: 4.4, rotation: 0 },
    'worker-qc-2': { x: 7.2, z: 3.4, rotation: 0 },
};

const FLOW: Array<[string, string]> = [
    ['worker-scout', 'worker-plan'],
    ['worker-plan', 'worker-build'],
    ['worker-build', 'worker-verify'],
    ['worker-verify', 'worker-audit'],
    ['worker-audit', 'worker-qc'],
    ['worker-qc', 'worker-qc-2'],
    ['worker-verify', 'worker-fixbug'],
    ['worker-audit', 'worker-fixbug'],
    ['worker-qc', 'worker-fixbug'],
    ['worker-qc-2', 'worker-fixbug'],
    ['worker-fixbug', 'worker-verify'],
];

function makeLabel(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.fillStyle = 'rgba(8, 13, 20, 0.82)';
        ctx.roundRect(0, 0, 320, 72, 12);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.font = '600 24px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 160, 36);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.5, 0.56, 1);
    return sprite;
}

function addBox(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], color: number, roughness = 0.7): THREE.Mesh {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...size),
        new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.08 }),
    );
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
}

function buildDesk(worker: OfficeWorker): WorkerVisual {
    const group = new THREE.Group();
    const slot = SLOTS[worker.id] ?? { x: 0, z: 0, rotation: 0 };
    group.position.set(slot.x, 0, slot.z);
    group.rotation.y = slot.rotation;
    group.userData.workerId = worker.id;

    // desk
    const wood = 0x8b5e3c;
    addBox(group, [2.6, 0.12, 1.25], [0, 1.05, 0], wood);
    for (const x of [-1.15, 1.15]) {
        for (const z of [-0.48, 0.48]) addBox(group, [0.1, 1.0, 0.1], [x, 0.5, z], 0x3b2a1d);
    }
    // monitor
    addBox(group, [0.1, 0.5, 0.1], [0, 1.32, -0.42], 0x1f2937);
    const monitorFrame = addBox(group, [1.25, 0.72, 0.08], [0, 1.72, -0.42], 0x111827);
    const monitor = new THREE.Mesh(
        new THREE.PlaneGeometry(1.14, 0.62),
        new THREE.MeshStandardMaterial({ color: STATUS_COLOR[worker.status], emissive: STATUS_COLOR[worker.status], emissiveIntensity: 0.65, emissiveMap: null }),
    );
    monitor.position.set(0, 1.72, -0.37);
    group.add(monitor);
    monitorFrame.userData.workerId = worker.id;
    monitor.userData.workerId = worker.id;
    // keyboard + mug
    addBox(group, [0.9, 0.04, 0.3], [0, 1.13, 0.08], 0x1e293b);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.18, 12), new THREE.MeshStandardMaterial({ color: worker.color, roughness: 0.5 }));
    mug.position.set(0.9, 1.2, 0.06);
    group.add(mug);

    // chair + avatar
    addBox(group, [0.55, 0.06, 0.5], [0, 0.55, 1.0], 0x273449);
    addBox(group, [0.06, 0.65, 0.5], [0, 0.9, 1.22], 0x1f2937);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 8), new THREE.MeshStandardMaterial({ color: worker.color, roughness: 0.55 }));
    body.position.set(0, 1.1, 0.92);
    body.castShadow = true;
    body.userData.workerId = worker.id;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xf1c7a5, roughness: 0.8 }));
    head.position.set(0, 1.62, 0.92);
    head.userData.workerId = worker.id;
    group.add(head);

    // status ring
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.75, 40),
        new THREE.MeshBasicMaterial({ color: STATUS_COLOR[worker.status], side: THREE.DoubleSide, transparent: true, opacity: 0.65 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.07, 0.92);
    group.add(ring);

    const label = makeLabel(`${worker.label} · ${worker.status}`, worker.color);
    label.position.set(0, 2.45, 0.8);
    group.add(label);

    return { group, body, head, monitor, ring, label, baseY: 1.1, phase: Math.random() * Math.PI * 2 };
}

function buildOffice(scene: THREE.Scene, onSelect: (workerId: string) => void): { pickables: THREE.Object3D[]; deskGroups: Map<string, WorkerVisual>; workersGroup: THREE.Group } {
    const pickables: THREE.Object3D[] = [];
    const deskGroups = new Map<string, WorkerVisual>();
    const workersGroup = new THREE.Group();
    scene.add(workersGroup);

    // floor + walls
    const floor = addBox(scene, [24, 0.2, 18], [0, -0.1, 0], 0x1c2430, 0.95);
    floor.receiveShadow = true;
    const rug = addBox(scene, [15, 0.03, 9.4], [0, 0.02, 0], 0x26313f, 1);
    rug.receiveShadow = true;
    addBox(scene, [24, 3.2, 0.2], [0, 1.6, -9], 0x111827, 0.9);
    addBox(scene, [0.2, 3.2, 18], [-12, 1.6, 0], 0x111827, 0.9);
    // window strips
    for (const x of [-8, -4, 0, 4, 8]) {
        const pane = addBox(scene, [2.8, 1.2, 0.08], [x, 2.0, -8.88], 0x0f2a3d, 0.3);
        pane.material = new THREE.MeshBasicMaterial({ color: 0x0d3b52 });
    }
    // central review table
    const table = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.16, 32), new THREE.MeshStandardMaterial({ color: 0x3b2a1d, roughness: 0.6 }));
    table.position.set(0, 1.0, -0.3);
    table.castShadow = true;
    table.receiveShadow = true;
    scene.add(table);
    const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.0, 12), new THREE.MeshStandardMaterial({ color: 0x1f2937 }));
    tableLeg.position.set(0, 0.5, -0.3);
    scene.add(tableLeg);
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        const chair = addBox(scene, [0.5, 0.08, 0.5], [Math.cos(angle) * 2.8, 0.6, -0.3 + Math.sin(angle) * 2.8], 0x273449);
        chair.rotation.y = -angle;
    }
    // plants / shelf
    for (const [x, z] of [[-10.8, -7], [10.8, -7], [-10.8, 7], [10.8, 7]] as const) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.55, 12), new THREE.MeshStandardMaterial({ color: 0x6b4a2f }));
        pot.position.set(x, 0.28, z);
        scene.add(pot);
        const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x2f6b4f, roughness: 0.8 }));
        leaves.position.set(x, 0.95, z);
        scene.add(leaves);
    }
    // flow lanes
    const flowMaterial = new THREE.LineDashedMaterial({ color: 0x33506a, dashSize: 0.3, gapSize: 0.25, transparent: true, opacity: 0.8 });
    for (const [from, to] of FLOW) {
        const a = SLOTS[from];
        const b = SLOTS[to];
        if (!a || !b) continue;
        const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(a.x, 0.08, a.z),
            new THREE.Vector3((a.x + b.x) / 2, 0.08, (a.z + b.z) / 2 + 1.2),
            new THREE.Vector3(b.x, 0.08, b.z),
        );
        const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
        const line = new THREE.Line(geometry, flowMaterial);
        line.computeLineDistances();
        scene.add(line);
    }

    scene.userData.onSelect = onSelect;
    return { pickables, deskGroups, workersGroup };
}

export class OfficeScene {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.OrthographicCamera;
    private readonly controls: OrbitControls;
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    private readonly canvas: HTMLCanvasElement;
    private readonly workersGroup: THREE.Group;
    private readonly deskGroups = new Map<string, WorkerVisual>();
    private readonly pickables: THREE.Object3D[] = [];
    private readonly clock = new THREE.Clock();
    private readonly onSelect: (workerId: string) => void;
    private frame: number | null = null;
    private focusTarget: THREE.Vector3 | null = null;
    private workers: OfficeWorker[] = [];
    private selected = '';

    constructor(canvas: HTMLCanvasElement, onSelect: (workerId: string) => void) {
        this.canvas = canvas;
        this.onSelect = onSelect;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0b1016);
        this.scene.fog = new THREE.Fog(0x0b1016, 24, 46);
        this.camera = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 100);
        this.camera.position.set(13, 12, 13);
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.target.set(0, 1, 0);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minZoom = 0.6;
        this.controls.maxZoom = 2.2;
        this.controls.maxPolarAngle = Math.PI / 2.2;
        this.controls.minPolarAngle = Math.PI / 5;
        this.controls.update();

        this.scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x1a2230, 1.0));
        const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
        sun.position.set(8, 16, 10);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -16;
        sun.shadow.camera.right = 16;
        sun.shadow.camera.top = 16;
        sun.shadow.camera.bottom = -16;
        this.scene.add(sun);
        const fill = new THREE.DirectionalLight(0x67e8f9, 0.7);
        fill.position.set(-10, 8, -8);
        this.scene.add(fill);

        const office = buildOffice(this.scene, onSelect);
        this.workersGroup = office.workersGroup;
        this.deskGroups = office.deskGroups;
        this.pickables = office.pickables;

        canvas.addEventListener('pointerdown', this.onPointerDown);
        canvas.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('resize', this.resize);
        this.resize();
        this.animate();
    }

    setWorkers(workers: OfficeWorker[]): void {
        this.workers = workers;
        if (this.deskGroups.size === 0) {
            for (const worker of workers) {
                const visual = buildDesk(worker);
                this.workersGroup.add(visual.group);
                this.deskGroups.set(worker.id, visual);
                this.pickables.push(visual.group);
            }
        }
        for (const worker of workers) {
            const visual = this.deskGroups.get(worker.id);
            if (!visual) continue;
            this.updateWorkerVisual(worker, visual);
        }
    }

    setSelected(workerId: string): void {
        this.selected = workerId;
        const visual = this.deskGroups.get(workerId);
        if (visual) {
            const world = new THREE.Vector3();
            visual.group.getWorldPosition(world);
            this.focusTarget = world.clone().add(new THREE.Vector3(0, 1.2, 0));
        }
    }

    resetCamera(): void {
        this.focusTarget = null;
        this.camera.position.set(13, 12, 13);
        this.controls.target.set(0, 1, 0);
        this.controls.update();
    }

    private updateWorkerVisual(worker: OfficeWorker, visual: WorkerVisual): void {
        const color = STATUS_COLOR[worker.status];
        (visual.monitor.material as THREE.MeshStandardMaterial).color.setHex(color);
        (visual.monitor.material as THREE.MeshStandardMaterial).emissive.setHex(color);
        (visual.monitor.material as THREE.MeshStandardMaterial).emissiveIntensity = worker.status === 'working' ? 1.2 : worker.status === 'offline' ? 0.05 : 0.55;
        (visual.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
        (visual.ring.material as THREE.MeshBasicMaterial).opacity = worker.status === 'offline' ? 0.15 : 0.7;
        (visual.body.material as THREE.MeshStandardMaterial).color.setStyle(worker.color);
        const label = makeLabel(`${worker.label} · ${worker.status}`, worker.color);
        visual.group.remove(visual.label);
        visual.label.material.map?.dispose();
        visual.label.material.dispose();
        visual.label = label;
        label.position.set(0, 2.45, 0.8);
        visual.group.add(label);
    }

    private readonly onPointerDown = (event: PointerEvent): void => {
        this.pointer.x = (event.offsetX / this.canvas.clientWidth) * 2 - 1;
        this.pointer.y = -(event.offsetY / this.canvas.clientHeight) * 2 + 1;
    };

    private readonly onPointerUp = (event: PointerEvent): void => {
        const delta = Math.abs(event.offsetX - (this.pointer.x + 1) * this.canvas.clientWidth / 2);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.pickables, true);
        const hit = hits.find((item) => {
            let node: THREE.Object3D | null = item.object;
            while (node) {
                if (typeof node.userData?.workerId === 'string') return true;
                node = node.parent;
            }
            return false;
        });
        if (!hit) return;
        let node: THREE.Object3D | null = hit.object;
        while (node) {
            if (typeof node.userData?.workerId === 'string') {
                this.onSelect(node.userData.workerId);
                return;
            }
            node = node.parent;
        }
    };

    private readonly resize = (): void => {
        const width = this.canvas.clientWidth || 960;
        const height = this.canvas.clientHeight || 620;
        const aspect = width / height;
        const size = 11;
        this.camera.left = -size * aspect;
        this.camera.right = size * aspect;
        this.camera.top = size;
        this.camera.bottom = -size;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    };

    private animate = (): void => {
        const dt = Math.min(0.05, this.clock.getDelta());
        const t = this.clock.elapsedTime;
        for (const visual of this.deskGroups.values()) {
            const worker = this.workers.find((item) => item.id === visual.group.userData.workerId);
            if (!worker) continue;
            const active = worker.status === 'working' || worker.status === 'thinking';
            visual.body.position.y = visual.baseY + (active ? Math.sin(t * 4 + visual.phase) * 0.035 : 0);
            visual.head.position.y = 1.62 + (active ? Math.sin(t * 4 + visual.phase) * 0.035 : 0);
            visual.body.rotation.z = active ? Math.sin(t * 6 + visual.phase) * 0.05 : 0;
            visual.ring.rotation.z += dt * (worker.status === 'working' ? 1.8 : 0.35);
            if (worker.status === 'blocked') {
                (visual.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 5) * 0.25;
            }
        }
        if (this.focusTarget) {
            this.controls.target.lerp(this.focusTarget, 0.08);
            if (this.controls.target.distanceTo(this.focusTarget) < 0.05) this.focusTarget = null;
        }
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this.frame = requestAnimationFrame(this.animate);
    };

    dispose(): void {
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.canvas.removeEventListener('pointerdown', this.onPointerDown);
        this.canvas.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('resize', this.resize);
        this.controls.dispose();
        this.scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
                const material = object.material;
                if (Array.isArray(material)) material.forEach((item) => item.dispose());
                else material.dispose();
            }
        });
        this.renderer.dispose();
    }
}
