import React, { useRef, useEffect, useState, useCallback, memo, useMemo } from 'react';
import { useSelector, useStore } from 'react-redux';
import StyledMinimap from './Minimap.styled.js';
import CustomSelect from '../CustomSelect/CustomSelect.js';

// --- Configuration Constants (Easy to Tweak) ---

// At what zoom level do we switch from a dot to a pixel-perfect square?
const MARKER_STYLE_THRESHOLD = 7;

// --- Style for the ZOOMED-OUT Dot Marker ---
// The radius of the inner white part of the dot.
const DOT_MARKER_RADIUS = 3;
// The thickness of the black border around the dot.
const DOT_MARKER_BORDER_WIDTH = 1;

const Minimap = () => {
  const canvasRef = useRef(null);
  const store = useStore();

  const initialState = useSelector((state) => ({
    pos: state.gameState.playerMinimapPosition,
    z: state.gameState.playerMinimapPosition.z ?? 7,
  }));

  const [mapMode, setMapMode] = useState('map');
  const [zLevel, setZLevel] = useState(initialState.z);
  const [zoomLevel, setZoomLevel] = useState(1.4);

  const zLevelRef = useRef(zLevel);
  useEffect(() => {
    zLevelRef.current = zLevel;
  }, [zLevel]);

  const [currentMapImage, setCurrentMapImage] = useState(null);
  const [currentMapIndex, setCurrentMapIndex] = useState(null);

  const drawingStateRef = useRef({
    playerPosition: initialState.pos,
  });

  const CANVAS_SIZE = 260;

  // Effect for dynamic asset loading (unchanged)
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

  // Direct Redux Store Subscription (unchanged and correct)
  useEffect(() => {
    const handleStateChange = () => {
      const wholeState = store.getState();
      const newPosition = wholeState.gameState.playerMinimapPosition;
      const oldPosition = drawingStateRef.current.playerPosition;

      if (newPosition.x !== oldPosition.x || newPosition.y !== oldPosition.y || newPosition.z !== oldPosition.z) {
        drawingStateRef.current.playerPosition = newPosition;
        if (newPosition.z !== zLevelRef.current) {
          setZLevel(newPosition.z);
        }
      }
    };
    const unsubscribe = store.subscribe(handleStateChange);
    return () => unsubscribe();
  }, [store]);

  // --- Animation Loop with CORRECTED Positioning ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    let animationFrameId;

    const draw = () => {
      const { playerPosition } = drawingStateRef.current;
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (!currentMapImage || !currentMapIndex) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }

      const { minX, minY } = currentMapIndex;
      // Use Math.floor to snap the player to a specific map pixel
      const playerPixelX = Math.floor(playerPosition.x - minX);
      const playerPixelY = Math.floor(playerPosition.y - minY);

      const centerX = CANVAS_SIZE / 2;
      const centerY = CANVAS_SIZE / 2;

      // This calculation ensures the top-left of the player's map pixel
      // is drawn at (centerX, centerY) on the canvas.
      const sourceX = playerPixelX - centerX / zoomLevel;
      const sourceY = playerPixelY - centerY / zoomLevel;
      const drawWidth = CANVAS_SIZE / zoomLevel;
      const drawHeight = CANVAS_SIZE / zoomLevel;

      ctx.drawImage(currentMapImage, sourceX, sourceY, drawWidth, drawHeight, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // Draw the dynamic player marker
      if (playerPosition.z === zLevel) {
        if (zoomLevel > MARKER_STYLE_THRESHOLD) {
          // --- Draw the pixel-perfect square marker ---
          // This aligns it perfectly with the top-left of the scaled map pixel.

          // 1. Draw the outer black rectangle (the 1px border)
          ctx.fillStyle = 'black';
          ctx.fillRect(centerX, centerY, zoomLevel, zoomLevel);

          // 2. Draw the inner white rectangle (the background)
          ctx.fillStyle = 'white';
          // Inset by 1px on all sides
          ctx.fillRect(centerX + 1, centerY + 1, zoomLevel - 2, zoomLevel - 2);
        } else {
          // --- Center the dot INSIDE the pixel block ---
          const markerCenterX = centerX + zoomLevel / 2;
          const markerCenterY = centerY + zoomLevel / 2;

          // 1. Draw the outer black circle (the border)
          ctx.beginPath();
          ctx.arc(markerCenterX, markerCenterY, DOT_MARKER_RADIUS + DOT_MARKER_BORDER_WIDTH, 0, 2 * Math.PI);
          ctx.fillStyle = 'black';
          ctx.fill();

          // 2. Draw the inner white circle
          ctx.beginPath();
          ctx.arc(markerCenterX, markerCenterY, DOT_MARKER_RADIUS, 0, 2 * Math.PI);
          ctx.fillStyle = 'white';
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrameId);
  }, [zLevel, zoomLevel, currentMapImage, currentMapIndex]);

  // Zooming functionality (unchanged)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const scale = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoomLevel((z) => Math.max(1.4, Math.min(z * scale, 20)));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);

  // Handler for manual Z-level changes (unchanged)
  const handleZChange = useCallback((delta) => {
    setZLevel((prevZ) => Math.max(0, Math.min(15, prevZ + delta)));
  }, []);

  const mapModeOptions = useMemo(
    () => [
      { value: 'map', label: 'Map' },
      { value: 'waypoint', label: 'Walkable' },
      { value: 'map_coverage', label: 'Coverage' },
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
      <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} style={{ cursor: 'default' }} />
      <span>
        {drawingStateRef.current.playerPosition.x},{drawingStateRef.current.playerPosition.y},{zLevel}
      </span>
    </StyledMinimap>
  );
};

export default memo(Minimap);
