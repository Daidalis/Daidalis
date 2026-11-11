// SysML part dimensions and centers are in millimetres, with +Z up.
function createAssembly(THREE, host, parts, onSelect) {
  const events = new AbortController();
  const listen = (target, type, listener, options) =>
    target.addEventListener(type, listener, {...options, signal:events.signal});
  const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  const canvas = renderer.domElement;
  host.replaceChildren(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera.up.set(0, 0, 1);
  const sky = new THREE.HemisphereLight(0xffffff, 0x929ea8, 1.6);
  sky.position.set(0, 0, 1);
  const key = new THREE.DirectionalLight(0xfff7e9, 2.1);
  key.position.set(3, -4, 6);
  const fill = new THREE.DirectionalLight(0xdceafa, 1.2);
  fill.position.set(-3, 2, 3);
  scene.add(sky, key, fill);

  // Rebase coordinates near the origin before they reach the GPU. A single
  // scale factor applies to every dimension and every placement in the assembly.
  const bounds = new THREE.Box3();
  const center = new THREE.Vector3(), halfSize = new THREE.Vector3();
  for (const part of parts) {
    center.fromArray(part.position);
    halfSize.fromArray(part.size).multiplyScalar(.5);
    bounds.expandByPoint(center.clone().sub(halfSize));
    bounds.expandByPoint(center.clone().add(halfSize));
  }
  bounds.getCenter(center);
  const extent = bounds.getSize(new THREE.Vector3());
  const modelScale = Math.max(extent.x, extent.y, extent.z);
  extent.divideScalar(modelScale);

  const unitShapes = {
    box:() => new THREE.BoxGeometry(1, 1, 1),
    sphere:() => new THREE.SphereGeometry(.5, 40, 28),
    cylinder:() => new THREE.CylinderGeometry(.5, .5, 1, 48).rotateX(Math.PI / 2),
    cone:() => new THREE.ConeGeometry(.5, 1, 48).rotateX(Math.PI / 2)
  };
  const surface = new THREE.MeshStandardMaterial({color:0xa3b1b6, roughness:.65, metalness:.09});
  const highlight = new THREE.MeshStandardMaterial({color:0xf4a54a, roughness:.55, metalness:.05});
  const outline = new THREE.LineBasicMaterial({color:0x40515b, transparent:true, opacity:.66});
  const geometries = new Map(), edgeGeometries = new Map();
  const meshes = [], instances = new Map();
  let selected = null;
  for (const part of parts) {
    if (!geometries.has(part.shape)) {
      const geometry = unitShapes[part.shape]();
      geometries.set(part.shape, geometry);
      if (part.shape !== 'sphere') edgeGeometries.set(part.shape, new THREE.EdgesGeometry(geometry, 18));
    }
    const mesh = new THREE.Mesh(geometries.get(part.shape), surface);
    mesh.position.fromArray(part.position).sub(center).divideScalar(modelScale);
    mesh.scale.fromArray(part.size).divideScalar(modelScale);
    mesh.userData.partId = part.id;
    const edges = edgeGeometries.get(part.shape);
    if (edges) mesh.add(new THREE.LineSegments(edges, outline));
    meshes.push(mesh);
    instances.set(part.id, mesh);
    scene.add(mesh);
  }

  const homeYaw = -.88, homePitch = .54;
  let yaw = homeYaw, pitch = homePitch, zoomScale = 1, fitHeight = 1;
  let width = 0, height = 0, frame = 0, stopped = false;
  const focus = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  function draw() {
    frame = 0;
    if (stopped || !width || !height) return;
    const halfHeight = fitHeight * zoomScale;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.right = halfHeight * width / height;
    camera.left = -camera.right;
    const distance = 4 + focus.length();
    camera.far = distance * 2 + 3;
    camera.position.set(
      Math.cos(yaw) * Math.cos(pitch),
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch)
    ).multiplyScalar(distance).add(focus);
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
    try {
      renderer.render(scene, camera);
    } catch {
      showRenderFailure();
    }
  }
  function schedule() {
    if (!stopped && !frame) frame = requestAnimationFrame(draw);
  }
  function resize() {
    width = host.clientWidth;
    height = host.clientHeight;
    if (!width || !height) return;
    const projectedWidth = Math.abs(Math.sin(homeYaw)) * extent.x + Math.abs(Math.cos(homeYaw)) * extent.y;
    const projectedHeight = Math.sin(homePitch) * (Math.abs(Math.cos(homeYaw)) * extent.x + Math.abs(Math.sin(homeYaw)) * extent.y) + Math.cos(homePitch) * extent.z;
    fitHeight = Math.max(projectedWidth * height / width, projectedHeight) * .6;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    schedule();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  function select(id) {
    const previous = instances.get(selected);
    if (previous) previous.material = surface;
    const current = instances.get(id);
    if (current) current.material = highlight;
    selected = id;
    schedule();
  }
  function fit() {
    focus.set(0, 0, 0);
    yaw = homeYaw;
    pitch = homePitch;
    zoomScale = 1;
    schedule();
  }
  function zoom(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    zoomScale = Math.max(.001, Math.min(15, zoomScale * factor));
    schedule();
  }
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.set(2 * (event.clientX - rect.left) / rect.width - 1, 1 - 2 * (event.clientY - rect.top) / rect.height);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit) {
      const id = hit.object.userData.partId;
      select(id);
      onSelect?.(id);
    }
  }

  let drag = null;
  listen(canvas, 'pointerdown', event => {
    if (drag || ![0, 1, 2].includes(event.button)) return;
    host.focus({preventScroll:true});
    drag = {id:event.pointerId, x:event.clientX, y:event.clientY, pan:event.shiftKey || event.button !== 0, moved:false};
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  listen(canvas, 'pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    host.classList.add('is-dragging');
    if (drag.pan) {
      const units = 2 * fitHeight * zoomScale / Math.max(1, height);
      focus.addScaledVector(right.setFromMatrixColumn(camera.matrixWorld, 0), -dx * units);
      focus.addScaledVector(up.setFromMatrixColumn(camera.matrixWorld, 1), dy * units);
    } else {
      yaw -= dx * .008;
      pitch = Math.max(-1.53, Math.min(1.53, pitch + dy * .008));
    }
    schedule();
  });
  function endDrag() {
    drag = null;
    host.classList.remove('is-dragging');
  }
  listen(canvas, 'pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    if (!drag.moved && !drag.pan) pick(event);
    endDrag();
  });
  listen(canvas, 'lostpointercapture', endDrag);
  listen(canvas, 'contextmenu', event => event.preventDefault());
  listen(canvas, 'wheel', event => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 1.13 : 1 / 1.13);
  }, {passive:false});
  listen(host, 'keydown', event => {
    switch (event.key) {
      case 'ArrowLeft': yaw -= .12;break;
      case 'ArrowRight': yaw += .12;break;
      case 'ArrowUp': pitch = Math.min(1.53, pitch + .12);break;
      case 'ArrowDown': pitch = Math.max(-1.53, pitch - .12);break;
      case '+': case '=': zoom(.85);break;
      case '-': zoom(1 / .85);break;
      case 'Home': fit();break;
      default:return;
    }
    event.preventDefault();
    schedule();
  });
  function destroy() {
    if (stopped) return;
    stopped = true;
    events.abort();
    observer.disconnect();
    cancelAnimationFrame(frame);
    for (const resource of [...geometries.values(), ...edgeGeometries.values(), surface, highlight, outline]) resource.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    host.classList.remove('is-dragging');
  }
  function showRenderFailure() {
    destroy();
    host.textContent = '三维显示已中断。请重新打开实体预览。';
  }
  listen(canvas, 'webglcontextlost', showRenderFailure);
  return {select, fit, zoom, destroy};
}

export function mountPhysicalPreview(host, {parts, onSelect}) {
  host.classList.add('physical-preview-3d');
  host.tabIndex = 0;
  host.setAttribute('aria-label', '三维实体装配预览。方向键旋转，加减键缩放，Home 键复位。');
  let preview, selected, destroyed = false;
  if (parts.length) {
    host.textContent = '正在加载实体预览…';
    import('/vendor/three/three.module.min.js').then(THREE => {
      if (destroyed) return;
      preview = createAssembly(THREE, host, parts, onSelect);
      if (selected != null) preview.select(selected);
    }).catch(() => {
      if (!destroyed) host.textContent = '无法启动实体预览。请使用支持 WebGL 2 的浏览器，或通过零件列表查看尺寸和位置。';
    });
  } else {
    host.textContent = '模型中没有可绘制的实体。';
  }
  return {
    select(id) {selected = id;preview?.select(id);},
    fit() {preview?.fit();},
    zoom(factor) {preview?.zoom(factor);},
    destroy() {destroyed = true;preview?.destroy();host.replaceChildren();}
  };
}
