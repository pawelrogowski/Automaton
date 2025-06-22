import React, { useRef, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import StyledMinimap from './Minimap.styled.js';

// --- NEW: Grouped imports for clarity ---

// Mode 1: Full Map (_map_debug_zx.png)
import mapZ0 from '../../assets/minimaps/_map_debug_z0.png';
import mapZ1 from '../../assets/minimaps/_map_debug_z1.png';
import mapZ2 from '../../assets/minimaps/_map_debug_z2.png';
import mapZ3 from '../../assets/minimaps/_map_debug_z3.png';
import mapZ4 from '../../assets/minimaps/_map_debug_z4.png';
import mapZ5 from '../../assets/minimaps/_map_debug_z5.png';
import mapZ6 from '../../assets/minimaps/_map_debug_z6.png';
import mapZ7 from '../../assets/minimaps/_map_debug_z7.png';
import mapZ8 from '../../assets/minimaps/_map_debug_z8.png';
import mapZ9 from '../../assets/minimaps/_map_debug_z9.png';
import mapZ10 from '../../assets/minimaps/_map_debug_z10.png';
import mapZ11 from '../../assets/minimaps/_map_debug_z11.png';
import mapZ12 from '../../assets/minimaps/_map_debug_z12.png';
import mapZ13 from '../../assets/minimaps/_map_debug_z13.png';
import mapZ14 from '../../assets/minimaps/_map_debug_z14.png';
import mapZ15 from '../../assets/minimaps/_map_debug_z15.png';

// Mode 2: Coverage (_map_coverage_debug_zx.png)
import coverageZ0 from '../../assets/minimaps/_map_coverage_debug_z0.png';
import coverageZ1 from '../../assets/minimaps/_map_coverage_debug_z1.png';
import coverageZ2 from '../../assets/minimaps/_map_coverage_debug_z2.png';
import coverageZ3 from '../../assets/minimaps/_map_coverage_debug_z3.png';
import coverageZ4 from '../../assets/minimaps/_map_coverage_debug_z4.png';
import coverageZ5 from '../../assets/minimaps/_map_coverage_debug_z5.png';
import coverageZ6 from '../../assets/minimaps/_map_coverage_debug_z6.png';
import coverageZ7 from '../../assets/minimaps/_map_coverage_debug_z7.png';
import coverageZ8 from '../../assets/minimaps/_map_coverage_debug_z8.png';
import coverageZ9 from '../../assets/minimaps/_map_coverage_debug_z9.png';
import coverageZ10 from '../../assets/minimaps/_map_coverage_debug_z10.png';
import coverageZ11 from '../../assets/minimaps/_map_coverage_debug_z11.png';
import coverageZ12 from '../../assets/minimaps/_map_coverage_debug_z12.png';
import coverageZ13 from '../../assets/minimaps/_map_coverage_debug_z13.png';
import coverageZ14 from '../../assets/minimaps/_map_coverage_debug_z14.png';
import coverageZ15 from '../../assets/minimaps/_map_coverage_debug_z15.png';

// Mode 3: Walkable (_waypoint_debug_zx.png)
import waypointZ0 from '../../assets/minimaps/_waypoint_debug_z0.png';
import waypointZ1 from '../../assets/minimaps/_waypoint_debug_z1.png';
import waypointZ2 from '../../assets/minimaps/_waypoint_debug_z2.png';
import waypointZ3 from '../../assets/minimaps/_waypoint_debug_z3.png';
import waypointZ4 from '../../assets/minimaps/_waypoint_debug_z4.png';
import waypointZ5 from '../../assets/minimaps/_waypoint_debug_z5.png';
import waypointZ6 from '../../assets/minimaps/_waypoint_debug_z6.png';
import waypointZ7 from '../../assets/minimaps/_waypoint_debug_z7.png';
import waypointZ8 from '../../assets/minimaps/_waypoint_debug_z8.png';
import waypointZ9 from '../../assets/minimaps/_waypoint_debug_z9.png';
import waypointZ10 from '../../assets/minimaps/_waypoint_debug_z10.png';
import waypointZ11 from '../../assets/minimaps/_waypoint_debug_z11.png';
import waypointZ12 from '../../assets/minimaps/_waypoint_debug_z12.png';
import waypointZ13 from '../../assets/minimaps/_waypoint_debug_z13.png';
import waypointZ14 from '../../assets/minimaps/_waypoint_debug_z14.png';
import waypointZ15 from '../../assets/minimaps/_waypoint_debug_z15.png';

// --- NEW: Nested object to hold all image sets ---
const allMinimapImages = {
  map: {
    0: mapZ0,
    1: mapZ1,
    2: mapZ2,
    3: mapZ3,
    4: mapZ4,
    5: mapZ5,
    6: mapZ6,
    7: mapZ7,
    8: mapZ8,
    9: mapZ9,
    10: mapZ10,
    11: mapZ11,
    12: mapZ12,
    13: mapZ13,
    14: mapZ14,
    15: mapZ15,
  },
  coverage: {
    0: coverageZ0,
    1: coverageZ1,
    2: coverageZ2,
    3: coverageZ3,
    4: coverageZ4,
    5: coverageZ5,
    6: coverageZ6,
    7: coverageZ7,
    8: coverageZ8,
    9: coverageZ9,
    10: coverageZ10,
    11: coverageZ11,
    12: coverageZ12,
    13: coverageZ13,
    14: coverageZ14,
    15: coverageZ15,
  },
  walkable: {
    0: waypointZ0,
    1: waypointZ1,
    2: waypointZ2,
    3: waypointZ3,
    4: waypointZ4,
    5: waypointZ5,
    6: waypointZ6,
    7: waypointZ7,
    8: waypointZ8,
    9: waypointZ9,
    10: waypointZ10,
    11: waypointZ11,
    12: waypointZ12,
    13: waypointZ13,
    14: waypointZ14,
    15: waypointZ15,
  },
};

// Import all minimap index JSONs statically (This data is shared across map modes)
import indexZ0 from '../../assets/minimaps/index_z0.json';
import indexZ1 from '../../assets/minimaps/index_z1.json';
import indexZ2 from '../../assets/minimaps/index_z2.json';
import indexZ3 from '../../assets/minimaps/index_z3.json';
import indexZ4 from '../../assets/minimaps/index_z4.json';
import indexZ5 from '../../assets/minimaps/index_z5.json';
import indexZ6 from '../../assets/minimaps/index_z6.json';
import indexZ7 from '../../assets/minimaps/index_z7.json';
import indexZ8 from '../../assets/minimaps/index_z8.json';
import indexZ9 from '../../assets/minimaps/index_z9.json';
import indexZ10 from '../../assets/minimaps/index_z10.json';
import indexZ11 from '../../assets/minimaps/index_z11.json';
import indexZ12 from '../../assets/minimaps/index_z12.json';
import indexZ13 from '../../assets/minimaps/index_z13.json';
import indexZ14 from '../../assets/minimaps/index_z14.json';
import indexZ15 from '../../assets/minimaps/index_z15.json';
import CustomSelect from '../CustomSelect/CustomSelect.js';

const minimapIndexData = {
  0: indexZ0,
  1: indexZ1,
  2: indexZ2,
  3: indexZ3,
  4: indexZ4,
  5: indexZ5,
  6: indexZ6,
  7: indexZ7,
  8: indexZ8,
  9: indexZ9,
  10: indexZ10,
  11: indexZ11,
  12: indexZ12,
  13: indexZ13,
  14: indexZ14,
  15: indexZ15,
};

const Minimap = () => {
  const canvasRef = useRef(null);
  const playerPosition = useSelector((state) => state.gameState.playerMinimapPosition);

  // --- NEW: State to manage the current map mode ---
  const [mapMode, setMapMode] = useState('map'); // 'map', 'coverage', or 'walkable'
  const [zLevel, setZLevel] = useState(7);
  const [isLockedToPlayer, setIsLockedToPlayer] = useState(true);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [freeModeCenter, setFreeModeCenter] = useState({ x: 0, y: 0 });
  const [zoomLevel, setZoomLevel] = useState(1);
  const [currentLoadedMapImage, setCurrentLoadedMapImage] = useState(null);

  const CANVAS_SIZE = 260;

  // --- MODIFIED: Effect to load the Image object when zLevel OR mapMode changes ---
  useEffect(() => {
    const img = new Image();
    // Select the image source from our new nested object
    const imageSrc = allMinimapImages[mapMode]?.[zLevel];
    if (imageSrc) {
      img.src = imageSrc;
      img.onload = () => setCurrentLoadedMapImage(img);
      img.onerror = () => setCurrentLoadedMapImage(null);
    } else {
      setCurrentLoadedMapImage(null);
    }
  }, [zLevel, mapMode]); // Dependency array now includes mapMode

  // Effect to automatically follow the player's Z-level when locked
  useEffect(() => {
    if (isLockedToPlayer && playerPosition.z !== null && playerPosition.z !== undefined) {
      setZLevel(playerPosition.z);
    }
  }, [isLockedToPlayer, playerPosition.z]);

  // Drawing logic
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    let animationFrameId;

    const draw = () => {
      // (Drawing logic is largely the same, but we'll re-paste for completeness)
      if (!currentLoadedMapImage) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const mapIndex = minimapIndexData[zLevel];
      if (!mapIndex) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }

      const mapWidth = mapIndex.mapWidth;
      const mapHeight = mapIndex.mapHeight;
      const playerPixelX = Math.floor(playerPosition.x !== null ? playerPosition.x - mapIndex.minX : mapWidth / 2);
      const playerPixelY = Math.floor(playerPosition.y !== null ? playerPosition.y - mapIndex.minY : mapHeight / 2);

      const centerX = CANVAS_SIZE / 2;
      const centerY = CANVAS_SIZE / 2;

      let viewBaseX, viewBaseY;
      if (isLockedToPlayer) {
        viewBaseX = playerPixelX;
        viewBaseY = playerPixelY;
      } else {
        viewBaseX = freeModeCenter.x;
        viewBaseY = freeModeCenter.y;
      }

      // REVERTED DRAG: Using subtraction again
      const sourceX = viewBaseX - centerX / zoomLevel - panOffset.x;
      const sourceY = viewBaseY - centerY / zoomLevel - panOffset.y;

      const drawWidth = CANVAS_SIZE / zoomLevel;
      const drawHeight = CANVAS_SIZE / zoomLevel;

      ctx.drawImage(currentLoadedMapImage, sourceX, sourceY, drawWidth, drawHeight, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (playerPosition.z === zLevel) {
        const playerCanvasX = (playerPixelX - sourceX) * zoomLevel;
        const playerCanvasY = (playerPixelY - sourceY) * zoomLevel;
        const playerTileSize = 1 * zoomLevel;

        if (playerCanvasX >= 0 && playerCanvasX < CANVAS_SIZE && playerCanvasY >= 0 && playerCanvasY < CANVAS_SIZE) {
          ctx.fillStyle = '#00ffea';
          ctx.fillRect(playerCanvasX, playerCanvasY, playerTileSize, playerTileSize);
        }
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrameId);
  }, [playerPosition, zLevel, panOffset, zoomLevel, currentLoadedMapImage, isLockedToPlayer, freeModeCenter]);

  // Panning logic
  useEffect(() => {
    const canvas = canvasRef.current;
    let isDragging = false;
    let lastX, lastY;

    const handleMouseDown = (e) => {
      if (isLockedToPlayer) return;
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;

      setPanOffset((prev) => ({
        x: prev.x - dx / zoomLevel,
        y: prev.y - dy / zoomLevel,
      }));

      lastX = e.clientX;
      lastY = e.clientY;
    };

    const handleMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      canvas.style.cursor = isLockedToPlayer ? 'default' : 'grab';
    };

    const handleMouseLeave = () => {
      if (isDragging) {
        handleMouseUp();
      }
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [zoomLevel, isLockedToPlayer]);

  // Zooming logic
  useEffect(() => {
    const canvas = canvasRef.current;
    const handleWheel = (e) => {
      e.preventDefault();
      const scaleFactor = 1.1;
      const newZoomLevel = e.deltaY < 0 ? zoomLevel * scaleFactor : zoomLevel / scaleFactor;
      setZoomLevel(Math.max(0.1, Math.min(newZoomLevel, 10)));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [zoomLevel]);

  const handleZChange = (delta) => {
    // setIsLockedToPlayer(false);
    setZLevel((prevZ) => Math.max(0, Math.min(15, prevZ + delta)));
  };

  // const handleLockToggle = (e) => {
  //   const newLockState = e.target.checked;
  //   setIsLockedToPlayer(newLockState);

  //   if (newLockState) {
  //     setPanOffset({ x: 0, y: 0 });
  //   } else {
  //     const mapIndex = minimapIndexData[zLevel];
  //     if (!mapIndex) return;

  //     const playerPixelX = Math.floor(playerPosition.x !== null ? playerPosition.x - mapIndex.minX : mapIndex.mapWidth / 2);
  //     const playerPixelY = Math.floor(playerPosition.y !== null ? playerPosition.y - mapIndex.minY : mapIndex.mapHeight / 2);

  //     setFreeModeCenter({
  //       x: playerPixelX + panOffset.x,
  //       y: playerPixelY + panOffset.y,
  //     });
  //     setPanOffset({ x: 0, y: 0 });
  //   }
  // };
  const mapModeOptions = [
    { value: 'map', label: 'Map' },
    { value: 'walkable', label: 'Walkable' },
    { value: 'coverage', label: 'Coverage' },
  ];

  return (
    <StyledMinimap>
      <div className="minimap-controls">
        <button onClick={() => handleZChange(1)}>-</button>
        <button onClick={() => handleZChange(-1)}>+</button>

        {/* <div className="minimap-lock-control">
          <input type="checkbox" id="lock-to-player-checkbox" checked={isLockedToPlayer} onChange={handleLockToggle} />
          <label htmlFor="lock-to-player-checkbox">Follow</label>
        </div> */}
        <CustomSelect
          className="minimap-mode-control"
          options={mapModeOptions}
          value={mapMode}
          onChange={(e) => setMapMode(e.target.value)}
        />
      </div>
      <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} style={{ cursor: isLockedToPlayer ? 'default' : 'grab' }}></canvas>
      <span>
        {playerPosition.x},{playerPosition.y},{zLevel}
      </span>
    </StyledMinimap>
  );
};

export default Minimap;
