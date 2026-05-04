"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const MODEL_PATH = "/models/tend-hero-baked.glb";

export function HeroScene() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(-2.1, 1.0, 6.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;

    const rig = new THREE.Group();
    scene.add(rig);

    scene.add(new THREE.AmbientLight(0xffc07a, 0.23));

    const keyLight = new THREE.PointLight(0xffc74f, 16, 14);
    keyLight.position.set(-2.6, 2.2, 4.6);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x5fdfff, 66, 18);
    fillLight.position.set(2.8, 1.45, 4.3);
    scene.add(fillLight);

    const blueAccent = new THREE.PointLight(0x00bfff, 88, 14);
    blueAccent.position.set(-2.2, -0.1, 4.1);
    scene.add(blueAccent);

    const cyanEdge = new THREE.RectAreaLight(0x5cecff, 76, 5.2, 0.8);
    cyanEdge.position.set(2.1, 0.35, 4.0);
    cyanEdge.lookAt(0, 0, 0);
    scene.add(cyanEdge);

    const warmGlassLight = new THREE.PointLight(0xffb52a, 42, 12);
    warmGlassLight.position.set(-1.6, 0.95, 3.5);
    scene.add(warmGlassLight);

    const blueTop = new THREE.DirectionalLight(0x4ccfff, 11);
    blueTop.position.set(2.2, 3.5, 3.4);
    scene.add(blueTop);

    const hiddenEmitter = new THREE.RectAreaLight(0xffbd4f, 32, 5.8, 5.8);
    hiddenEmitter.position.set(1.15, -0.95, -2.2);
    hiddenEmitter.lookAt(0, 0, 0);
    scene.add(hiddenEmitter);

    const rimLight = new THREE.DirectionalLight(0x71d7ff, 3.4);
    rimLight.position.set(2.8, 2.8, -2.6);
    scene.add(rimLight);

    let model: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    const disposableMaterials = new Set<THREE.Material>();
    let frame = 0;
    const clock = new THREE.Clock();
    const pointer = new THREE.Vector2(0, 0);
    const smoothPointer = new THREE.Vector2(0, 0);

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      const aspect = width / height;
      const viewHeight = 2.12;
      camera.left = (-viewHeight * aspect) / 2;
      camera.right = (viewHeight * aspect) / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const onPointerMove = (event: PointerEvent) => {
      const x = event.clientX / Math.max(window.innerWidth, 1);
      const y = event.clientY / Math.max(window.innerHeight, 1);
      pointer.set((x - 0.5) * 2, (y - 0.5) * 2);
    };

    const loader = new GLTFLoader();
    loader.load(MODEL_PATH, (gltf) => {
      model = gltf.scene;
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;

        child.frustumCulled = false;
        const glass = new THREE.MeshPhysicalMaterial({
          color: "#70f24f",
          emissive: "#00cfff",
          emissiveIntensity: 0.11,
          roughness: 0.155,
          metalness: 0,
          transmission: 1,
          thickness: 1.2,
          attenuationColor: new THREE.Color("#e5ff28"),
          attenuationDistance: 3.8,
          ior: 1.5,
          clearcoat: 0.55,
          clearcoatRoughness: 0.075,
          specularColor: new THREE.Color("#1fcfff"),
          specularIntensity: 1,
          envMapIntensity: 1.25,
          transparent: false,
          opacity: 1,
          side: THREE.DoubleSide,
        });
        disposableMaterials.add(glass);
        child.material = glass;
      });

      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const modelScale = 5.38 / Math.max(size.x, size.y, size.z, 0.001);
      model.scale.setScalar(modelScale);
      model.position.copy(center).multiplyScalar(-modelScale);
      model.rotation.set(0, 0, 0);
      rig.add(model);

      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        const action = mixer.clipAction(gltf.animations[0]);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
    });

    const animate = () => {
      const delta = clock.getDelta();
      const elapsed = clock.elapsedTime;
      smoothPointer.lerp(pointer, 0.055);

      if (mixer && !reduceMotion) {
        mixer.update(delta);
      }

      if (model) {
        rig.rotation.x = -0.02 - smoothPointer.y * 0.045;
        rig.rotation.y = smoothPointer.x * 0.07;
        rig.rotation.z = 0;
        rig.position.y = -1.62 + (!reduceMotion
          ? Math.sin(elapsed * 0.72) * 0.02
          : 0);
      }

      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };

    resize();
    animate();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.cancelAnimationFrame(frame);
      renderer.dispose();
      environment.dispose();
      pmrem.dispose();
      if (model) {
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
          }
        });
      }
      disposableMaterials.forEach((material) => material.dispose());
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="hero-scene pointer-events-auto relative h-full w-full"
      aria-hidden="true"
    />
  );
}
