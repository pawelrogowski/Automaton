import React, { useRef, useEffect, useState, useCallback, memo, useMemo } from 'react';
import { useSelector, useStore, useDispatch } from 'react-redux';
import { addWaypoint, removeWaypoint, setwptSelection } from '../../redux/slices/cavebotSlice.js';
import StyledMinimap from './Minimap.styled.js';
import CustomSelect from '../CustomSelect/CustomSelect.js';

// --- Configuration Constants ---
const MARKER_STYLE_THRESHOLD = 7;
const DOT_MARKER_RADIUS = 3;
const DOT_MARKER_BORDER_WIDTH = 1;

// --- Context Menu Options ---
const WAYPOINT_TYPE_OPTIONS = [
  { value: '', label: 'Add Waypoint...' },
  { value: 'Node', label: 'Node' },
  { value: 'Stand', label: 'Stand' },
  { value: 'Shovel', label: 'Shovel' },
  { value: 'Rope', label: 'Rope' },
  { value: 'Machete', label: 'Machete' },
  { value: 'Ladder', label: 'Ladder' },
  { value: 'Use', label: 'Use' },
  { value: 'Action', label: 'Action' },
  { value: 'Lure', label: 'Lure' },
];

const Minimap = () => {
  const canvasRef = useRef(null);
  const store = useStore();
  const dispatch = useDispatch();

  // --- Redux State ---
  const { pos, z: initialZ } = useSelector((state) => state.gameState.playerMinimapPosition);
  const waypoints = useSelector((state) => state.cavebot.waypoints);
  const wptSelection = useSelector((state) => state.cavebot.wptSelection);
  const pathWaypoints = useSelector((state) => state.cavebot.pathWaypoints);

  // --- Component State ---
  const [mapMode, setMapMode] = useState('map');
  const [zLevel, setZLevel] = useState(initialZ ?? 7);
  const [zoomLevel, setZoomLevel] = useState(1.4);
  const [currentMapImage, setCurrentMapImage] = useState(null);
  const [currentMapIndex, setCurrentMapIndex] = useState(null);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, type: 'add', target: null });
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, text: '' });

  // --- Refs for frequent updates without re-renders ---
  const zLevelRef = useRef(zLevel);
  const hoveredCoordRef = useRef(null);
  const hoveredWaypointRef = useRef(null);
  const contextMenuRef = useRef(null);
  const drawingStateRef = useRef({ playerPosition: { ...pos, z: initialZ } });

  const CANVAS_SIZE = 260;

  useEffect(() => {
    zLevelRef.current = zLevel;
  }, [zLevel]);

  // Effect for dynamic asset loading
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

  // Direct Redux Store Subscription for player position
  useEffect(() => {
    const handleStateChange = () => {
      const newPosition = store.getState().gameState.playerMinimapPosition;
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

  // Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    let animationFrameId;

    const draw = () => {
      const { playerPosition } = drawingStateRef.current;
      const hoveredCoord = hoveredCoordRef.current;
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (!currentMapImage || !currentMapIndex) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }

      const { minX, minY } = currentMapIndex;
      const playerPixelX = Math.floor(playerPosition.x - minX);
      const playerPixelY = Math.floor(playerPosition.y - minY);

      const centerX = CANVAS_SIZE / 2;
      const centerY = CANVAS_SIZE / 2;

      const sourceX = playerPixelX - centerX / zoomLevel;
      const sourceY = playerPixelY - centerY / zoomLevel;
      const drawWidth = CANVAS_SIZE / zoomLevel;
      const drawHeight = CANVAS_SIZE / zoomLevel;

      ctx.drawImage(currentMapImage, sourceX, sourceY, drawWidth, drawHeight, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

      // --- Draw Path Overlay ---
      if (pathWaypoints && pathWaypoints.length > 0) {
        ctx.fillStyle = 'rgb(0, 255, 234)';
        pathWaypoints.forEach((pathNode) => {
          if (pathNode.z !== zLevel) return;

          const pathNodePixelX = pathNode.x - minX;
          const pathNodePixelY = pathNode.y - minY;
          const drawX = (pathNodePixelX - sourceX) * zoomLevel;
          const drawY = (pathNodePixelY - sourceY) * zoomLevel;

          ctx.fillRect(drawX, drawY, zoomLevel, zoomLevel);
        });
      }

      // --- Draw Waypoints ---
      waypoints.forEach((waypoint) => {
        if (waypoint.z !== zLevel) return;

        const waypointPixelX = waypoint.x - minX;
        const waypointPixelY = waypoint.y - minY;
        const drawX = (waypointPixelX - sourceX) * zoomLevel;
        const drawY = (waypointPixelY - sourceY) * zoomLevel;

        const isSelected = waypoint.id === wptSelection;
        const fillColor = '#FF00FF';
        const borderColor = isSelected ? '#00FFFF' : 'black';
        const borderWidth = isSelected ? 2 : 1;

        if (zoomLevel > MARKER_STYLE_THRESHOLD) {
          ctx.fillStyle = borderColor;
          ctx.fillRect(drawX, drawY, zoomLevel, zoomLevel);
          ctx.fillStyle = fillColor;
          ctx.fillRect(drawX + borderWidth, drawY + borderWidth, zoomLevel - 2 * borderWidth, zoomLevel - 2 * borderWidth);
        } else {
          const markerCenterX = drawX + zoomLevel / 2;
          const markerCenterY = drawY + zoomLevel / 2;
          ctx.beginPath();
          ctx.arc(markerCenterX, markerCenterY, DOT_MARKER_RADIUS + DOT_MARKER_BORDER_WIDTH, 0, 2 * Math.PI);
          ctx.fillStyle = borderColor;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(markerCenterX, markerCenterY, DOT_MARKER_RADIUS, 0, 2 * Math.PI);
          ctx.fillStyle = fillColor;
          ctx.fill();
        }
      });

      // --- Draw Hover Highlight (FIXED) ---
      if (hoveredCoord && !hoveredWaypointRef.current) {
        const hoverPixelX = hoveredCoord.x - minX;
        const hoverPixelY = hoveredCoord.y - minY;
        const drawX = (hoverPixelX - sourceX) * zoomLevel;
        const drawY = (hoverPixelY - sourceY) * zoomLevel;
        // Use a semi-transparent fill so the path below is still visible
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(drawX, drawY, zoomLevel, zoomLevel);
      }

      // --- Draw Player Marker ---
      if (playerPosition.z === zLevel) {
        if (zoomLevel > MARKER_STYLE_THRESHOLD) {
          ctx.fillStyle = 'black';
          ctx.fillRect(centerX, centerY, zoomLevel, zoomLevel);
          ctx.fillStyle = 'white';
          ctx.fillRect(centerX + 1, centerY + 1, zoomLevel - 2, zoomLevel - 2);
        } else {
          const markerCenterX = centerX + zoomLevel / 2;
          const markerCenterY = centerY + zoomLevel / 2;
          ctx.beginPath();
          ctx.arc(markerCenterX, markerCenterY, DOT_MARKER_RADIUS + DOT_MARKER_BORDER_WIDTH, 0, 2 * Math.PI);
          ctx.fillStyle = 'black';
          ctx.fill();
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
  }, [zLevel, zoomLevel, currentMapImage, currentMapIndex, waypoints, wptSelection, pathWaypoints]);

  // Effect for mouse move, leave, and click listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleCanvasClick = (e) => {
      setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));

      if (hoveredWaypointRef.current) {
        if (e.ctrlKey) {
          dispatch(removeWaypoint(hoveredWaypointRef.current.id));
        } else {
          dispatch(setwptSelection(hoveredWaypointRef.current.id));
        }
      }
    };

    const handleMouseMove = (e) => {
      if (!currentMapIndex) return;
      const { playerPosition } = drawingStateRef.current;
      const { minX, minY } = currentMapIndex;
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;
      const centerX = CANVAS_SIZE / 2;
      const centerY = CANVAS_SIZE / 2;
      const playerPixelX = Math.floor(playerPosition.x - minX);
      const playerPixelY = Math.floor(playerPosition.y - minY);
      const sourceX = playerPixelX - centerX / zoomLevel;
      const sourceY = playerPixelY - centerY / zoomLevel;
      const worldX = Math.floor(sourceX + canvasX / zoomLevel + minX);
      const worldY = Math.floor(sourceY + canvasY / zoomLevel + minY);

      hoveredCoordRef.current = { x: worldX, y: worldY };

      const foundWaypoint = waypoints.find((wp) => wp.x === worldX && wp.y === worldY && wp.z === zLevel);
      hoveredWaypointRef.current = foundWaypoint || null;

      if (foundWaypoint) {
        canvas.style.cursor = e.ctrlKey ? 'crosshair' : 'pointer';

        let tooltipText = foundWaypoint.type;
        if (foundWaypoint.label && foundWaypoint.label.trim() !== '') {
          tooltipText += ` - ${foundWaypoint.label}`;
        }
        setTooltip({ visible: true, x: e.clientX + 15, y: e.clientY, text: tooltipText });
      } else {
        canvas.style.cursor = 'default';
        setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      }
    };

    const handleMouseLeave = () => {
      hoveredCoordRef.current = null;
      hoveredWaypointRef.current = null;
      canvas.style.cursor = 'default';
      setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('click', handleCanvasClick);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleCanvasClick);
    };
  }, [zoomLevel, currentMapIndex, waypoints, zLevel, dispatch]);

  // Zooming functionality
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

  // Context Menu Handler
  const handleContextMenu = useCallback(
    (e) => {
      e.preventDefault();
      if (hoveredCoordRef.current && !hoveredWaypointRef.current) {
        setContextMenu({
          visible: true,
          x: e.clientX,
          y: e.clientY,
          type: 'add',
          target: { ...hoveredCoordRef.current, z: zLevel },
        });
      }
    },
    [zLevel],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('contextmenu', handleContextMenu);
    return () => canvas.removeEventListener('contextmenu', handleContextMenu);
  }, [handleContextMenu]);

  // Effect to close the context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (canvasRef.current && canvasRef.current.contains(event.target)) {
        return;
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    if (contextMenu.visible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [contextMenu.visible]);

  // Waypoint Action Handlers
  const handleWaypointAdd = useCallback(
    (e) => {
      const waypointType = e.target.value;
      if (!waypointType || !contextMenu.target) {
        setContextMenu({ visible: false, x: 0, y: 0, type: 'add', target: null });
        return;
      }
      const { x, y, z } = contextMenu.target;
      dispatch(addWaypoint({ type: waypointType, x, y, z, range: 1, action: waypointType === 'Action' ? 'Enter your action' : '' }));
      setContextMenu({ visible: false, x: 0, y: 0, type: 'add', target: null });
    },
    [dispatch, contextMenu.target],
  );

  // Z-level change handler
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
      <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} />
      <span>
        {drawingStateRef.current.playerPosition.x},{drawingStateRef.current.playerPosition.y},{zLevel}
      </span>

      {tooltip.visible && (
        <div
          style={{
            position: 'fixed',
            top: tooltip.y,
            left: tooltip.x,
            background: 'rgba(0, 0, 0, 0.75)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            zIndex: 1001,
            pointerEvents: 'none',
          }}
        >
          {tooltip.text}
        </div>
      )}

      {contextMenu.visible && contextMenu.type === 'add' && (
        <div ref={contextMenuRef} style={{ position: 'fixed', top: `${contextMenu.y}px`, left: `${contextMenu.x}px`, zIndex: 1000 }}>
          <CustomSelect autoFocus options={WAYPOINT_TYPE_OPTIONS} value={''} onChange={handleWaypointAdd} />
        </div>
      )}
    </StyledMinimap>
  );
};

export default memo(Minimap);
