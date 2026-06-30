import type { Vec3 } from "@sense-sight/world-schema";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
}

/** Smoothly flies the camera + orbit target to a focus point on version change. */
export function CameraRig({
  focus,
}: {
  focus: { target: Vec3; version: number };
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) => state.controls as unknown as OrbitLike | null
  );
  const handled = useRef(focus.version);
  const anim = useRef<{
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromCamera: THREE.Vector3;
    toCamera: THREE.Vector3;
    t: number;
  } | null>(null);

  useEffect(() => {
    if (focus.version === handled.current || !controls) return;
    handled.current = focus.version;
    const to = new THREE.Vector3(
      focus.target.x,
      focus.target.y,
      focus.target.z
    );
    const offset = new THREE.Vector3(5.5, 6.5, 8);
    anim.current = {
      fromTarget: controls.target.clone(),
      toTarget: to,
      fromCamera: camera.position.clone(),
      toCamera: to.clone().add(offset),
      t: 0,
    };
  }, [focus.version, focus.target, controls, camera]);

  useFrame((_, delta) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.t = Math.min(1, a.t + delta * 1.5);
    const eased = a.t < 0.5 ? 2 * a.t * a.t : 1 - (-2 * a.t + 2) ** 2 / 2;
    controls.target.lerpVectors(a.fromTarget, a.toTarget, eased);
    camera.position.lerpVectors(a.fromCamera, a.toCamera, eased);
    controls.update();
    if (a.t >= 1) anim.current = null;
  });

  return null;
}

/** Drives a first-person camera from a streamed pose + heading. */
export function FirstPersonCamera({
  pos,
  heading,
  eyeHeight = 0.9,
}: {
  pos: Vec3;
  heading: number;
  eyeHeight?: number;
}) {
  const camera = useThree((state) => state.camera);
  const target = useRef(new THREE.Vector3());
  const desired = useRef(new THREE.Vector3());
  useFrame(() => {
    desired.current.set(pos.x, eyeHeight, pos.z);
    camera.position.lerp(desired.current, 0.2);
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    target.current.set(
      camera.position.x + forwardX * 5,
      eyeHeight - 0.55,
      camera.position.z + forwardZ * 5
    );
    camera.lookAt(target.current);
  });
  return null;
}
