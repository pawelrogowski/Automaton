import React, { useRef, useEffect, useState, useCallback, memo, useMemo } from 'react';
import { useSelector, useStore } from 'react-redux'; // Import useStore
import StyledMinimap from './Minimap.styled.js';
import CustomSelect from '../CustomSelect/CustomSelect.js';

// Dynamic imports are kept from the previous optimization. This is still critical.

const Minimap = () => {
  const canvasRef = useRef(null);
  const store = useStore(); // Get the Redux store instance

  // --- STATE MANAGEMENT REFACTOR ---
  // We only use useSelector to get the INITIAL state.
  // Subsequent updates for high-frequency data will be handled by our direct subscription.
  const initialState = useSelector((state) => ({
    pos: state.gameState.playerMinimapPosition,
    z: state.gameState.playerMinimapPosition.z ?? 7,
  }));

  // We use React state for user-driven interactions that SHOULD cause a re-render.
  const [mapMode, setMapMode] = useState('map');
  const [zLevel, setZLevel] = useState(initialState.z);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isLockedToPlayer, setIsLockedToPlayer] = useState(true);

  // State for dynamically loaded assets remains the same
  const [currentMapImage, setCurrentMapImage] = useState(null);
  const [currentMapIndex, setCurrentMapIndex] = useState(null);

  // OPTIMIZATION: This ref will hold all data needed for drawing.
  // It will be updated by our store subscription WITHOUT causing re-renders.
  const drawingStateRef = useRef({
    playerPosition: initialState.pos,
    freeModeCenter: { x: 0, y: 0 },
  });

  const CANVAS_SIZE = 260;

  // Effect for dynamic asset loading (unchanged, still excellent)
  useEffect(() => {
    let isMounted = true;
    setCurrentMapImage(null);
    setCurrentMapIndex(null);
    import(`../../assets/minimaps/_${mapMode}_debug_z${zLevel}.png`)
      .then((m) => {
        if (isMounted) {
          const i = new Image();
          i.src = m.default;
          i.onload = () => setCurrentMapImage(i);
        }
      })
      .catch(() => isMounted && setCurrentMapImage(null));
    import(`../../assets/minimaps/index_z${zLevel}.json`)
      .then((m) => {
        if (isMounted) setCurrentMapIndex(m.default);
      })
      .catch(() => isMounted && setCurrentMapIndex(null));
    return () => {
      isMounted = false;
    };
  }, [zLevel, mapMode]);

  // --- CORE FPS OPTIMIZATION: Direct Store Subscription ---
  useEffect(() => {
    // This function will be called on EVERY Redux state change.
    const handleStateChange = () => {
      const wholeState = store.getState();
      const newPosition = wholeState.gameState.playerMinimapPosition;
      const oldPosition = drawingStateRef.current.playerPosition;

      // Update the ref only if the position has actually changed.
      if (newPosition.x !== oldPosition.x || newPosition.y !== oldPosition.y || newPosition.z !== oldPosition.z) {
        drawingStateRef.current.playerPosition = newPosition;

        // If locked, also update the component's zLevel state if it changes.
        // This WILL cause a re-render to load new map assets, which is correct.
        if (isLockedToPlayer && newPosition.z !== zLevel) {
          setZLevel(newPosition.z);
        }
      }
    };

    // Subscribe to the store and keep the unsubscribe function.
    const unsubscribe = store.subscribe(handleStateChange);

    // Clean up the subscription when the component unmounts.
    return () => unsubscribe();
  }, [store, isLockedToPlayer, zLevel]); // Re-subscribe if lock state changes.

  // Stable animation loop (unchanged, now fed by the super-fast ref)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    let animationFrameId;

    const draw = () => {
      // Always read from the single source of truth: our refs and state.
      const { playerPosition, freeModeCenter } = drawingStateRef.current;

      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (!currentMapImage || !currentMapIndex) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }

      const { mapWidth, mapHeight, minX, minY } = currentMapIndex;
      const playerPixelX = Math.floor(playerPosition.x - minX);
      const playerPixelY = Math.floor(playerPosition.y - minY);

      const centerX = CANVAS_SIZE / 2;
      const centerY = CANVAS_SIZE / 2;

      const viewBaseX = isLockedToPlayer ? playerPixelX : freeModeCenter.x;
      const viewBaseY = isLockedToPlayer ? playerPixelY : freeModeCenter.y;

      const sourceX = viewBaseX - centerX / zoomLevel - panOffset.x;
      const sourceY = viewBaseY - centerY / zoomLevel - panOffset.y;
      const drawWidth = CANVAS_SIZE / zoomLevel;
      const drawHeight = CANVAS_SIZE / zoomLevel;

      ctx.drawImage(currentMapImage, sourceX, sourceY, drawWidth, drawHeight, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (playerPosition.z === zLevel) {
        const playerCanvasX = (playerPixelX - sourceX) * zoomLevel;
        const playerCanvasY = (playerPixelY - sourceY) * zoomLevel;
        if (playerCanvasX >= 0 && playerCanvasX < CANVAS_SIZE && playerCanvasY >= 0 && playerCanvasY < CANVAS_SIZE) {
          ctx.fillStyle = '#00ffea';
          ctx.fillRect(playerCanvasX, playerCanvasY, Math.max(1, zoomLevel), Math.max(1, zoomLevel));
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrameId);
  }, [zLevel, zoomLevel, panOffset, currentMapImage, currentMapIndex, isLockedToPlayer]); // Re-start loop only when visuals change

  // Panning/Zooming logic is good, no changes needed here.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let isDragging = false;
    let lastPos = { x: 0, y: 0 };
    const handleMouseDown = (e) => {
      if (isLockedToPlayer) return;
      isDragging = true;
      lastPos = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    };
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastPos.x;
      const dy = e.clientY - lastPos.y;
      setPanOffset((p) => ({ x: p.x - dx / zoomLevel, y: p.y - dy / zoomLevel }));
      lastPos = { x: e.clientX, y: e.clientY };
    };
    const handleMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isLockedToPlayer, zoomLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const scale = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoomLevel((z) => Math.max(0.2, Math.min(z * scale, 15)));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  const handleZChange = useCallback((delta) => {
    setIsLockedToPlayer(false); // Changing Z manually unlocks from player
    setZLevel((prevZ) => Math.max(0, Math.min(15, prevZ + delta)));
  }, []);

  const mapModeOptions = useMemo(
    () => [
      { value: 'map', label: 'Map' },
      { value: 'walkable', label: 'Walkable' },
      { value: 'coverage', label: 'Coverage' },
    ],
    [],
  );

  return (
    <StyledMinimap>
      <div className="minimap-controls">
        <button onClick={() => handleZChange(1)}>-</button>
        <button onClick={() => handleZChange(-1)}>+</button>
        <CustomSelect
          className="minimap-mode-control"
          options={mapModeOptions}
          value={mapMode}
          onChange={(e) => setMapMode(e.target.value)}
        />
      </div>
      <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} style={{ cursor: isLockedToPlayer ? 'default' : 'grab' }} />
      <span>
        {drawingStateRef.current.playerPosition.x},{drawingStateRef.current.playerPosition.y},{zLevel}
      </span>
    </StyledMinimap>
  );
};

// Memoize the component to prevent re-renders from the parent
export default memo(Minimap);
