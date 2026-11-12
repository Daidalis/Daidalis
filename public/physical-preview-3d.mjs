// SysML part dimensions and centers are in millimetres, with +Z up.
function loftGeometry(THREE, sections, scale) {
  // Corners proceed counterclockwise in the YZ plane when seen from +X.
  const rings = sections.map(({x, y = 0, lowerZ, upperZ, lowerWidth, upperWidth, shoulderWidth, shoulderZ}) => {
    const point = (offset, z) => [x / scale, (y + offset) / scale, z / scale];
    const ring = [point(-lowerWidth / 2, lowerZ), point(lowerWidth / 2, lowerZ)];
    if (shoulderWidth != null) ring.push(point(shoulderWidth / 2, shoulderZ));
    ring.push(point(upperWidth / 2, upperZ), point(-upperWidth / 2, upperZ));
    if (shoulderWidth != null) ring.push(point(-shoulderWidth / 2, shoulderZ));
    return ring;
  });
  const corners = rings[0].length;
  const vertices = [], indices = [], lines = [];
  // Share normals along each longitudinal panel, keeping the section
  // corners and the two end caps crisp.
  for (let side = 0; side < corners; side++) {
    const next = (side + 1) % corners;
    let base = vertices.length / 3;
    for (let i = 0; i < rings.length; i++, base += 2) {
      vertices.push(...rings[i][side], ...rings[i][next]);
      if (i + 1 < rings.length) {
        indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
        lines.push(...rings[i][side], ...rings[i + 1][side]);
      }
    }
  }
  for (const [index, cap] of [rings[0], rings.at(-1)].entries()) {
    const base = vertices.length / 3;
    for (const corner of cap) vertices.push(...corner);
    for (let side = 0; side < corners; side++) lines.push(...cap[side], ...cap[(side + 1) % corners]);
    const contour = cap.map(([, y, z]) => new THREE.Vector2(y, z));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      if (index === 0) indices.push(base + a, base + c, base + b);
      else indices.push(base + a, base + b, base + c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  return {geometry, edges};
}

// A small linear HDR reflection map keeps the preview self-contained. The two
// broad studio panels add a moving reflection as the user orbits a curved part.
function studioEnvironment(THREE) {
  const width = 128, height = 64;
  const pixels = new Uint16Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const latitude = ((row + .5) / height - .5) * Math.PI;
    const y = Math.sin(latitude);
    for (let column = 0; column < width; column++) {
      const longitude = ((column + .5) / width - .5) * 2 * Math.PI;
      const x = Math.cos(latitude) * Math.cos(longitude);
      const z = Math.cos(latitude) * Math.sin(longitude);
      const overhead = .12 + .38 * Math.max(0, z);
      const strip = 5 * Math.max(0, -y) * Math.exp(-(((z - .05) / .16) ** 4) - ((x / .83) ** 4));
      const softbox = 3.5 * Math.max(0, y) * Math.exp(-(((z - .5) / .22) ** 4) - (((x + .12) / .8) ** 4));
      const offset = (row * width + column) * 4;
      pixels[offset] = THREE.DataUtils.toHalfFloat(overhead + strip + softbox * .93);
      pixels[offset + 1] = THREE.DataUtils.toHalfFloat(overhead + strip * .98 + softbox);
      pixels[offset + 2] = THREE.DataUtils.toHalfFloat(overhead + strip * .93 + softbox * 1.05);
      pixels[offset + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createAssembly(THREE, host, parts, onSelect) {
  const events = new AbortController();
  const listen = (target, type, listener, options) =>
    target.addEventListener(type, listener, {...options, signal:events.signal});
  const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  const canvas = renderer.domElement;
  host.replaceChildren(canvas);

  const scene = new THREE.Scene();
  const environment = studioEnvironment(THREE);
  scene.environment = environment;
  scene.environmentIntensity = .7;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera.up.set(0, 0, 1);
  const sky = new THREE.HemisphereLight(0xffffff, 0x929ea8, .7);
  sky.position.set(0, 0, 1);
  const key = new THREE.DirectionalLight(0xfff7e9, 1.85);
  key.position.set(3, -4, 6);
  const fill = new THREE.DirectionalLight(0xdceafa, .8);
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
    cylinder:() => new THREE.CylinderGeometry(.5, .5, 1, 64),
    cone:() => new THREE.ConeGeometry(.5, 1, 64)
  };
  const materials = new Map();
  const highlight = new THREE.MeshStandardMaterial({color:0xf4a54a, roughness:.55, metalness:.05});
  const outline = new THREE.LineBasicMaterial({color:0x40515b, transparent:true, opacity:.66});
  const geometries = new Map(), edgeGeometries = new Map();
  const meshes = [], instances = new Map();
  let selected = null;
  for (const part of parts) {
    const isLoft = part.shape === 'loft';
    const axis = part.axis || 'Z';
    const geometryKey = isLoft ? part.sections : part.shape + ':' + axis;
    const loftScale = isLoft ? Math.max(...part.size) : 1;
    if (!geometries.has(geometryKey)) {
      let geometry, edges;
      if (isLoft) {
        ({geometry, edges} = loftGeometry(THREE, part.sections, loftScale));
      } else {
        geometry = unitShapes[part.shape]();
        // Three creates these solids along +Y. The declared axis points
        // toward the upper cap or cone tip, including on a horizontal wheel.
        if (part.shape === 'cylinder' || part.shape === 'cone') {
          if (axis === 'X') geometry.rotateZ(-Math.PI / 2);
          if (axis === 'Z') geometry.rotateX(Math.PI / 2);
        }
        if (part.shape !== 'sphere') edges = new THREE.EdgesGeometry(geometry, 18);
      }
      geometries.set(geometryKey, geometry);
      if (edges) edgeGeometries.set(geometryKey, edges);
    }
    const color = /^#[0-9a-f]{6}$/i.test(part.color) ? part.color.toLowerCase() : '#a3b1b6';
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({color, roughness:.3, metalness:.14}));
    const material = materials.get(color);
    const mesh = new THREE.Mesh(geometries.get(geometryKey), material);
    mesh.position.fromArray(part.position).sub(center).divideScalar(modelScale);
    if (isLoft) mesh.scale.setScalar(loftScale / modelScale);
    else mesh.scale.fromArray(part.size).divideScalar(modelScale);
    mesh.userData.partId = part.id;
    const edges = edgeGeometries.get(geometryKey);
    if (edges) mesh.add(new THREE.LineSegments(edges, outline));
    meshes.push(mesh);
    instances.set(part.id, {mesh, material});
    scene.add(mesh);
  }

  const homeYaw = -1, homePitch = .32;
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

  const signalColor = new THREE.Color(0x6c8856);
  function restore(instance, id) {
    instance.mesh.material = id === selected ? highlight : instance.material;
  }
  function emphasize(entries) {
    const next = new Map();
    let driveLevel = 0;
    let hasDrive = false;
    for (const entry of entries || []) {
      const level = Number.isFinite(entry?.level) ? Math.min(1, Math.max(0, entry.level)) : null;
      if (entry?.id && level != null) next.set(entry.id, level);
      if (entry?.drive && level != null) {
        hasDrive = true;
        driveLevel = Math.max(driveLevel, level);
      }
    }
    if (!hasDrive) driveLevel = 0;
    for (const [id, instance] of instances) {
      const level = next.get(id);
      if (level != null) {
        if (!instance.signalMaterial) {
          instance.signalMaterial = instance.material.clone();
          instance.signalMaterial.emissive = signalColor.clone();
        }
        instance.signalMaterial.color.copy(instance.material.color).lerp(signalColor, 0.2 + level * 0.8);
        instance.signalMaterial.emissiveIntensity = 0.08 + level * 0.85;
        instance.mesh.material = instance.signalMaterial;
        continue;
      }
      if (!instance.bodyMaterial) {
        instance.bodyMaterial = instance.material.clone();
        instance.bodyMaterial.emissive = new THREE.Color(0xf4a54a);
      }
      instance.bodyMaterial.emissiveIntensity = driveLevel * 0.55;
      instance.mesh.material = id === selected ? highlight : instance.bodyMaterial;
    }
    schedule();
  }
  function select(id) {
    const previous = selected;
    selected = id;
    const prior = instances.get(previous);
    if (prior && previous !== id) restore(prior, previous);
    const current = instances.get(id);
    if (current && current.mesh.material !== current.signalMaterial) current.mesh.material = highlight;
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
    for (const instance of instances.values()) {
      instance.signalMaterial?.dispose();
      instance.bodyMaterial?.dispose();
    }
    for (const resource of [...geometries.values(), ...edgeGeometries.values(), ...materials.values(), highlight, outline]) resource.dispose();
    scene.environment = null;
    environment.dispose();
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
  return {select, emphasize, fit, zoom, destroy};
}

export function mountPhysicalPreview(host, {parts, onSelect}) {
  host.classList.add('physical-preview-3d');
  host.tabIndex = 0;
  host.setAttribute('aria-label', '三维实体装配预览。方向键旋转，加减键缩放，Home 键复位。');
  let preview, selected, emphasis, destroyed = false;
  if (parts.length) {
    host.textContent = '正在加载实体预览…';
    import('/vendor/three/three.module.min.js').then(THREE => {
      if (destroyed) return;
      preview = createAssembly(THREE, host, parts, onSelect);
      if (selected != null) preview.select(selected);
      if (emphasis) preview.emphasize(emphasis);
    }).catch(() => {
      if (!destroyed) host.textContent = '无法启动实体预览。请使用支持 WebGL 2 的浏览器，或通过零件列表查看尺寸和位置。';
    });
  } else {
    host.textContent = '模型中没有可绘制的实体。';
  }
  return {
    select(id) {selected = id;preview?.select(id);},
    emphasize(entries) {emphasis = entries || [];preview?.emphasize(emphasis);},
    fit() {preview?.fit();},
    zoom(factor) {preview?.zoom(factor);},
    destroy() {destroyed = true;preview?.destroy();host.replaceChildren();}
  };
}
